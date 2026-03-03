#!/usr/bin/env python3
"""
DocSpace Python Tool Runner
===========================
从 stdin 读取 Python 代码并在沙箱环境中执行，将结果以 JSON 输出到 stdout。

用法:
    echo "print('hello')" | python tools/python_runner.py
    python tools/python_runner.py < script.py

返回 (JSON):
    { "stdout": "...", "stderr": "...", "exitCode": 0 }
"""

import sys
import io
import os
import json
import traceback

# ── 预置常用模块，供执行代码直接使用 ──────────────────────────────────────
import re
import math
import time
import datetime
import hashlib
import base64
import urllib.parse
import collections
import itertools

# 可选模块（不报错）
try: import requests
except ImportError: pass
try: import json as _json
except ImportError: pass


def run_code(code: str):
    """执行代码字符串，返回 (stdout, stderr, exit_code)"""
    buf_out = io.StringIO()
    buf_err = io.StringIO()
    exit_code = 0

    # 构建执行上下文（注入预置模块）
    ctx = {
        '__name__': '__main__',
        '__file__': '<input>',
        're': re, 'math': math, 'os': os, 'sys': sys,
        'time': time, 'datetime': datetime, 'hashlib': hashlib,
        'base64': base64, 'urllib': urllib, 'json': json,
        'collections': collections, 'itertools': itertools,
    }
    try:
        ctx['requests'] = requests  # type: ignore
    except NameError:
        pass

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = buf_out
    sys.stderr = buf_err

    try:
        compiled = compile(code, '<input>', 'exec')
        exec(compiled, ctx)
    except SystemExit as e:
        exit_code = int(e.code) if e.code is not None else 0
    except Exception:
        buf_err.write(traceback.format_exc())
        exit_code = 1
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    return buf_out.getvalue(), buf_err.getvalue(), exit_code


def main():
    code = sys.stdin.read()
    if not code.strip():
        result = {'stdout': '', 'stderr': 'No code provided', 'exitCode': 1}
    else:
        stdout, stderr, exit_code = run_code(code)
        result = {'stdout': stdout, 'stderr': stderr, 'exitCode': exit_code}

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
