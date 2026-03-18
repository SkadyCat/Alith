"""
视频角色动画生成器 — AnimateDiff SDXL + waiIllustriousSDXL
输入 (stdin JSON): {
  "prompt": "...",
  "action": "attack|idle|walk|run|jump",
  "width": 512, "height": 512,
  "frames": 16, "steps": 20, "seed": null
}
输出 (stdout JSON): { "success": true, "gif": "data:image/gif;base64,...", "frames": [...] }
"""
import sys, os, io, json, base64, time, traceback, threading

if sys.stdout.encoding != "utf-8":
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)

def eprint(*a): print(*a, file=sys.stderr, flush=True)

# ── Paths ──────────────────────────────────────────────────────────────────────
SDXL_PATH   = r"E:\AIGC\SDXL\models\checkpoints\waiIllustriousSDXL_v160.safetensors"
MOTION_PATH = r"E:\AIGC\SDXL\models\animatediff\animatediffMotion_sdxlV10Beta.ckpt"

# ── Read input ─────────────────────────────────────────────────────────────────
raw = sys.stdin.read().strip()
try:    args = json.loads(raw) if raw else {}
except: args = {}

prompt  = args.get("prompt", "game character warrior")
action  = args.get("action", "idle")
width   = int(args.get("width",  512))
height  = int(args.get("height", 512))
frames  = int(args.get("frames", 16))
steps   = int(args.get("steps",  20))
seed    = args.get("seed", None)

# ── Action-specific prompt engineering ────────────────────────────────────────
ACTION_PROMPTS = {
    "idle":   "standing idle, breathing, slight movement, looping animation, game character",
    "walk":   "walking forward, smooth walk cycle, looping animation, game character",
    "run":    "running fast, dynamic run cycle, looping animation, game character",
    "attack": "sword attack animation, slashing motion, combat action, dynamic pose, game character",
    "jump":   "jumping in the air, leaping motion, landing, game character",
    "cast":   "casting magic spell, glowing hands, magical effect, game character",
    "die":    "falling down, death animation, collapse, game character",
    "skill":  "special skill animation, powerful attack, energy burst, game character",
}

BASE_PREFIX = (
    "masterpiece, best quality, 2D game character animation, "
    "solo, single character, side view or front view, "
    "smooth animation, "
)
NEGATIVE = (
    "lowres, bad anatomy, bad hands, worst quality, low quality, "
    "blurry, multiple characters, nsfw, nude, "
    "watermark, signature, text, ui"
)

action_desc = ACTION_PROMPTS.get(action, ACTION_PROMPTS["idle"])
full_prompt = BASE_PREFIX + action_desc + ", " + prompt
eprint(f"[video_gen] action={action} frames={frames} size={width}x{height}")
eprint(f"[video_gen] prompt={full_prompt[:100]}...")

# ── Heartbeat thread ──────────────────────────────────────────────────────────
_stop = threading.Event()
def _heartbeat():
    n = 0
    while not _stop.is_set():
        time.sleep(5); n += 5
        eprint(f"[video_gen] Working... {n}s elapsed")
hb = threading.Thread(target=_heartbeat, daemon=True)
hb.start()

try:
    import torch
    from diffusers import AnimateDiffSDXLPipeline, MotionAdapter, EulerDiscreteScheduler
    from diffusers.utils import export_to_gif, export_to_video
    from PIL import Image

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype  = torch.float16 if device == "cuda" else torch.float32
    eprint(f"[video_gen] device={device}")

    # ── Load MotionAdapter ──────────────────────────────────────────────────────
    eprint("[video_gen] Loading MotionAdapter SDXL...")
    adapter = MotionAdapter.from_single_file(MOTION_PATH)
    adapter = adapter.to(dtype=dtype)  # force cast to fp16

    # ── Load SDXL pipeline with AnimateDiff ─────────────────────────────────────
    eprint("[video_gen] Loading AnimateDiffSDXL pipeline...")
    pipe = AnimateDiffSDXLPipeline.from_single_file(
        SDXL_PATH,
        motion_adapter=adapter,
        torch_dtype=dtype,
        use_safetensors=True,
    )
    pipe.scheduler = EulerDiscreteScheduler.from_config(
        pipe.scheduler.config,
        timestep_spacing="trailing",
        beta_schedule="linear",
    )
    pipe = pipe.to(device, dtype=dtype)
    # Keep VAE in float32 to avoid group_norm dtype mismatch during decode
    pipe.vae = pipe.vae.to(torch.float32)
    pipe.enable_vae_slicing()
    pipe.enable_attention_slicing()
    eprint("[video_gen] Pipeline ready!")

    # ── Generate ───────────────────────────────────────────────────────────────
    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(int(seed))

    eprint(f"[video_gen] Generating {frames} frames...")
    t1 = time.time()
    with torch.inference_mode(), torch.autocast("cuda" if device == "cuda" else "cpu"):
        output = pipe(
            prompt=full_prompt,
            negative_prompt=NEGATIVE,
            width=width,
            height=height,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=7.5,
            generator=generator,
        )
    eprint(f"[video_gen] Generated in {time.time()-t1:.1f}s")
    _stop.set()

    # Handle output format (PIL list or tensor)
    raw_frames = output.frames[0]
    eprint(f"[video_gen] Post-processing {len(raw_frames)} frames...")

    # Convert to PIL if needed
    frames_pil = []
    for f in raw_frames:
        if hasattr(f, 'save'):
            frames_pil.append(f.convert("RGB"))
        else:
            import numpy as np
            arr = (f.cpu().float().numpy() * 255).clip(0,255).astype("uint8")
            frames_pil.append(Image.fromarray(arr))

    # ── Export GIF (only, no individual frames to avoid stdout bloat) ──────────
    eprint("[video_gen] Encoding GIF...")
    gif_buf = io.BytesIO()
    frames_pil[0].save(
        gif_buf, format="GIF",
        save_all=True,
        append_images=frames_pil[1:],
        loop=0,
        duration=int(1000/12),
        optimize=False,  # faster than optimize=True
    )
    gif_bytes = gif_buf.getvalue()
    gif_b64 = base64.b64encode(gif_bytes).decode()
    eprint(f"[video_gen] GIF size: {len(gif_bytes)//1024}KB")

    # ── Export only first frame thumbnail for preview strip ────────────────────
    thumb_b64s = []
    thumb_size = (96, 96)
    for frm in frames_pil:
        t_buf = io.BytesIO()
        frm.copy().thumbnail(thumb_size)
        frm.copy().resize(thumb_size).save(t_buf, format="JPEG", quality=70)
        thumb_b64s.append("data:image/jpeg;base64," + base64.b64encode(t_buf.getvalue()).decode())

    # Clean up GPU memory
    del pipe, adapter
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    eprint("[video_gen] Done, writing output...")
    print(json.dumps({
        "success": True,
        "gif": "data:image/gif;base64," + gif_b64,
        "frames": thumb_b64s,  # small JPEG thumbnails only
        "frame_count": len(frames_pil),
        "width": width,
        "height": height,
        "action": action,
        "prompt": full_prompt,
    }))

except Exception as e:
    _stop.set()
    eprint(f"[video_gen] ERROR: {e}")
    eprint(traceback.format_exc())
    print(json.dumps({"success": False, "error": str(e)}))
