'use strict';
// 本地 electron-builder 二进制源：绕过 GitHub 直连与 winCodeSign 符号链接问题
// 用法：node scripts/local-bin-source.js <serveDir> <port>
const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 17891);

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(dir, urlPath);
  console.log(`[bin-source] ${req.method} ${urlPath}`);
  if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(file).size);
  fs.createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[bin-source] serving ${dir} at http://127.0.0.1:${port}/`);
});
