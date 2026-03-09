const http = require('http');

const SESSION_ID = 'session-1773060372155.md';
const SERVER_URL = 'http://localhost:7439';
const POLL_INTERVAL = 30000; // 30 seconds
const MAX_ITERATIONS = 100;

console.log('Starting Alice Agent Poll Loop');
console.log(`SessionID: ${SESSION_ID}`);
console.log(`Server: ${SERVER_URL}`);
console.log(`Poll Interval: ${POLL_INTERVAL}ms`);
console.log('---\n');

// First, check if server is running
console.log('Step 1: Checking if server is running...');
const checkReq = http.get(`${SERVER_URL}/agent/input?sessionId=${SESSION_ID}`, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    console.log(`✓ Server responded with status ${res.statusCode}`);
    try {
      const json = JSON.parse(data);
      console.log('Initial Response:', JSON.stringify(json, null, 2));
    } catch(e) {
      console.log('Response:', data);
    }
    console.log('\nStep 2: Starting POLL loop...\n');
    startPolling();
  });
});

checkReq.on('error', (e) => {
  console.log(`✗ Server not reachable: ${e.message}`);
  process.exit(1);
});

checkReq.end();

function startPolling() {
  let count = 0;
  
  function poll() {
    if (count >= MAX_ITERATIONS) { 
      console.log(`\n✗ POLL TIMEOUT - reached ${MAX_ITERATIONS} iterations (${MAX_ITERATIONS * 30 / 60} minutes)`);
      process.exit(0);
      return; 
    }
    
    count++;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Iteration ${count}/${MAX_ITERATIONS}: Polling for new tasks...`);
    
    const getReq = http.get(`${SERVER_URL}/agent/input?sessionId=${SESSION_ID}`, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`  Response: ${JSON.stringify(json)}`);
          
          if (json.hasContent && json.content) { 
            console.log(`\n✓ NEW_TASK RECEIVED:`);
            console.log(`  Content: ${json.content}`);
            console.log(`  Full Response: ${JSON.stringify(json, null, 2)}`);
            process.exit(0);
            return;
          }
        } catch(e) {
          console.log(`  Parse Error: ${e.message}`);
        }
        
        // Schedule next poll
        const nextTime = new Date(Date.now() + POLL_INTERVAL).toISOString();
        console.log(`  Waiting until ${nextTime}...\n`);
        setTimeout(poll, POLL_INTERVAL);
      });
    });
    
    getReq.on('error', (e) => { 
      console.log(`  Error: ${e.message}`);
      console.log(`  Retrying in ${POLL_INTERVAL/1000}s...\n`);
      setTimeout(poll, POLL_INTERVAL);
    });
    
    getReq.end();
  }
  
  poll();
}
