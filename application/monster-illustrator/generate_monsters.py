"""
Monster Character Illustration Generator
Model: waiIllustriousSDXL_v160 (SDXL)
Using diffusers + rembg for background removal
"""
import sys
import time
import json
import torch
from pathlib import Path
from datetime import datetime
import uuid
from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler
from rembg import remove
from PIL import Image
import io

CHECKPOINT = r"E:\AIGC\SDXL\models\checkpoints\waiIllustriousSDXL_v160.safetensors"
OUTPUT_DIR = Path(r"E:\docs-service\application\monster-illustrator\public\images")
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

MODEL_NAME = "waiIllustriousSDXL v1.60"

NEG_PROMPT = (
    "bad quality, worst quality, worst detail, sketch, censor, "
    "signature, watermark, text, deformed, ugly, blurry, lowres, "
    "extra limbs, missing limbs, bad anatomy, malformed"
)

MONSTERS = [
    {
        "id": "dark_knight",
        "name": "暗黑骑士",
        "en_name": "Dark Knight",
        "seed": 101,
        "prompt": (
            "masterpiece, best quality, very aesthetic, absurdres, "
            "1boy, solo, full body, dark knight monster, undead warrior, "
            "heavy black armor with red glowing cracks, skull helmet, "
            "glowing red eyes, dark aura, holding massive sword, "
            "fantasy RPG monster character, standing pose, facing viewer, "
            "detailed illustration, white background, character sheet"
        )
    },
    {
        "id": "demon_sorceress",
        "name": "恶魔女巫",
        "en_name": "Demon Sorceress",
        "seed": 202,
        "prompt": (
            "masterpiece, best quality, very aesthetic, absurdres, "
            "1girl, solo, full body, demon sorceress monster, "
            "purple skin, curved horns, dark purple robes with gold trim, "
            "glowing purple magic circles, long flowing dark hair, "
            "sharp claws, evil smile, dark fantasy, "
            "standing pose, facing viewer, white background, character sheet"
        )
    },
    {
        "id": "werewolf",
        "name": "狂暴狼人",
        "en_name": "Werewolf Berserker",
        "seed": 303,
        "prompt": (
            "masterpiece, best quality, very aesthetic, absurdres, "
            "1boy, solo, full body, werewolf monster, beast transformation, "
            "massive muscular wolf humanoid, gray and brown fur, "
            "tattered battle armor, glowing yellow eyes, sharp fangs and claws, "
            "battle stance, raging expression, dark fantasy RPG, "
            "standing pose, facing viewer, white background, character sheet"
        )
    },
    {
        "id": "sea_serpent_priestess",
        "name": "深海女祭司",
        "en_name": "Deep Sea Priestess",
        "seed": 404,
        "prompt": (
            "masterpiece, best quality, very aesthetic, absurdres, "
            "1girl, solo, full body, sea serpent monster priestess, "
            "scales on skin, aqua blue and teal coloring, coral crown, "
            "flowing seaweed-like robes, glowing bioluminescent markings, "
            "serpent tail lower body, holding magical coral staff, "
            "dark ocean fantasy, standing pose, facing viewer, white background, character sheet"
        )
    },
    {
        "id": "flame_dragon_knight",
        "name": "炎龙骑士",
        "en_name": "Flame Dragon Knight",
        "seed": 505,
        "prompt": (
            "masterpiece, best quality, very aesthetic, absurdres, "
            "1boy, solo, full body, flame dragon knight monster, "
            "dragon scale red armor with flame patterns, dragon wings on back, "
            "fire breathing, horned helmet, glowing orange eyes, "
            "molten lava sword, flames erupting from body, "
            "dark fantasy RPG boss character, standing pose, facing viewer, white background, character sheet"
        )
    },
    {
        "id": "shadow_assassin",
        "name": "暗影刺客",
        "en_name": "Shadow Assassin",
        "seed": 606,
        "prompt": (
            "masterpiece, best quality, very aesthetic, absurdres, "
            "1girl, solo, full body, shadow assassin monster, dark elf, "
            "black leather armor with purple runes, twin shadow daggers, "
            "long silver hair, glowing violet eyes, shadow tendrils around body, "
            "half mask covering face, dark energy swirling, "
            "stealthy pose, facing viewer, white background, character sheet"
        )
    },
]

def generate_and_remove_bg(pipe, monster, idx, total):
    print(f"\n[{idx}/{total}] Generating: {monster['en_name']} (seed={monster['seed']})", flush=True)
    t0 = time.time()

    generator = torch.Generator("cuda").manual_seed(monster["seed"])
    result = pipe(
        prompt=monster["prompt"],
        negative_prompt=NEG_PROMPT,
        num_inference_steps=25,
        guidance_scale=7.0,
        width=832,
        height=1216,
        generator=generator,
        clip_skip=1,
    )
    image = result.images[0]
    elapsed_gen = time.time() - t0

    # Save original
    orig_path = OUTPUT_DIR / f"{monster['id']}_orig.png"
    image.save(orig_path)

    # Remove background
    print(f"  Removing background...", flush=True)
    t1 = time.time()
    with open(orig_path, "rb") as f:
        removed = remove(f.read())
    img_nobg = Image.open(io.BytesIO(removed)).convert("RGBA")
    
    nobg_path = OUTPUT_DIR / f"{monster['id']}_nobg.png"
    img_nobg.save(nobg_path)
    elapsed_rembg = time.time() - t1

    print(f"  Done! gen={elapsed_gen:.1f}s rembg={elapsed_rembg:.1f}s", flush=True)
    return {
        "id": monster["id"],
        "name": monster["name"],
        "en_name": monster["en_name"],
        "orig": f"{monster['id']}_orig.png",
        "nobg": f"{monster['id']}_nobg.png",
    }


def main():
    print("Loading waiIllustriousSDXL v1.60 model...", flush=True)
    t0 = time.time()

    pipe = StableDiffusionXLPipeline.from_single_file(
        CHECKPOINT,
        torch_dtype=torch.float16,
        use_safetensors=True,
    )
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(
        pipe.scheduler.config
    )
    pipe.to("cuda")
    pipe.vae.enable_slicing()
    pipe.enable_attention_slicing()

    print(f"Model loaded in {time.time()-t0:.1f}s", flush=True)

    results = []
    total = len(MONSTERS)
    for i, monster in enumerate(MONSTERS, 1):
        info = generate_and_remove_bg(pipe, monster, i, total)
        results.append(info)
        # Write progress
        progress_path = OUTPUT_DIR / "progress.json"
        with open(progress_path, "w", encoding="utf-8") as f:
            json.dump({
                "done": i,
                "total": total,
                "model": MODEL_NAME,
                "results": results,
            }, f, ensure_ascii=False, indent=2)
        print(f"PROGRESS:{i}/{total}", flush=True)

    # Write final result
    manifest_path = OUTPUT_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({
            "model": MODEL_NAME,
            "checkpoint": CHECKPOINT,
            "generated_at": datetime.now().isoformat(),
            "monsters": results,
        }, f, ensure_ascii=False, indent=2)

    print("\nALL_DONE", flush=True)
    print(f"Manifest: {manifest_path}", flush=True)

if __name__ == "__main__":
    main()
