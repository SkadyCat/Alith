"""
Wan Video 生成器 — Wan2.1-T2V-1.3B (text-to-video)
首次运行会自动下载模型 (~27GB, 通过 Clash 代理)。
输入 (stdin JSON): {
  "prompt": "...",
  "frames": 16,          # 帧数 (推荐 16 / 24)
  "fps": 8,              # 输出 GIF FPS
  "width": 480,
  "height": 320,
  "steps": 20,
  "seed": null
}
输出 (stdout JSON): { "success": true, "gif": "data:image/gif;base64,...", "thumbs": [...] }
"""
import sys, os, io, json, base64, time, traceback, threading

# Clash 代理
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7890"
os.environ["HTTP_PROXY"]  = "http://127.0.0.1:7890"
# HuggingFace 镜像 (备用)
os.environ.setdefault("HF_ENDPOINT", "https://huggingface.co")

MODEL_DIR = r"E:\AIGC\Wan\Wan2.1-T2V-1.3B"
HF_REPO   = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"

if sys.stdout.encoding != "utf-8":
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)

def eprint(*a): print(*a, file=sys.stderr, flush=True)

raw = sys.stdin.read().strip()
try:    args = json.loads(raw) if raw else {}
except: args = {}

prompt = args.get("prompt", "a warrior knight attacking, dynamic action, anime style")
frames = int(args.get("frames", 16))
fps    = int(args.get("fps", 8))
width  = int(args.get("width", 480))
height = int(args.get("height", 320))
steps  = int(args.get("steps", 20))
seed   = args.get("seed", None)

# Wan requires dimensions divisible by 32
width  = (width  // 32) * 32
height = (height // 32) * 32

NEGATIVE = (
    "static, frozen, blurry, low quality, worst quality, bad anatomy, "
    "watermark, signature, text"
)

eprint(f"[wan_gen] prompt='{prompt[:60]}...' frames={frames} size={width}x{height}")

_stop = threading.Event()
def _heartbeat():
    n = 0
    while not _stop.is_set():
        time.sleep(10); n += 10
        eprint(f"[wan_gen] Working... {n}s elapsed")
threading.Thread(target=_heartbeat, daemon=True).start()

try:
    import torch
    from diffusers import WanPipeline
    from diffusers.utils import export_to_gif
    from PIL import Image

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype  = torch.bfloat16 if device == "cuda" else torch.float32
    eprint(f"[wan_gen] device={device} dtype={dtype}")

    # ── Download model if not present or incomplete ──────────────────────────
    _model_ready = os.path.isfile(os.path.join(MODEL_DIR, "model_index.json"))
    if not _model_ready:
        eprint(f"[wan_gen] Model not ready. Downloading/resuming {HF_REPO} (~27GB via proxy)...")
        os.makedirs(MODEL_DIR, exist_ok=True)
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=HF_REPO,
            local_dir=MODEL_DIR,
            ignore_patterns=["*.msgpack", "*.h5", "flax_model*"],
        )
        eprint("[wan_gen] Download complete!")
    else:
        eprint(f"[wan_gen] Using cached model: {MODEL_DIR}")

    # ── Load pipeline via direct file I/O (no mmap) ───────────────────────────
    # Standard from_pretrained uses mmap which exhausts Windows page-file commit
    # charge. We instead read tensors directly (seek+readinto) and convert on the fly.
    import json as _json, struct as _struct, glob as _glob
    from transformers import UMT5EncoderModel, UMT5Config, T5TokenizerFast
    from diffusers import WanTransformer3DModel, AutoencoderKLWan, UniPCMultistepScheduler

    _DTYPE = {'F32': torch.float32, 'F16': torch.float16, 'BF16': torch.bfloat16, 'I8': torch.int8}

    def _load_shards(shard_paths, target_dtype, target_device, label):
        """Read safetensors shards via direct file I/O; convert + send to target_device."""
        sd = {}
        for shard_path in shard_paths:
            with open(shard_path, 'rb') as fh:
                hdr_sz = _struct.unpack_from('<Q', fh.read(8))[0]
                header = _json.loads(fh.read(hdr_sz))
                data_start = 8 + hdr_sz
                items = [(k, v) for k, v in header.items() if k != '__metadata__']
                for i, (key, meta) in enumerate(items):
                    src_dtype = _DTYPE[meta['dtype']]
                    shape = meta['shape']
                    off_s, off_e = meta['data_offsets']
                    nbytes = off_e - off_s
                    raw = bytearray(nbytes)
                    fh.seek(data_start + off_s)
                    fh.readinto(raw)
                    t = torch.frombuffer(raw, dtype=src_dtype)
                    if target_dtype != src_dtype:
                        t = t.to(target_dtype)
                    t = t.reshape(shape).to(target_device).contiguous()
                    sd[key] = t
                    del raw
            base = os.path.basename(shard_path)
            eprint(f"[wan_gen] {label}: {base} loaded ({len(sd)} tensors so far)")
        return sd

    eprint("[wan_gen] Loading Wan pipeline (direct IO → CUDA BF16)...")
    t0 = time.time()

    # text_encoder (UMT5EncoderModel) — largest component, loaded directly to CUDA
    enc_shards = sorted(_glob.glob(os.path.join(MODEL_DIR, 'text_encoder', '*.safetensors')))
    eprint(f"[wan_gen] Loading text_encoder ({len(enc_shards)} shards, ~21GB F32 → BF16 CUDA)...")
    enc_sd = _load_shards(enc_shards, torch.bfloat16, device, 'text_encoder')
    enc_cfg = UMT5Config.from_pretrained(os.path.join(MODEL_DIR, 'text_encoder'))
    with torch.device('meta'):
        text_encoder = UMT5EncoderModel(enc_cfg)
    text_encoder.load_state_dict(enc_sd, strict=True, assign=True)
    del enc_sd
    eprint("[wan_gen] text_encoder ready")

    # tokenizer — fast, no weights
    tokenizer = T5TokenizerFast.from_pretrained(os.path.join(MODEL_DIR, 'tokenizer'))

    # transformer (WanTransformer3DModel)
    tr_shards = sorted(_glob.glob(os.path.join(MODEL_DIR, 'transformer', '*.safetensors')))
    eprint(f"[wan_gen] Loading transformer ({len(tr_shards)} shards)...")
    tr_sd = _load_shards(tr_shards, dtype, device, 'transformer')
    transformer = WanTransformer3DModel.from_pretrained(
        MODEL_DIR, subfolder='transformer', torch_dtype=dtype,
        low_cpu_mem_usage=True, ignore_mismatched_sizes=False
    )
    transformer.load_state_dict(tr_sd, strict=True, assign=True)
    del tr_sd
    eprint("[wan_gen] transformer ready")

    # VAE
    vae_shards = sorted(_glob.glob(os.path.join(MODEL_DIR, 'vae', '*.safetensors')))
    eprint(f"[wan_gen] Loading VAE ({len(vae_shards)} shards)...")
    vae_sd = _load_shards(vae_shards, dtype, device, 'vae')
    vae = AutoencoderKLWan.from_pretrained(
        MODEL_DIR, subfolder='vae', torch_dtype=dtype, low_cpu_mem_usage=True
    )
    vae.load_state_dict(vae_sd, strict=True, assign=True)
    del vae_sd
    eprint("[wan_gen] VAE ready")

    # scheduler
    scheduler = UniPCMultistepScheduler.from_pretrained(MODEL_DIR, subfolder='scheduler')

    # Assemble pipeline
    pipe = WanPipeline(
        tokenizer=tokenizer,
        text_encoder=text_encoder,
        transformer=transformer,
        vae=vae,
        scheduler=scheduler,
    )
    eprint(f"[wan_gen] Pipeline assembled in {time.time()-t0:.1f}s")

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    # ── Generate ──────────────────────────────────────────────────────────────
    eprint(f"[wan_gen] Generating {frames}-frame video ({steps} steps)...")
    t1 = time.time()
    with torch.inference_mode():
        output = pipe(
            prompt=prompt,
            negative_prompt=NEGATIVE,
            height=height,
            width=width,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=5.0,
            generator=generator,
        )
    video_frames = output.frames[0]  # list of PIL Images
    eprint(f"[wan_gen] Generated {len(video_frames)} frames in {time.time()-t1:.1f}s")
    _stop.set()

    # ── Export GIF ────────────────────────────────────────────────────────────
    eprint("[wan_gen] Encoding GIF...")
    gif_buf = io.BytesIO()
    video_frames[0].save(
        gif_buf, format="GIF",
        save_all=True,
        append_images=video_frames[1:],
        loop=0,
        duration=int(1000 / fps),
        optimize=False,
    )
    gif_b64 = "data:image/gif;base64," + base64.b64encode(gif_buf.getvalue()).decode()

    # ── Thumbnails ────────────────────────────────────────────────────────────
    thumb_b64s = []
    step = max(1, len(video_frames) // 6)
    for i in range(0, len(video_frames), step):
        t = video_frames[i].resize((80, int(80 * height / width)), Image.LANCZOS)
        tb = io.BytesIO(); t.save(tb, format="JPEG", quality=70)
        thumb_b64s.append("data:image/jpeg;base64," + base64.b64encode(tb.getvalue()).decode())

    del pipe
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    eprint(f"[wan_gen] Done! GIF={len(gif_buf.getvalue())//1024}KB {len(video_frames)}frames")
    print(json.dumps({
        "success": True,
        "gif": gif_b64,
        "thumbs": thumb_b64s,
        "frame_count": len(video_frames),
        "width": width,
        "height": height,
        "fps": fps,
    }))

except Exception as e:
    _stop.set()
    eprint(f"[wan_gen] ERROR: {e}")
    eprint(traceback.format_exc())
    print(json.dumps({"success": False, "error": str(e)}))
