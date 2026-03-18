"""
游戏角色序列帧生成器 — SDXL Per-Frame Generation
策略: 每帧单独生成（精准关键帧描述词 + 固定 seed），最后拼成图集
输入 (stdin JSON): {
  "prompt": "...",            # 角色描述
  "action": "attack|idle|walk|run|skill|hurt|die|cast",
  "char_style": "pixel|cartoon|anime|realistic",
  "cols": 4,                  # 帧数（自动决定，也可指定）
  "frame_size": 256           # 每帧正方形尺寸
}
输出 (stdout JSON): { "success": true, "frames": [...], "thumbs": [...], "sheet": "..." }
"""
import sys, os, io, json, base64, time, traceback, threading, random

if sys.stdout.encoding != "utf-8":
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)

def eprint(*a): print(*a, file=sys.stderr, flush=True)

SDXL_PATH = r"E:\AIGC\SDXL\models\checkpoints\waiIllustriousSDXL_v160.safetensors"

# ── Read input ─────────────────────────────────────────────────────────────────
raw = sys.stdin.read().strip()
try:    args = json.loads(raw) if raw else {}
except: args = {}

prompt     = args.get("prompt", "warrior knight")
action     = args.get("action", "attack")
char_style = args.get("char_style", "anime")
frame_size = int(args.get("frame_size", 256))
steps      = int(args.get("steps", 20))
seed       = args.get("seed", None)

# ── Style descriptors ─────────────────────────────────────────────────────────
STYLE_MAP = {
    "pixel":     "pixel art, 16-bit retro game sprite, crisp edges, limited palette, white background",
    "cartoon":   "cartoon style, flat colors, bold outline, 2D game character art, white background",
    "anime":     "anime style, clean lineart, cel shaded, vibrant colors, 2D game character, white background",
    "realistic": "semi-realistic, detailed illustration, game character concept art, white background",
}

# ── Per-frame keypose prompts for each action ─────────────────────────────────
# Each list defines the pose for each frame in the animation cycle
ACTION_KEYFRAMES = {
    "idle": [
        "standing relaxed, arms at sides, neutral pose, facing right",
        "standing, slight forward lean, arms relaxed, breathing in",
        "standing relaxed, arms at sides, neutral pose, facing right",
        "standing, slight backward lean, arms relaxed, breathing out",
    ],
    "walk": [
        "walking, right foot forward, left arm forward, mid stride, side view",
        "walking, feet together, upright, transition pose, side view",
        "walking, left foot forward, right arm forward, mid stride, side view",
        "walking, feet together, upright, transition pose, side view",
    ],
    "run": [
        "running fast, right leg extended forward, left leg back, leaning forward, side view",
        "running, airborne both feet off ground, arms pumping, side view",
        "running fast, left leg extended forward, right leg back, leaning forward, side view",
        "running, push-off foot leaving ground, arm swing, side view",
    ],
    "attack": [
        "sword attack windup, weapon raised overhead, side stance",
        "sword attack mid-swing, weapon at 45 degrees, body rotating",
        "sword attack impact, weapon fully extended, follow-through",
        "sword attack recovery, returning to guard stance",
    ],
    "skill": [
        "skill casting, hands raised, energy gathering, glowing aura",
        "skill casting, energy condensing in hands, intense glow",
        "skill release, explosion of energy, arms outstretched",
        "skill aftermath, landing pose, dissipating energy particles",
    ],
    "hurt": [
        "taking damage, recoiling backward, arms raised in defense",
        "staggering, off-balance, pained expression",
        "recovering from hit, crouching, guarded stance",
    ],
    "die": [
        "death hit reaction, stumbling backward, arms flailing",
        "falling, body at 45 degrees, losing balance",
        "collapsed on knees, slumping forward",
        "lying on ground, motionless, death pose",
    ],
    "cast": [
        "magic cast preparation, staff raised, gathering mana",
        "magic channeling, magic circle appearing, intense concentration",
        "spell release, bright flash, energy beam or projectile launching",
        "cast completion, staff lowered, magical afterglow",
    ],
}

keyframes = ACTION_KEYFRAMES.get(action, ACTION_KEYFRAMES["attack"])
cols = args.get("cols", None)
if cols is None:
    cols = len(keyframes)
else:
    cols = int(cols)
    # Trim or extend keyframes list to match requested cols
    while len(keyframes) < cols:
        keyframes = keyframes + keyframes  # repeat
    keyframes = keyframes[:cols]

style_desc = STYLE_MAP.get(char_style, STYLE_MAP["anime"])

CHAR_PREFIX = f"single character, solo, {style_desc}, full body, {prompt}, "
NEGATIVE = (
    "blurry, bad anatomy, extra limbs, extra characters, multiple characters, "
    "background, scenery, landscape, watermark, signature, text, "
    "nsfw, nude, low quality, worst quality, deformed, mutated, "
    "cropped, partial body, floating, disembodied"
)

# Fix seed for character consistency across frames
if seed is None:
    seed = random.randint(0, 2**31)
seed = int(seed)

eprint(f"[sprite_gen] action={action} style={char_style} frames={cols} size={frame_size} seed={seed}")
eprint(f"[sprite_gen] Strategy: per-frame generation with keypose prompts")

# ── Heartbeat ─────────────────────────────────────────────────────────────────
_stop = threading.Event()
def _heartbeat():
    n = 0
    while not _stop.is_set():
        time.sleep(5); n += 5
        eprint(f"[sprite_gen] Working... {n}s elapsed")
threading.Thread(target=_heartbeat, daemon=True).start()

try:
    import torch
    from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler
    from PIL import Image

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype  = torch.float16 if device == "cuda" else torch.float32
    eprint(f"[sprite_gen] device={device}")

    eprint("[sprite_gen] Loading SDXL...")
    t0 = time.time()
    pipe = StableDiffusionXLPipeline.from_single_file(
        SDXL_PATH, torch_dtype=dtype, use_safetensors=True,
    )
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
    pipe = pipe.to(device)
    pipe.enable_vae_slicing()
    pipe.enable_attention_slicing()
    eprint(f"[sprite_gen] Loaded in {time.time()-t0:.1f}s")

    # ── Generate each frame individually ──────────────────────────────────────
    frame_imgs = []
    for i, keypose in enumerate(keyframes):
        frame_prompt = CHAR_PREFIX + keypose
        eprint(f"[sprite_gen] Frame {i+1}/{cols}: {keypose[:60]}...")
        t1 = time.time()
        # Use seed + frame index so frames vary but character stays consistent
        generator = torch.Generator(device=device).manual_seed(seed + i * 1000)
        with torch.inference_mode():
            result = pipe(
                prompt=frame_prompt,
                negative_prompt=NEGATIVE,
                width=frame_size,
                height=frame_size,
                num_inference_steps=steps,
                guidance_scale=7.5,
                generator=generator,
            )
        frame_imgs.append(result.images[0])
        eprint(f"[sprite_gen] Frame {i+1} done in {time.time()-t1:.1f}s")

    _stop.set()
    eprint(f"[sprite_gen] All {cols} frames generated, processing...")

    # ── Remove background with rembg & encode ────────────────────────────────
    try:
        from rembg import remove as rembg_remove, new_session as rembg_session
        _rembg_session = rembg_session("u2net")
        eprint("[sprite_gen] Using rembg for background removal")
        def remove_bg(img):
            return rembg_remove(img.convert("RGBA"), session=_rembg_session)
    except Exception as rembg_err:
        eprint(f"[sprite_gen] rembg unavailable ({rembg_err}), using threshold fallback")
        def remove_bg(img):
            rgba = img.convert("RGBA")
            data = rgba.load()
            w, h = rgba.size
            for y in range(h):
                for x in range(w):
                    r, g, b, a = data[x, y]
                    if r > 220 and g > 220 and b > 220:
                        data[x, y] = (r, g, b, 0)
            return rgba

    frames_b64 = []
    thumb_b64s = []
    frame_rgbas = []

    for img in frame_imgs:
        rgba = remove_bg(img)
        frame_rgbas.append(rgba)

        buf = io.BytesIO()
        rgba.save(buf, format="PNG", optimize=False)
        frames_b64.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())

        thumb = rgba.resize((96, 96), Image.LANCZOS)
        tbuf = io.BytesIO()
        thumb.save(tbuf, format="PNG", optimize=False)
        thumb_b64s.append("data:image/png;base64," + base64.b64encode(tbuf.getvalue()).decode())

    # ── Assemble sprite sheet ─────────────────────────────────────────────────
    fw, fh = frame_size, frame_size
    sheet = Image.new("RGBA", (fw * cols, fh), (255, 255, 255, 0))
    for i, rgba in enumerate(frame_rgbas):
        sheet.paste(rgba, (i * fw, 0))

    sbuf = io.BytesIO()
    sheet.save(sbuf, format="PNG", optimize=False)
    sheet_b64 = "data:image/png;base64," + base64.b64encode(sbuf.getvalue()).decode()

    del pipe
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    eprint(f"[sprite_gen] Done! {cols} frames, sheet={fw*cols}x{fh}")
    print(json.dumps({
        "success": True,
        "frames": frames_b64,
        "thumbs": thumb_b64s,
        "sheet": sheet_b64,
        "frame_count": cols,
        "frame_w": fw,
        "frame_h": fh,
        "action": action,
        "style": char_style,
        "seed": seed,
        "keyframes": keyframes,
    }))

except Exception as e:
    _stop.set()
    eprint(f"[sprite_gen] ERROR: {e}")
    eprint(traceback.format_exc())
    print(json.dumps({"success": False, "error": str(e)}))
