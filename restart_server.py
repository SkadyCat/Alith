#!/usr/bin/env python3
"""
Restart docs-service server via HTTP POST to /tools/shell endpoint
"""

import json
import time
import urllib.request
import urllib.error

base_url = 'http://localhost:7439'

# PowerShell command to kill node processes and restart server
command_1 = "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 2; Start-Process -FilePath 'node' -ArgumentList 'E:\\docs-service\\server.js' -WorkingDirectory 'E:\\docs-service' -WindowStyle Hidden"

print('[1] Sending restart command to /tools/shell endpoint...')
print(f'Command: {command_1}\n')

success = False
try:
    payload = json.dumps({'command': command_1}).encode('utf-8')
    req = urllib.request.Request(
        f'{base_url}/tools/shell',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        result = response.read().decode('utf-8')
        print(f'✓ Status Code: {response.status}')
        print(f'✓ Response: {result}\n')
        success = True
except urllib.error.URLError as e:
    print(f'✗ Error with primary command: {e}\n')
    print('[2] Trying fallback command...')
    
    # Fallback CMD command
    command_2 = 'taskkill /F /IM node.exe & timeout /t 2 & start /B node E:\\docs-service\\server.js'
    print(f'Fallback Command: {command_2}\n')
    
    try:
        payload = json.dumps({'command': command_2}).encode('utf-8')
        req = urllib.request.Request(
            f'{base_url}/tools/shell',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            result = response.read().decode('utf-8')
            print(f'✓ Fallback Status Code: {response.status}')
            print(f'✓ Fallback Response: {result}\n')
            success = True
    except Exception as e2:
        print(f'✗ Fallback also failed: {e2}\n')

print('[3] Waiting 3 seconds for server to start...')
time.sleep(3)

print('[4] Verifying server is running with GET to /api/tree...')
try:
    req = urllib.request.Request(f'{base_url}/api/tree', method='GET')
    with urllib.request.urlopen(req, timeout=10) as response:
        result = response.read().decode('utf-8')
        print(f'✓ Status Code: {response.status}')
        print(f'✓ Response length: {len(result)} bytes')
        if len(result) > 500:
            print(f'✓ Response preview: {result[:500]}...')
        else:
            print(f'✓ Response: {result}')
        print('\n✓✓✓ Server is running! ✓✓✓')
except Exception as e:
    print(f'✗ Server verification failed: {e}')
    print(f'✗ Server may not be running yet or endpoint is not accessible')
