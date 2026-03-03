const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8033;
const BASE_DIR = path.dirname(__filename);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/restart') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '正在重启爱丽丝服务...' }));

    setTimeout(() => {
      const child = spawn('cmd.exe', ['/c', 'start', '', path.join(BASE_DIR, 'rundoc.bat')], {
        detached: true,
        stdio: 'ignore',
        cwd: BASE_DIR,
      });
      child.unref();
    }, 200);

  } else if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: 'running', port: PORT }));

  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`重启服务已启动: http://localhost:${PORT}`);
  console.log('  POST /restart — 重启爱丽丝');
  console.log('  GET  /status  — 状态检查');
});
