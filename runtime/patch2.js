const fs = require('fs');
const FILE = 'E:/docs-service/routes/agent.js';
let src = fs.readFileSync(FILE, 'utf-8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';

// Fix 1: Add waitSecs declaration to GET /input
const F1_OLD = "router.get('/input', (req, res) => {" + nl + "  const sessionId = String(req.query.sessionId || 'default');" + nl + "  try {";
const F1_NEW = "router.get('/input', (req, res) => {" + nl + "  const sessionId = String(req.query.sessionId || 'default');" + nl + "  const waitSecs = Math.min(Math.max(parseInt(req.query.wait || '0', 10) || 0, 0), 60);" + nl + "  try {";
if (src.includes(F1_OLD)) {
  src = src.replace(F1_OLD, F1_NEW);
  console.log('Fix1 OK');
} else { console.log('Fix1 FAIL'); }

// Fix 2: wakeInputWaiters in POST /input
const F2_MARKER = "savedTo = gent/chat//waitprocess/;";
const F2_IDX = src.indexOf(F2_MARKER);
if (F2_IDX >= 0) {
  const CATCH_STR = "  } catch (_) {}";
  const after = src.indexOf(CATCH_STR, F2_IDX);
  if (after >= 0 && after < F2_IDX + 500) {
    const ins = F2_MARKER + nl + "    // wake long-poll" + nl + "    try { wakeInputWaiters(sessionId); } catch(_) {}" + nl;
    src = src.substring(0, F2_IDX) + ins + src.substring(F2_IDX + F2_MARKER.length);
    console.log('Fix2 OK');
  } else { console.log('Fix2 FAIL: catch not nearby'); }
} else { console.log('Fix2 FAIL: marker not found'); }

fs.writeFileSync(FILE, src, 'utf-8');
const v = fs.readFileSync(FILE, 'utf-8');
console.log('waitSecs OK:', v.includes('const waitSecs = Math'));
console.log('wakeCount:', (v.match(/wakeInputWaiters/g)||[]).length);
