const http = require('http');
const body = JSON.stringify({command: 'Stop-Process -Id 13268 -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Start-Process -FilePath node -ArgumentList "E:\\docs-service\\server.js" -WorkingDirectory "E:\\docs-service" -WindowStyle Hidden'});
const req = http.request({hostname:'localhost',port:7439,path:'/tools/shell',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, r => {
  let s=''; r.on('data',d=>s+=d); r.on('end',()=>console.log('Status:', r.statusCode, s.slice(0,300)));
});
req.write(body); req.end();
