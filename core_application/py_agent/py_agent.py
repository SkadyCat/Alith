"""
PyAgent - Python Singleton Socket Server
=========================================
单例 TCP Socket 服务，监听 127.0.0.1:7441
负责与 Alith 的 CopilotCliAgent (/agent 路由) 维持 HTTP/SSE 通信，
并通过 Socket 协议将 agent 输出广播给所有已连接的客户端。

协议（JSON-lines，每条消息为一行 JSON + \\n）：
  Client → Server:
    {"action": "ping"}
    {"action": "status"}
    {"action": "start",     "params": {"task":..., "model":..., "sessionId":...}}
    {"action": "stop",      "params": {"sessionId":...}}
    {"action": "continue",  "params": {"sessionId":..., "input":...}}
    {"action": "subscribe", "params": {"sessionId":...}}

  Server → Client:
    {"type": "pong"}
    {"type": "status",       "data": {...}}
    {"type": "agent_output", "data": {"event":..., "content":...}}
    {"type": "ack",          "data": {"message":...}}
    {"type": "error",        "data": {"message":...}}
"""

import socket
import threading
import json
import sys
import os
import time
import logging
import signal
import urllib.request
import urllib.error
import http.client

# ─── 配置 ────────────────────────────────────────────────────────────────────
PYAGENT_HOST = '127.0.0.1'
PYAGENT_PORT = 7441
ALITH_HOST   = '127.0.0.1'
ALITH_PORT   = 7439
ALITH_BASE   = f'http://{ALITH_HOST}:{ALITH_PORT}'

LOG_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [PyAgent] %(levelname)s: %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(LOG_DIR, 'py_agent.log'), encoding='utf-8'),
    ]
)
log = logging.getLogger('PyAgent')

# ─── 全局状态 ─────────────────────────────────────────────────────────────────
_lock      = threading.Lock()
_clients   = {}          # conn -> {sessionId, addr}
_sse_threads = {}        # sessionId -> Thread（SSE 订阅线程）
_shutdown  = threading.Event()


# ─── 工具函数 ─────────────────────────────────────────────────────────────────

def send_json(conn, obj):
    """向 socket 连接发送 JSON 消息（以 \\n 结尾）"""
    try:
        data = json.dumps(obj, ensure_ascii=False) + '\n'
        conn.sendall(data.encode('utf-8'))
    except Exception as e:
        log.debug(f'send_json error: {e}')


def broadcast(obj, session_id=None):
    """广播消息到所有客户端（可选：仅发给订阅了 sessionId 的客户端）"""
    with _lock:
        targets = list(_clients.items())
    for conn, info in targets:
        if session_id is None or info.get('sessionId') == session_id:
            send_json(conn, obj)


def alith_post(path, payload):
    """向 Alith 发送 HTTP POST 请求，返回响应字典或抛出异常"""
    body = json.dumps(payload).encode('utf-8')
    conn = http.client.HTTPConnection(ALITH_HOST, ALITH_PORT, timeout=10)
    try:
        conn.request('POST', path, body=body, headers={
            'Content-Type': 'application/json',
            'Content-Length': str(len(body)),
        })
        resp = conn.getresponse()
        raw  = resp.read().decode('utf-8')
        return json.loads(raw) if raw else {}
    finally:
        conn.close()


def alith_get(path):
    """向 Alith 发送 HTTP GET 请求，返回响应字典"""
    conn = http.client.HTTPConnection(ALITH_HOST, ALITH_PORT, timeout=10)
    try:
        conn.request('GET', path)
        resp = conn.getresponse()
        raw  = resp.read().decode('utf-8')
        return json.loads(raw) if raw else {}
    finally:
        conn.close()


def subscribe_sse(session_id):
    """
    订阅 Alith CopilotCliAgent 的 SSE 流 (/agent/stream)，
    将 agent 输出广播给已连接的 socket 客户端。
    本函数在独立线程中运行。
    """
    url = f'{ALITH_BASE}/agent/stream?sessionId={session_id}'
    log.info(f'开始订阅 SSE 流: {url}')

    while not _shutdown.is_set():
        try:
            req = urllib.request.Request(url, headers={'Accept': 'text/event-stream'})
            with urllib.request.urlopen(req, timeout=60) as resp:
                buf = b''
                while not _shutdown.is_set():
                    chunk = resp.read(512)
                    if not chunk:
                        break
                    buf += chunk
                    while b'\n\n' in buf:
                        block, buf = buf.split(b'\n\n', 1)
                        event = _parse_sse_block(block.decode('utf-8'))
                        if event:
                            broadcast({
                                'type': 'agent_output',
                                'sessionId': session_id,
                                'data': event,
                            }, session_id=None)  # 广播给所有客户端
        except urllib.error.URLError as e:
            if _shutdown.is_set():
                break
            log.warning(f'SSE 连接断开，5s 后重连: {e}')
            time.sleep(5)
        except Exception as e:
            if _shutdown.is_set():
                break
            log.error(f'SSE 异常: {e}')
            time.sleep(5)

    log.info(f'SSE 订阅线程退出: sessionId={session_id}')


def _parse_sse_block(block):
    """解析 SSE 数据块为 {event, data} 字典"""
    event_type = 'message'
    data_lines = []
    for line in block.splitlines():
        if line.startswith('event:'):
            event_type = line[6:].strip()
        elif line.startswith('data:'):
            data_lines.append(line[5:].strip())
    if not data_lines:
        return None
    raw_data = '\n'.join(data_lines)
    try:
        parsed = json.loads(raw_data)
    except Exception:
        parsed = raw_data
    return {'event': event_type, 'content': parsed}


def ensure_sse_subscription(session_id):
    """确保 SSE 订阅线程存在且在运行"""
    with _lock:
        t = _sse_threads.get(session_id)
        if t and t.is_alive():
            return
        t = threading.Thread(
            target=subscribe_sse,
            args=(session_id,),
            name=f'sse-{session_id}',
            daemon=True,
        )
        _sse_threads[session_id] = t
        t.start()
        log.info(f'已启动 SSE 订阅线程: sessionId={session_id}')


# ─── 消息处理 ─────────────────────────────────────────────────────────────────

def handle_action(conn, msg):
    """处理客户端发来的 action 消息"""
    action = msg.get('action', '')
    params = msg.get('params', {})

    if action == 'ping':
        send_json(conn, {'type': 'pong'})

    elif action == 'status':
        try:
            session_id = params.get('sessionId', 'default')
            data = alith_get(f'/agent/status?sessionId={session_id}')
            # 附加 PyAgent 自身状态
            with _lock:
                data['pyagent'] = {
                    'clients': len(_clients),
                    'sse_sessions': list(_sse_threads.keys()),
                }
            send_json(conn, {'type': 'status', 'data': data})
        except Exception as e:
            send_json(conn, {'type': 'error', 'data': {'message': str(e)}})

    elif action == 'start':
        try:
            session_id = params.get('sessionId', 'default')
            resp = alith_post('/agent/start', params)
            send_json(conn, {'type': 'ack', 'data': resp})
            ensure_sse_subscription(session_id)
        except Exception as e:
            send_json(conn, {'type': 'error', 'data': {'message': str(e)}})

    elif action == 'stop':
        try:
            session_id = params.get('sessionId', 'default')
            resp = alith_post('/agent/stop', params)
            send_json(conn, {'type': 'ack', 'data': resp})
        except Exception as e:
            send_json(conn, {'type': 'error', 'data': {'message': str(e)}})

    elif action == 'continue':
        try:
            resp = alith_post('/agent/continue', params)
            send_json(conn, {'type': 'ack', 'data': resp})
        except Exception as e:
            send_json(conn, {'type': 'error', 'data': {'message': str(e)}})

    elif action == 'subscribe':
        session_id = params.get('sessionId', 'default')
        with _lock:
            if conn in _clients:
                _clients[conn]['sessionId'] = session_id
        ensure_sse_subscription(session_id)
        send_json(conn, {'type': 'ack', 'data': {'message': f'已订阅 sessionId={session_id}'}})

    else:
        send_json(conn, {'type': 'error', 'data': {'message': f'未知 action: {action}'}})


def handle_client(conn, addr):
    """每个客户端连接的处理线程"""
    log.info(f'客户端已连接: {addr}')
    with _lock:
        _clients[conn] = {'addr': str(addr), 'sessionId': None}

    buf = ''
    try:
        conn.settimeout(300)  # 5 分钟无数据自动断开
        while not _shutdown.is_set():
            try:
                chunk = conn.recv(4096)
            except socket.timeout:
                # 发送心跳确认连接存活
                send_json(conn, {'type': 'ping'})
                continue
            if not chunk:
                break
            buf += chunk.decode('utf-8', errors='replace')
            while '\n' in buf:
                line, buf = buf.split('\n', 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    handle_action(conn, msg)
                except json.JSONDecodeError:
                    send_json(conn, {'type': 'error', 'data': {'message': '无效的 JSON 格式'}})
    except ConnectionResetError:
        pass
    except Exception as e:
        log.error(f'客户端处理异常 {addr}: {e}')
    finally:
        with _lock:
            _clients.pop(conn, None)
        try:
            conn.close()
        except Exception:
            pass
        log.info(f'客户端已断开: {addr}')


# ─── 主服务 ───────────────────────────────────────────────────────────────────

def run_server():
    """启动 TCP Socket 服务器（单例由端口绑定保证）"""
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)  # 不复用，保证单例

    try:
        server_sock.bind((PYAGENT_HOST, PYAGENT_PORT))
    except OSError as e:
        log.error(f'端口 {PYAGENT_PORT} 已被占用，PyAgent 可能已在运行。退出。({e})')
        sys.exit(1)

    server_sock.listen(32)
    log.info(f'PyAgent 已启动，监听 {PYAGENT_HOST}:{PYAGENT_PORT}')
    log.info(f'Alith 地址: {ALITH_BASE}')

    def _shutdown_handler(signum, frame):
        log.info('收到停止信号，PyAgent 正在关闭...')
        _shutdown.set()
        server_sock.close()

    signal.signal(signal.SIGINT,  _shutdown_handler)
    signal.signal(signal.SIGTERM, _shutdown_handler)

    server_sock.settimeout(1.0)
    while not _shutdown.is_set():
        try:
            conn, addr = server_sock.accept()
        except socket.timeout:
            continue
        except OSError:
            break
        t = threading.Thread(
            target=handle_client,
            args=(conn, addr),
            name=f'client-{addr}',
            daemon=True,
        )
        t.start()

    log.info('PyAgent 已停止。')


if __name__ == '__main__':
    run_server()
