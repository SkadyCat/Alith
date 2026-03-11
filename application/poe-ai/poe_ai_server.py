"""
POE AI Screen Analyzer — 10fps screen capture + OpenCV + Ollama Vision
Port: 7788
"""
import sys, os, threading, time, base64, io, json, re, math

# Fix console encoding on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
from flask import Flask, jsonify, request, Response, send_from_directory
from flask_cors import CORS

sys.path.insert(0, r"E:\python\Lib\site-packages")

import mss
import mss.tools
import cv2
import numpy as np

try:
    import requests as req_lib
    REQUESTS_OK = True
except ImportError:
    REQUESTS_OK = False

# ─── Config ───────────────────────────────────────────────────────────────────
OLLAMA_URL   = "http://localhost:11434"
VISION_MODEL = "moondream"
TEXT_MODEL   = "deepseek-31-7b:latest"
PORT         = 7788
FPS_TARGET   = 10
AI_INTERVAL  = 5.0   # seconds between AI analyses
CAPTURE_REGION = None  # None = full screen, or {"top":0,"left":0,"width":1920,"height":1080}

# ─── Shared State ─────────────────────────────────────────────────────────────
state = {
    "running": False,
    "fps": 0,
    "frame_count": 0,
    "screenshot_b64": "",
    "screenshot_small_b64": "",  # 640x360 for frontend display
    "hp_pct": 0,
    "mana_pct": 0,
    "flask_ready": [False]*5,
    "debuffs": [],
    "ai_analysis": "等待 AI 分析…",
    "ai_last_time": 0,
    "ai_busy": False,
    "ai_model_available": False,
    "last_error": "",
}
state_lock = threading.Lock()
capture_thread = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=SCRIPT_DIR, static_url_path='')
CORS(app)

# ─── Ollama helpers ───────────────────────────────────────────────────────────

def check_ollama_models():
    """Check which models are available."""
    try:
        resp = req_lib.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = [m["name"] for m in resp.json().get("models", [])]
        has_vision = any(VISION_MODEL in m for m in models)
        with state_lock:
            state["ai_model_available"] = has_vision
        return models
    except Exception as e:
        return []

def ollama_vision(image_b64: str, prompt: str) -> str:
    """Send image to moondream via Ollama for analysis."""
    try:
        payload = {
            "model": VISION_MODEL,
            "prompt": prompt,
            "images": [image_b64],
            "stream": False,
            "options": {"num_predict": 200, "temperature": 0.1}
        }
        resp = req_lib.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=30)
        return resp.json().get("response", "").strip()
    except Exception as e:
        return f"[AI错误: {e}]"

def ollama_text(prompt: str) -> str:
    """Get text advice from deepseek model."""
    try:
        payload = {
            "model": TEXT_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"num_predict": 150, "temperature": 0.2}
        }
        resp = req_lib.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=20)
        return resp.json().get("response", "").strip()
    except Exception as e:
        return f"[文字AI错误: {e}]"

# ─── OpenCV Game State Detection ─────────────────────────────────────────────

def detect_game_state(frame_bgr: np.ndarray) -> dict:
    """
    Detect POE1 game state from screenshot.
    POE1 UI: HP orb (bottom-left), Mana orb (bottom-right), flasks (5 bottles near bottom-center-left)
    """
    h, w = frame_bgr.shape[:2]
    result = {"hp_pct": -1, "mana_pct": -1, "flask_ready": [False]*5, "debuffs": []}

    # ── HP Orb (bottom-left circular area) ──
    # POE orbs are roughly at 6% from left and 85% from top
    orb_r = int(h * 0.085)   # orb radius ≈ 8.5% of height
    hp_cx = int(w * 0.058)
    hp_cy = int(h * 0.895)
    hp_region = _safe_crop(frame_bgr, hp_cy - orb_r, hp_cy + orb_r, hp_cx - orb_r, hp_cx + orb_r)
    if hp_region is not None and hp_region.size > 0:
        result["hp_pct"] = _detect_orb_fill(hp_region, color="red")

    # ── Mana Orb (bottom-right) ──
    mana_cx = int(w * 0.942)
    mana_cy = int(h * 0.895)
    mana_region = _safe_crop(frame_bgr, mana_cy - orb_r, mana_cy + orb_r, mana_cx - orb_r, mana_cx + orb_r)
    if mana_region is not None and mana_region.size > 0:
        result["mana_pct"] = _detect_orb_fill(mana_region, color="blue")

    # ── Flask Charges (5 flasks between orbs at bottom) ──
    flask_y = int(h * 0.92)
    flask_h = int(h * 0.07)
    flask_w = int(w * 0.030)
    # Flask positions: roughly 12%-30% from left, evenly spaced
    flask_start_x = int(w * 0.115)
    flask_gap = int(w * 0.038)
    for i in range(5):
        fx = flask_start_x + i * flask_gap
        region = _safe_crop(frame_bgr, flask_y - flask_h//2, flask_y + flask_h//2, fx - flask_w//2, fx + flask_w//2)
        if region is not None and region.size > 0:
            # A "ready" flask has a bright glow — look for high-saturation pixels
            hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
            bright_pixels = np.sum(hsv[:,:,2] > 120)
            total = region.shape[0] * region.shape[1]
            result["flask_ready"][i] = (bright_pixels / max(total, 1)) > 0.3

    # ── Low HP / Low Mana warnings ──
    debuffs = []
    if 0 <= result["hp_pct"] < 30:
        debuffs.append("⚠️ 低血量!")
    if 0 <= result["mana_pct"] < 15:
        debuffs.append("⚡ 法力不足!")

    # ── Screen flash detection (vaal skills, dying) ──
    mean_brightness = frame_bgr.mean()
    if mean_brightness > 210:
        debuffs.append("💥 画面强光!")
    elif mean_brightness < 20:
        debuffs.append("⬛ 画面变暗")

    result["debuffs"] = debuffs
    # Convert numpy bools to Python bools for JSON serialization
    result["flask_ready"] = [bool(x) for x in result["flask_ready"]]
    return result

def _safe_crop(img, y1, y2, x1, x2):
    h, w = img.shape[:2]
    y1, y2 = max(0, y1), min(h, y2)
    x1, x2 = max(0, x1), min(w, x2)
    if y2 > y1 and x2 > x1:
        return img[y1:y2, x1:x2]
    return None

def _detect_orb_fill(region: np.ndarray, color: str) -> float:
    """Estimate fill percentage of HP/Mana orb by color pixel ratio."""
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    if color == "red":
        # Red hue wraps: 0-10 or 160-180
        m1 = cv2.inRange(hsv, (0, 60, 60), (10, 255, 255))
        m2 = cv2.inRange(hsv, (160, 60, 60), (180, 255, 255))
        mask = cv2.bitwise_or(m1, m2)
    else:  # blue
        mask = cv2.inRange(hsv, (90, 50, 50), (130, 255, 255))

    colored = np.count_nonzero(mask)
    total = region.shape[0] * region.shape[1]
    if total == 0:
        return 0
    pct = min(100, int(colored / total * 250))  # scale up since orb is circular
    return pct

# ─── Capture Loop ─────────────────────────────────────────────────────────────

def encode_frame(frame_bgr: np.ndarray, quality=70) -> str:
    """Encode frame as JPEG base64."""
    _, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode()

def capture_loop():
    interval = 1.0 / FPS_TARGET
    fps_counter = 0
    fps_timer = time.time()

    with mss.mss() as sct:
        monitor = CAPTURE_REGION or sct.monitors[0]  # Full screen

        while state["running"]:
            t0 = time.time()

            try:
                # Capture
                raw = sct.grab(monitor)
                frame = np.array(raw)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

                # Game state detection (fast, ~1ms)
                gs = detect_game_state(frame_bgr)

                # Resize for display (640×360)
                small = cv2.resize(frame_bgr, (640, 360), interpolation=cv2.INTER_LINEAR)
                small_b64 = encode_frame(small, quality=65)

                # Full frame for AI (only save, not sent constantly)
                full_b64 = encode_frame(frame_bgr, quality=80)

                with state_lock:
                    state["hp_pct"]          = gs["hp_pct"]
                    state["mana_pct"]        = gs["mana_pct"]
                    state["flask_ready"]     = gs["flask_ready"]
                    state["debuffs"]         = gs["debuffs"]
                    state["screenshot_small_b64"] = small_b64
                    state["screenshot_b64"]  = full_b64
                    state["frame_count"]    += 1

                fps_counter += 1
                if time.time() - fps_timer >= 1.0:
                    with state_lock:
                        state["fps"] = fps_counter
                    fps_counter = 0
                    fps_timer = time.time()

                # Periodic AI analysis
                now = time.time()
                ai_due = (now - state["ai_last_time"]) >= AI_INTERVAL
                if ai_due and state["ai_model_available"] and not state["ai_busy"]:
                    snap_b64 = full_b64
                    threading.Thread(target=run_ai_analysis, args=(snap_b64,), daemon=True).start()

            except Exception as e:
                with state_lock:
                    state["last_error"] = str(e)

            elapsed = time.time() - t0
            sleep_t = max(0, interval - elapsed)
            time.sleep(sleep_t)

def run_ai_analysis(image_b64: str):
    """Run moondream vision analysis in background thread."""
    with state_lock:
        state["ai_busy"] = True
        state["ai_last_time"] = time.time()
    try:
        prompt = (
            "This is a Path of Exile 1 game screenshot. "
            "Describe in Chinese (2-3 sentences): "
            "1) What is the character doing? "
            "2) Any threats visible (monsters, projectiles)? "
            "3) Brief action advice."
        )
        result = ollama_vision(image_b64, prompt)
        with state_lock:
            state["ai_analysis"] = result if result else "AI 无法分析当前画面"
    except Exception as e:
        with state_lock:
            state["ai_analysis"] = f"[分析失败: {e}]"
    finally:
        with state_lock:
            state["ai_busy"] = False

# ─── Flask Routes ─────────────────────────────────────────────────────────────

@app.route("/api/start", methods=["POST"])
def api_start():
    global capture_thread
    with state_lock:
        if state["running"]:
            return jsonify({"ok": True, "msg": "Already running"})
        state["running"] = True
    capture_thread = threading.Thread(target=capture_loop, daemon=True)
    capture_thread.start()
    return jsonify({"ok": True, "msg": "Capture started"})

@app.route("/api/stop", methods=["POST"])
def api_stop():
    with state_lock:
        state["running"] = False
    return jsonify({"ok": True, "msg": "Capture stopped"})

@app.route("/api/state")
def api_state():
    """Return current game state (no screenshot for speed)."""
    with state_lock:
        return jsonify({
            "running":    state["running"],
            "fps":        state["fps"],
            "frame_count": state["frame_count"],
            "hp_pct":     state["hp_pct"],
            "mana_pct":   state["mana_pct"],
            "flask_ready": state["flask_ready"],
            "debuffs":    state["debuffs"],
            "ai_analysis": state["ai_analysis"],
            "ai_busy":    state["ai_busy"],
            "ai_model":   state["ai_model_available"],
            "error":      state["last_error"],
        })

@app.route("/api/screenshot")
def api_screenshot():
    """Return current screenshot (small, for display)."""
    with state_lock:
        return jsonify({
            "img": state["screenshot_small_b64"],
            "fps": state["fps"],
        })

@app.route("/api/analyze_now", methods=["POST"])
def api_analyze_now():
    """Trigger immediate AI analysis."""
    with state_lock:
        if state["ai_busy"]:
            return jsonify({"ok": False, "msg": "AI 正在分析中，请稍候"})
        snap_b64 = state["screenshot_b64"]
        has_model = state["ai_model_available"]
    if not has_model:
        # Fall back to text-only advice based on state
        with state_lock:
            hp = state["hp_pct"]
            mana = state["mana_pct"]
        prompt = f"我在玩 Path of Exile 1，当前血量约{hp}%，法力约{mana}%，请给出简短的战斗建议（中文，3句话以内）。"
        result = ollama_text(prompt)
        with state_lock:
            state["ai_analysis"] = result
        return jsonify({"ok": True, "msg": "文字建议已生成", "result": result})
    threading.Thread(target=run_ai_analysis, args=(snap_b64,), daemon=True).start()
    return jsonify({"ok": True, "msg": "AI 分析已启动"})

@app.route("/api/calibrate", methods=["POST"])
def api_calibrate():
    """Capture one frame and return raw detected values for calibration."""
    with mss.mss() as sct:
        monitor = CAPTURE_REGION or sct.monitors[0]
        raw = sct.grab(monitor)
        frame = np.array(raw)
        frame_bgr = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
        gs = detect_game_state(frame_bgr)
        small = cv2.resize(frame_bgr, (640, 360))
        b64 = encode_frame(small, quality=75)
    return jsonify({**gs, "screenshot": b64, "resolution": f"{frame.shape[1]}x{frame.shape[0]}"})

@app.route("/api/models")
def api_models():
    models = check_ollama_models()
    return jsonify({"models": models, "vision_ok": state["ai_model_available"]})

@app.route("/api/stream")
def api_stream():
    """SSE endpoint — pushes state update every 100ms."""
    def generate():
        while True:
            with state_lock:
                data = {
                    "running": state["running"],
                    "fps": state["fps"],
                    "hp_pct": state["hp_pct"],
                    "mana_pct": state["mana_pct"],
                    "flask_ready": state["flask_ready"],
                    "debuffs": state["debuffs"],
                    "ai_analysis": state["ai_analysis"],
                    "ai_busy": state["ai_busy"],
                }
            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
            time.sleep(0.1)
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.route("/")
def index():
    return send_from_directory(SCRIPT_DIR, "index.html")

# ─── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"[POE-AI] Checking Ollama models...")
    models = check_ollama_models()
    print(f"[POE-AI] Available models: {models}")
    print(f"[POE-AI] Vision model ({VISION_MODEL}): {'OK' if state['ai_model_available'] else 'NOT FOUND'}")
    print(f"[POE-AI] Server starting on http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, threaded=True, debug=False)
