"""
PyAgent Client - Python 客户端库
===================================
用于连接 PyAgent 单例 Socket 服务的简洁客户端。

用法示例:
    from agent_client import PyAgentClient

    client = PyAgentClient()
    client.connect()
    client.start_agent(task="帮我分析一下代码", model="claude-sonnet-4.6", session_id="demo")
    for msg in client.listen():
        print(msg)
"""

import socket
import json
import threading
import time


PYAGENT_HOST = '127.0.0.1'
PYAGENT_PORT = 7441


class PyAgentClient:
    """
    PyAgent TCP Socket 客户端。
    支持同步请求和异步消息监听。
    """

    def __init__(self, host=PYAGENT_HOST, port=PYAGENT_PORT, timeout=30):
        self.host    = host
        self.port    = port
        self.timeout = timeout
        self._sock   = None
        self._buf    = ''
        self._lock   = threading.Lock()

    # ─── 连接管理 ──────────────────────────────────────────────────────────────

    def connect(self):
        """连接到 PyAgent"""
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.settimeout(self.timeout)
        self._sock.connect((self.host, self.port))
        return self

    def close(self):
        """关闭连接"""
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None

    def __enter__(self):
        return self.connect()

    def __exit__(self, *_):
        self.close()

    # ─── 发送 ──────────────────────────────────────────────────────────────────

    def _send(self, action, params=None):
        """发送 action 消息"""
        msg = {'action': action}
        if params:
            msg['params'] = params
        data = json.dumps(msg, ensure_ascii=False) + '\n'
        with self._lock:
            self._sock.sendall(data.encode('utf-8'))

    # ─── 接收 ──────────────────────────────────────────────────────────────────

    def _recv_one(self):
        """阻塞接收一条 JSON 消息"""
        while '\n' not in self._buf:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise ConnectionError('PyAgent 连接已关闭')
            self._buf += chunk.decode('utf-8', errors='replace')
        line, self._buf = self._buf.split('\n', 1)
        return json.loads(line.strip())

    # ─── 高级 API ──────────────────────────────────────────────────────────────

    def ping(self):
        """发送 ping，返回 True 表示连接正常"""
        self._send('ping')
        resp = self._recv_one()
        return resp.get('type') == 'pong'

    def status(self, session_id='default'):
        """查询 agent 状态"""
        self._send('status', {'sessionId': session_id})
        return self._recv_one()

    def start_agent(self, task, model='claude-sonnet-4.6', session_id='default', **kwargs):
        """启动 agent 任务"""
        params = {'task': task, 'model': model, 'sessionId': session_id, **kwargs}
        self._send('start', params)
        return self._recv_one()

    def stop_agent(self, session_id='default'):
        """停止 agent"""
        self._send('stop', {'sessionId': session_id})
        return self._recv_one()

    def continue_agent(self, session_id='default', user_input=''):
        """继续等待中的 agent"""
        self._send('continue', {'sessionId': session_id, 'input': user_input})
        return self._recv_one()

    def subscribe(self, session_id='default'):
        """订阅 sessionId 的 agent 输出广播"""
        self._send('subscribe', {'sessionId': session_id})
        return self._recv_one()

    def listen(self):
        """
        持续生成接收到的消息（生成器）。
        用于订阅后持续接收 agent 输出。
        """
        while True:
            try:
                msg = self._recv_one()
                yield msg
            except (ConnectionError, json.JSONDecodeError):
                break

    @staticmethod
    def is_running(host=PYAGENT_HOST, port=PYAGENT_PORT):
        """检查 PyAgent 是否已在运行"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2)
            s.connect((host, port))
            s.close()
            return True
        except Exception:
            return False
