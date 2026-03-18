"""
角色生成器 — SDXL + rembg
用途: 生成全身2D游戏角色，去除背景，输出透明PNG
输入 (stdin JSON): { "prompt": "...", "width": 768, "height": 1024, "seed": null, "steps": 25 }
输出 (stdout JSON): { "success": true, "image": "data:image/png;base64,..." }
"""
import sys, os, io, json, base64, time, traceback

if sys.stdout.encoding != "utf-8":
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)

def eprint(*a): print(*a, file=sys.stderr, flush=True)

# ── Paths ──────────────────────────────────────────────────────────────────────
SDXL_PATH  = r"E:\AIGC\SDXL\models\checkpoints\waiIllustriousSDXL_v160.safetensors"
VENV_PY    = r"E:\AIGC\Flux\backend\venv\Scripts\python.exe"

# ── Read input ─────────────────────────────────────────────────────────────────
raw = sys.stdin.read().strip()
try:
    args = json.loads(raw) if raw else {}
except Exception:
    args = {}

prompt  = args.get("prompt", "a game character warrior")
width   = int(args.get("width",  768))
height  = int(args.get("height", 1024))
steps   = int(args.get("steps",  25))
seed    = args.get("seed", None)
remove_bg_flag = args.get("remove_bg", True)

# ── Character prompt engineering ───────────────────────────────────────────────
CHAR_PREFIX = (
    "masterpiece, best quality, "
    "1 character, solo, single character, full body, "
    "2D game character sprite, RPG character design, "
    "white background, simple white background, "
    "standing upright, T-pose, facing forward, front view, "
    "centered, no cropping, full figure visible, "
)
NEGATIVE = (
    "lowres, bad anatomy, bad hands, missing fingers, extra digit, "
    "fewer digits, cropped, worst quality, low quality, normal quality, "
    "jpeg artifacts, signature, watermark, username, blurry, "
    "multiple characters, 2characters, 3characters, "
    "character sheet, reference sheet, turnaround, multi-view, "
    "multiple heads, extra heads, 2heads, 3heads, "
    "split view, collage, grid, multiple panels, "
    "dynamic background, complex background, gradient background, "
    "nsfw, nude, text, ui, hud"
)

full_prompt = CHAR_PREFIX + prompt

eprint(f"[char_gen] prompt={full_prompt[:80]}...")
eprint(f"[char_gen] size={width}x{height} steps={steps} seed={seed}")

try:
    import torch
    from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype  = torch.float16 if device == "cuda" else torch.float32
    eprint(f"[char_gen] device={device}")

    # ── Load SDXL pipeline ────────────────────────────────────────────────────
    eprint("[char_gen] Loading SDXL model (this may take 30-60s on first run)...")
    t0 = time.time()
    
    # Background heartbeat so the UI knows we're alive
    import threading
    _stop = threading.Event()
    def _heartbeat():
        n = 0
        while not _stop.is_set():
            time.sleep(5)
            n += 5
            eprint(f"[char_gen] Loading model... {n}s elapsed, please wait")
    hb = threading.Thread(target=_heartbeat, daemon=True)
    hb.start()

    pipe = StableDiffusionXLPipeline.from_single_file(
        SDXL_PATH,
        torch_dtype=dtype,
        use_safetensors=True,
    )
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
    pipe = pipe.to(device)
    pipe.enable_attention_slicing()
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    eprint(f"[char_gen] Model loaded in {time.time()-t0:.1f}s")
    _stop.set()

    # ── Generate ──────────────────────────────────────────────────────────────
    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(int(seed))

    eprint("[char_gen] Generating...")
    t1 = time.time()
    with torch.inference_mode():
        result = pipe(
            prompt=full_prompt,
            negative_prompt=NEGATIVE,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=7.0,
            generator=generator,
        )
    img = result.images[0]
    eprint(f"[char_gen] Generated in {time.time()-t1:.1f}s")

    # ── Remove background ─────────────────────────────────────────────────────
    if remove_bg_flag:
        try:
            from rembg import remove as rembg_remove
            eprint("[char_gen] Removing background...")
            buf_in = io.BytesIO()
            img.save(buf_in, format="PNG")
            out_bytes = rembg_remove(buf_in.getvalue())
            from PIL import Image
            img = Image.open(io.BytesIO(out_bytes)).convert("RGBA")
            eprint("[char_gen] Background removed")
        except Exception as e:
            eprint(f"[char_gen] rembg failed: {e}, using original")
            img = img.convert("RGBA")

    # ── Encode output ─────────────────────────────────────────────────────────
    buf_out = io.BytesIO()
    img.save(buf_out, format="PNG")
    b64 = base64.b64encode(buf_out.getvalue()).decode()

    # Clean up GPU memory
    del pipe
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    print(json.dumps({
        "success": True,
        "image": "data:image/png;base64," + b64,
        "width": img.width,
        "height": img.height,
        "prompt": full_prompt,
    }))

except Exception as e:
    eprint(f"[char_gen] ERROR: {e}")
    eprint(traceback.format_exc())
    print(json.dumps({"success": False, "error": str(e)}))
