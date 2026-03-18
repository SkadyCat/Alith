import os, sys, time, subprocess

os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7890"
os.environ["HTTP_PROXY"]  = "http://127.0.0.1:7890"
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
# Increase timeouts for large files
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "3600"

MODEL_DIR = r"E:\AIGC\Wan\Wan2.1-T2V-1.3B"
HF_REPO   = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
LOG_FILE  = r"E:\docs-service\logs\wan_download.log"

log = open(LOG_FILE, "a", encoding="utf-8", buffering=1)

def eprint(msg):
    ts = time.strftime('%H:%M:%S')
    m = f"[{ts}] {msg}"
    print(m, flush=True)
    log.write(m + "\n"); log.flush()

eprint("Download script started (v2 - per-file subprocess mode)")

# Files to download (known list)
FILES = [
    "model_index.json",
    ".gitattributes",
    "README.md",
    "scheduler/scheduler_config.json",
    "tokenizer/special_tokens_map.json",
    "tokenizer/spiece.model",
    "tokenizer/tokenizer.json",
    "tokenizer/tokenizer_config.json",
    "text_encoder/config.json",
    "text_encoder/generation_config.json",
    "text_encoder/model.safetensors.index.json",
    "text_encoder/model-00001-of-00005.safetensors",
    "text_encoder/model-00002-of-00005.safetensors",
    "text_encoder/model-00003-of-00005.safetensors",
    "text_encoder/model-00004-of-00005.safetensors",
    "text_encoder/model-00005-of-00005.safetensors",
    "text_encoder/tokenizer.model",
    "text_encoder/tokenizer_config.json",
    "text_encoder/special_tokens_map.json",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
    "transformer/config.json",
    "transformer/diffusion_pytorch_model.safetensors.index.json",
    "transformer/diffusion_pytorch_model-00001-of-00002.safetensors",
    "transformer/diffusion_pytorch_model-00002-of-00002.safetensors",
]

PYTHON = sys.executable

def min_size(filename):
    """Minimum acceptable size for a file to be considered complete."""
    if filename.endswith(".safetensors"):
        return 1024 * 1024  # 1MB for model weights
    return 1  # any non-empty file is fine for configs/jsons

def download_file(filename, idx, total, max_retries=3):
    dest = os.path.join(MODEL_DIR, filename)
    threshold = min_size(filename)
    if os.path.isfile(dest) and os.path.getsize(dest) >= threshold:
        eprint(f"[{idx}/{total}] SKIP {filename} ({os.path.getsize(dest)//1024//1024}MB)")
        return True
    # Remove incomplete file if exists
    if os.path.isfile(dest) and os.path.getsize(dest) < threshold:
        os.remove(dest)
    for attempt in range(1, max_retries + 1):
        eprint(f"[{idx}/{total}] Downloading {filename}... (attempt {attempt})")
        # Spawn a fresh Python subprocess per file to avoid httpx client reuse issues
        code = f"""
import os
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7890"
os.environ["HTTP_PROXY"]  = "http://127.0.0.1:7890"
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "3600"
from huggingface_hub import hf_hub_download
hf_hub_download(repo_id={repr(HF_REPO)}, filename={repr(filename)}, local_dir={repr(MODEL_DIR)})
print("OK")
"""
        try:
            result = subprocess.run([PYTHON, "-c", code], timeout=7200,
                                    capture_output=True, text=True)
            if result.returncode == 0 and os.path.isfile(dest) and os.path.getsize(dest) >= threshold:
                eprint(f"[{idx}/{total}] DONE {filename} ({os.path.getsize(dest)//1024//1024}MB)")
                return True
            else:
                stderr_snippet = (result.stderr or "")[:300]
                eprint(f"[{idx}/{total}] FAIL attempt {attempt}: rc={result.returncode} sz={os.path.getsize(dest) if os.path.isfile(dest) else 'missing'} {stderr_snippet}")
        except subprocess.TimeoutExpired:
            eprint(f"[{idx}/{total}] TIMEOUT attempt {attempt}")
        except Exception as e:
            eprint(f"[{idx}/{total}] ERROR attempt {attempt}: {e}")
        time.sleep(5)
    eprint(f"[{idx}/{total}] FAILED after {max_retries} attempts: {filename}")
    return False

total = len(FILES)
failed = []
for i, filename in enumerate(FILES):
    ok = download_file(filename, i + 1, total)
    if not ok:
        failed.append(filename)

if failed:
    eprint(f"FAILED FILES ({len(failed)}): {failed}")
else:
    eprint("All done! All files downloaded successfully.")
log.close()
