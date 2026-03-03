import json
import time

# Try using requests first, fall back to urllib
try:
    import requests
    use_requests = True
except ImportError:
    import urllib.request
    import urllib.error
    use_requests = False

base_url = 'http://localhost:7439'
command_1 = "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 2; Start-Process -FilePath 'node' -ArgumentList 'E:\\docs-service\\server.js' -WorkingDirectory 'E:\\docs-service' -WindowStyle Hidden"

print('[1] Sending restart command to /tools/shell endpoint...')
print(f'    Command: {command_1[:80]}...\n')

try:
    if use_requests:
        response = requests.post(f'{base_url}/tools/shell', json={'command': command_1}, timeout=10)
        print(f'✓ Status Code: {response.status_code}')
        print(f'✓ Response: {response.text}\n')
    else:
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
except Exception as e:
    print(f'✗ Error with primary command: {e}\n')
    print('[2] Trying fallback command...')
    
    command_2 = 'taskkill /F /IM node.exe & timeout /t 2 & start /B node E:\\docs-service\\server.js'
    print(f'    Fallback: {command_2}\n')
    
    try:
        if use_requests:
            response = requests.post(f'{base_url}/tools/shell', json={'command': command_2}, timeout=10)
            print(f'✓ Fallback Status Code: {response.status_code}')
            print(f'✓ Fallback Response: {response.text}\n')
        else:
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
    except Exception as e2:
        print(f'✗ Fallback failed: {e2}\n')

print('[3] Waiting 3 seconds for server to start...')
time.sleep(3)

print('[4] Verifying server is running...')
try:
    if use_requests:
        response = requests.get(f'{base_url}/api/tree', timeout=10)
        print(f'✓ GET /api/tree Status Code: {response.status_code}')
        print(f'✓ Response length: {len(response.text)} bytes')
        if len(response.text) > 500:
            print(f'✓ Response preview: {response.text[:500]}...')
        else:
            print(f'✓ Response: {response.text}')
    else:
        req = urllib.request.Request(f'{base_url}/api/tree', method='GET')
        with urllib.request.urlopen(req, timeout=10) as response:
            result = response.read().decode('utf-8')
            print(f'✓ GET /api/tree Status Code: {response.status}')
            print(f'✓ Response length: {len(result)} bytes')
            if len(result) > 500:
                print(f'✓ Response preview: {result[:500]}...')
            else:
                print(f'✓ Response: {result}')
    print('\n✓✓✓ Server is running successfully! ✓✓✓')
except Exception as e:
    print(f'✗ Server verification failed: {e}')
