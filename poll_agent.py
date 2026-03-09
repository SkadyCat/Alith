#!/usr/bin/env python3
import http.client
import json
import time
from datetime import datetime

SESSION_ID = 'session-1773060372155.md'
SERVER_HOST = 'localhost'
SERVER_PORT = 7439
POLL_INTERVAL = 30  # seconds
MAX_ITERATIONS = 100

print('Starting Alice Agent Poll Loop')
print(f'SessionID: {SESSION_ID}')
print(f'Server: http://{SERVER_HOST}:{SERVER_PORT}')
print(f'Poll Interval: {POLL_INTERVAL}s')
print('---\n')

# First, check if server is running
print('Step 1: Checking if server is running...')
try:
    conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=10)
    conn.request('GET', f'/agent/input?sessionId={SESSION_ID}')
    response = conn.getresponse()
    data = response.read().decode('utf-8')
    print(f'✓ Server responded with status {response.status}')
    try:
        json_data = json.loads(data)
        print('Initial Response:', json.dumps(json_data, indent=2))
    except:
        print('Response:', data)
    conn.close()
except Exception as e:
    print(f'✗ Server not reachable: {e}')
    exit(1)

print('\nStep 2: Starting POLL loop...\n')

count = 0
while count < MAX_ITERATIONS:
    count += 1
    timestamp = datetime.now().isoformat()
    print(f'[{timestamp}] Iteration {count}/{MAX_ITERATIONS}: Polling for new tasks...')
    
    try:
        conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=10)
        conn.request('GET', f'/agent/input?sessionId={SESSION_ID}')
        response = conn.getresponse()
        data = response.read().decode('utf-8')
        
        try:
            json_data = json.loads(data)
            print(f'  Response: {json.dumps(json_data)}')
            
            if json_data.get('hasContent') and json_data.get('content'):
                print(f'\n✓ NEW_TASK RECEIVED:')
                print(f'  Content: {json_data.get("content")}')
                print(f'  Full Response: {json.dumps(json_data, indent=2)}')
                conn.close()
                break
        except json.JSONDecodeError as e:
            print(f'  Parse Error: {e}')
            print(f'  Raw Response: {data}')
        
        conn.close()
        
        # Schedule next poll
        next_time = datetime.fromtimestamp(time.time() + POLL_INTERVAL).isoformat()
        print(f'  Waiting until {next_time}...\n')
        time.sleep(POLL_INTERVAL)
        
    except Exception as e:
        print(f'  Error: {e}')
        print(f'  Retrying in {POLL_INTERVAL}s...\n')
        time.sleep(POLL_INTERVAL)

if count >= MAX_ITERATIONS:
    print(f'\n✗ POLL TIMEOUT - reached {MAX_ITERATIONS} iterations ({MAX_ITERATIONS * POLL_INTERVAL / 60:.0f} minutes)')
