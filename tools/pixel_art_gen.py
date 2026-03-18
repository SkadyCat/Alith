"""
Procedural Pixel Art Sprite Generator — with Animation Support

stdin JSON:
  { prompt, style, width, height, seed, animate, animation_type, frame_count, frame_delay }

stdout JSON:
  Static:   { success, image, prompt, width, height, seed, engine }
  Animated: { success, image, frames, frame_count, animation_type, prompt, seed, engine }
  image is always base64 data-url (png or gif)
"""
import sys, json, random, base64, io

try:
    from PIL import Image, ImageDraw
except ImportError:
    print(json.dumps({"success": False, "error": "Pillow not installed. Run: pip install Pillow"}))
    sys.exit(0)

# ── Color palettes (10 colors per type) ──────────────────────────────────────
PALETTES = {
    "warrior": [(44,28,16),(90,60,32),(180,120,40),(220,180,60),(200,60,60),(140,30,30),(80,120,200),(40,60,140),(240,230,210),(160,160,180)],
    "mage":    [(20,10,40),(60,30,100),(120,60,180),(180,100,240),(80,200,255),(40,140,200),(255,220,100),(200,160,60),(240,230,210),(200,180,220)],
    "archer":  [(20,40,10),(50,100,30),(80,150,50),(140,200,80),(160,100,40),(100,60,20),(60,180,240),(30,120,180),(240,230,210),(180,200,160)],
    "robot":   [(30,30,40),(60,70,80),(100,120,140),(180,200,220),(255,200,0),(200,150,0),(100,200,255),(60,140,200),(240,240,240),(150,150,160)],
    "ghost":   [(10,5,20),(40,20,60),(80,50,120),(160,120,200),(200,180,255),(255,255,255),(100,220,255),(60,160,220),(240,235,250),(180,160,200)],
    "zombie":  [(20,30,10),(50,70,20),(100,120,50),(80,100,40),(60,80,30),(150,120,80),(180,200,100),(40,60,20),(200,190,150),(140,150,100)],
    "default": [(30,20,10),(80,60,30),(150,110,50),(200,160,80),(180,80,80),(120,40,40),(80,120,180),(40,70,130),(240,225,200),(170,170,190)],
}

KEYWORDS = {
    "warrior": ["warrior","knight","sword","armor","fighter","soldier","paladin"],
    "mage":    ["mage","wizard","witch","magic","spell","sorcerer","warlock"],
    "archer":  ["archer","ranger","hunter","bow","arrow","forest","scout"],
    "robot":   ["robot","mech","machine","android","cyborg","metal","droid"],
    "ghost":   ["ghost","spirit","phantom","undead","skeleton","wraith"],
    "zombie":  ["zombie","monster","creature","beast","orc","goblin"],
}

STYLE_SCALES = {"pixel art": 3, "chibi": 4, "16-bit": 2, "8-bit": 2, "default": 3}

def detect_palette_name(prompt):
    pl = prompt.lower()
    for name, words in KEYWORDS.items():
        for w in words:
            if w in pl:
                return name
    return "default"

def detect_scale(style):
    for k, v in STYLE_SCALES.items():
        if k in style.lower():
            return v
    return STYLE_SCALES["default"]

# ── Sprite grid (16 wide × 24 tall) ──────────────────────────────────────────
# Index: 0=transparent, 1-9=palette color by index, A=color 10 (as hex char)
# Simplified: use 0-7 range (8 colors)
# 0=transparent, 1=skin/primary, 2=dark, 3=mid, 4=light, 5=accent, 6=metal, 7=bright

BASE_WARRIOR = [
    "0000002200000000",
    "0000022220000000",
    "0000222222000000",
    "0002222222200000",
    "0002211112200000",
    "0002211112200000",
    "0002217172200000",  # eyes
    "0002211112200000",
    "0002211612200000",  # mouth
    "0002211112200000",
    "0003333333300000",
    "0033344443300000",
    "0034444444430000",
    "0034455544430000",
    "0034444444430000",
    "0033444444330000",
    "0003344443300000",
    "0003344443300000",
    "0033300033300000",
    "0033300033300000",
    "0033300033300000",
    "0022200022200000",
    "0022200022200000",
    "0033300033300000",
]

BASE_MAGE = [
    "0000005500000000",
    "0000055550000000",
    "0000555555000000",
    "0005555555500000",
    "0005511115500000",
    "0005511115500000",
    "0005517175500000",
    "0005511115500000",
    "0005511615500000",
    "0005511115500000",
    "0005555555500000",
    "0055511115500000",
    "0054444444540000",
    "0054455544540000",
    "0054444444540000",
    "0055444444550000",
    "0005544445500000",
    "0005544445500000",
    "0005511115500000",
    "0005511115500000",
    "0005511115500000",
    "0004400044400000",
    "0004400044400000",
    "0005500055500000",
]

BASE_ARCHER = [
    "0000003300000000",
    "0000033330000000",
    "0000333333000000",
    "0003333333300000",
    "0003311113300000",
    "0003311113300000",
    "0003317173300000",
    "0003311113300000",
    "0003311613300000",
    "0003311113300000",
    "0003333333300000",
    "0033311113300000",
    "0033222222330000",
    "0033223322330000",
    "0033222222330000",
    "0033222222330000",
    "0003322223300000",
    "0003322223300000",
    "0003311113300000",
    "0003311113300000",
    "0003311113300000",
    "0002200022200000",
    "0002200022200000",
    "0003300033300000",
]

BASE_ROBOT = [
    "0000006600000000",
    "0000066660000000",
    "0006666666000000",
    "0066666666600000",
    "0066655556600000",
    "0066655556600000",
    "0066657576600000",
    "0066655556600000",
    "0066655656600000",
    "0066655556600000",
    "0006666666600000",
    "0066644446600000",
    "0066444444660000",
    "0066445544660000",
    "0066444444660000",
    "0066444444660000",
    "0006644446600000",
    "0006644446600000",
    "0006644446600000",
    "0006644446600000",
    "0006644446600000",
    "0006600066600000",
    "0006600066600000",
    "0006600066600000",
]

BASE_GHOST = [
    "0000005500000000",
    "0000055550000000",
    "0005555555500000",
    "0055555555500000",
    "0055577575500000",
    "0055577575500000",
    "0055555555500000",
    "0055555555500000",
    "0055565555500000",
    "0055555555500000",
    "0055555555500000",
    "0055555555500000",
    "0555555555550000",
    "0555555555550000",
    "0555555555550000",
    "0555555555550000",
    "0055555555500000",
    "0005555555000000",
    "0005555555000000",
    "0005505505000000",
    "0005005005000000",
    "0000500500000000",
    "0000500500000000",
    "0000000000000000",
]

TEMPLATES = {
    "warrior": BASE_WARRIOR,
    "mage":    BASE_MAGE,
    "archer":  BASE_ARCHER,
    "robot":   BASE_ROBOT,
    "ghost":   BASE_GHOST,
    "default": BASE_WARRIOR,
}

# ── Animation frame modifiers ─────────────────────────────────────────────────
# Each modifier describes per-row vertical offsets (dy) for body sections
# Sections: head(0-9), torso(10-17), legs(18-23)

ANIMATION_CONFIGS = {
    "idle": {
        "frames": 2,
        "delay": 500,
        "mods": [
            {"body_dy": 0, "leg_phase": 0},  # frame 0: normal
            {"body_dy": 1, "leg_phase": 0},  # frame 1: slight bob down
        ],
    },
    "walk": {
        "frames": 4,
        "delay": 150,
        "mods": [
            {"body_dy": 0, "leg_phase": 0},
            {"body_dy": 1, "leg_phase": 1},
            {"body_dy": 0, "leg_phase": 2},
            {"body_dy": 1, "leg_phase": 3},
        ],
    },
    "run": {
        "frames": 4,
        "delay": 100,
        "mods": [
            {"body_dy": 0, "leg_phase": 0},
            {"body_dy": -1, "leg_phase": 1},
            {"body_dy": 0, "leg_phase": 2},
            {"body_dy": -1, "leg_phase": 3},
        ],
    },
    "attack": {
        "frames": 3,
        "delay": 120,
        "mods": [
            {"body_dy": 0, "leg_phase": 0, "arm_swing": 0},
            {"body_dy": 0, "leg_phase": 0, "arm_swing": 1},
            {"body_dy": 0, "leg_phase": 0, "arm_swing": -1},
        ],
    },
}

# Leg walk patterns: which pixels to shift for each phase (col, row, shift_y)
WALK_LEG_MODS = {
    # phase: list of (grid_row_start, grid_row_end, left_shift, right_shift)
    0: [],  # neutral
    1: [(18, 21, -1, +1)],  # left leg forward
    2: [],  # neutral
    3: [(18, 21, +1, -1)],  # right leg forward
}

def idx_to_rgba(v, palette):
    """Convert grid index to RGBA color."""
    if v == 0:
        return (0, 0, 0, 0)
    pi = min(int(v) - 1, len(palette) - 1)
    c = palette[pi]
    return (c[0], c[1], c[2], 255)

def apply_color_jitter(palette, rng, amount=20):
    return [
        (
            max(0, min(255, c[0] + rng.randint(-amount, amount))),
            max(0, min(255, c[1] + rng.randint(-amount, amount))),
            max(0, min(255, c[2] + rng.randint(-amount, amount))),
        )
        for c in palette
    ]

def render_frame(template, palette, scale, body_dy=0, leg_phase=0):
    """Render one animation frame."""
    W, H = 16, 24
    frame = Image.new("RGBA", (W * scale, H * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)

    # Build pixel map with walk modifications
    walk_mods = WALK_LEG_MODS.get(leg_phase, [])

    for ry in range(H):
        row = template[ry] if ry < len(template) else "0" * W
        for rx in range(W):
            ch = row[rx] if rx < len(row) else "0"
            v = int(ch, 16) if ch.isdigit() else 0

            # Apply body vertical offset (head + torso section)
            actual_ry = ry
            if body_dy != 0 and ry < 18:
                actual_ry = ry + body_dy

            # Apply leg walk offset
            for (rs, re, lshift, rshift) in walk_mods:
                if rs <= ry < re:
                    if rx < 8:  # left side
                        actual_ry = ry + lshift
                    else:       # right side
                        actual_ry = ry + rshift

            if 0 <= actual_ry < H and v > 0:
                rgba = idx_to_rgba(v, palette)
                x0, y0 = rx * scale, actual_ry * scale
                draw.rectangle([x0, y0, x0 + scale - 1, y0 + scale - 1], fill=rgba)

    return frame

def composite_on_bg(sprite, width_out, height_out, rng):
    """Paste sprite onto a dark background, centered."""
    bg_r = rng.randint(12, 28)
    bg_g = rng.randint(10, 22)
    bg_b = rng.randint(20, 40)
    out = Image.new("RGBA", (width_out, height_out), (bg_r, bg_g, bg_b, 255))
    ox = (width_out - sprite.width) // 2
    oy = (height_out - sprite.height) // 2
    out.paste(sprite, (ox, oy), sprite)
    return out

def make_static(template, palette, scale, width_out, height_out, rng):
    frame = render_frame(template, palette, scale)
    img = composite_on_bg(frame, width_out, height_out, rng)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def make_animated_gif(template, palette, scale, width_out, height_out, rng, anim_type, frame_count, frame_delay):
    config = ANIMATION_CONFIGS.get(anim_type, ANIMATION_CONFIGS["idle"])
    mods = config["mods"]
    delay = frame_delay or config["delay"]
    n = min(frame_count, len(mods))

    frames_pil = []
    frames_b64 = []
    for i in range(n):
        mod = mods[i]
        sprite = render_frame(template, palette, scale,
                              body_dy=mod.get("body_dy", 0),
                              leg_phase=mod.get("leg_phase", 0))
        img = composite_on_bg(sprite, width_out, height_out, rng)
        frames_pil.append(img.convert("P", palette=Image.ADAPTIVE, colors=64))
        # Also encode each frame as PNG for frame-by-frame preview
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        frames_b64.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())

    # Build animated GIF
    gif_buf = io.BytesIO()
    frames_pil[0].save(
        gif_buf,
        format="GIF",
        save_all=True,
        append_images=frames_pil[1:],
        loop=0,
        duration=delay,
        optimize=False,
        disposal=2,
    )
    gif_b64 = "data:image/gif;base64," + base64.b64encode(gif_buf.getvalue()).decode()

    return gif_b64, frames_b64, n, delay

def main():
    raw = sys.stdin.read().strip()
    try:
        args = json.loads(raw) if raw else {}
    except Exception:
        args = {}

    prompt         = args.get("prompt", "pixel art warrior sprite")
    style          = args.get("style", "pixel art")
    width          = int(args.get("width", 256))
    height         = int(args.get("height", 256))
    seed           = args.get("seed")
    animate        = bool(args.get("animate", False))
    animation_type = args.get("animation_type", "idle")
    frame_count    = int(args.get("frame_count", 4))
    frame_delay    = args.get("frame_delay")  # ms

    if seed is None:
        import time
        seed = int(time.time() * 1000) % 100000

    rng = random.Random(seed)
    palette_name = detect_palette_name(prompt)
    palette = apply_color_jitter(PALETTES[palette_name], rng, amount=20)
    scale = detect_scale(style)
    template = TEMPLATES.get(palette_name, TEMPLATES["default"])

    if animate:
        gif_b64, frames_b64, n, delay = make_animated_gif(
            template, palette, scale, width, height, rng,
            animation_type, frame_count, frame_delay
        )
        print(json.dumps({
            "success": True,
            "image": gif_b64,
            "frames": frames_b64,
            "frame_count": n,
            "frame_delay": delay,
            "animation_type": animation_type,
            "prompt": prompt,
            "style": style,
            "seed": seed,
            "engine": "procedural-pixel-art",
            "palette": palette_name,
        }))
    else:
        b64 = make_static(template, palette, scale, width, height, rng)
        print(json.dumps({
            "success": True,
            "image": "data:image/png;base64," + b64,
            "prompt": prompt,
            "style": style,
            "width": width,
            "height": height,
            "seed": seed,
            "engine": "procedural-pixel-art",
            "palette": palette_name,
        }))

if __name__ == "__main__":
    main()
