import os, sys, time, requests

PROXY = {"https": "http://127.0.0.1:7890", "http": "http://127.0.0.1:7890"}
BASE  = "https://hf-mirror.com/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/resolve/main"
DEST  = r"E:\AIGC\Wan\Wan2.1-T2V-1.3B\text_encoder"
LOG   = open(r"E:\docs-service\logs\wan_text_enc.log", "a", encoding="utf-8", buffering=1)

def pr(msg):
    ts = time.strftime("%H:%M:%S")
    m = f"[{ts}] {msg}"
    print(m, flush=True)
    LOG.write(m + "\n"); LOG.flush()

FILES = [f"model-0000{i}-of-00005.safetensors" for i in range(1, 6)]

for fname in FILES:
    dest_path = os.path.join(DEST, fname)
    url = f"{BASE}/text_encoder/{fname}"
    
    # Check if already complete
    existing = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0
    
    # Get file size
    try:
        r = requests.head(url, proxies=PROXY, timeout=30, allow_redirects=True)
        total = int(r.headers.get("Content-Length", 0))
    except Exception as e:
        pr(f"HEAD failed for {fname}: {e}")
        total = 0
    
    if existing > 0 and existing == total:
        pr(f"SKIP {fname} ({existing/1024/1024/1024:.2f}GB already complete)")
        continue
    
    pr(f"DL {fname} | resume from {existing/1024/1024:.0f}MB | total {total/1024/1024/1024:.2f}GB")
    
    headers = {}
    if existing > 0 and total > 0:
        headers["Range"] = f"bytes={existing}-"
    
    mode = "ab" if existing > 0 else "wb"
    start = time.time()
    last_log = start
    downloaded = existing
    
    try:
        resp = requests.get(url, proxies=PROXY, headers=headers, stream=True, timeout=60)
        with open(dest_path, mode) as f:
            for chunk in resp.iter_content(chunk_size=8*1024*1024):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    now = time.time()
                    if now - last_log >= 30:
                        speed = (downloaded - existing) / (now - start) / 1024 / 1024
                        pct = downloaded / total * 100 if total else 0
                        pr(f"  {fname}: {downloaded/1024/1024/1024:.2f}GB / {total/1024/1024/1024:.2f}GB ({pct:.1f}%) @ {speed:.1f}MB/s")
                        last_log = now
        elapsed = time.time() - start
        final_sz = os.path.getsize(dest_path)
        pr(f"OK {fname} done in {elapsed:.0f}s ({final_sz/1024/1024/1024:.2f}GB)")
    except Exception as e:
        pr(f"ERROR {fname}: {e}")
        sys.exit(1)

pr("All text_encoder shards downloaded!")
LOG.close()
