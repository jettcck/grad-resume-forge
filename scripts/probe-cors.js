'use strict';

// ============================================================
//  探针：渲染层（CORS 强制生效）拉取被 302 的 LFS 分片
//  Node fetch 不查 CORS，之前 206 不代表浏览器里能过。
//  运行：npx electron scripts/probe-cors.js --no-sandbox
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PROBE_HTML = path.join(ROOT, 'src', 'renderer', 'probe-cors-tmp.html');

const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf-8');
const CSP = (indexHtml.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1];

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
</head><body>
<script>
(async () => {
  const out = (k, v) => console.log('[cors] ' + k + ' :: ' + v);
  const shard = 'https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/params_shard_0.bin';

  // 1) 默认 cors 模式 + Range（web-llm 的 cache.add 就是 cors 模式 GET，只是无 Range）
  try {
    const r = await fetch(shard, { headers: { Range: 'bytes=0-99' } });
    out('cors-mode', r.status + ' final=' + new URL(r.url).host + ' acao=' + (r.headers.get('access-control-allow-origin') || '(无)'));
    try { if (r.body) await r.body.cancel(); } catch (_) {} // eslint-disable-line no-empty
  } catch (e) { out('cors-mode', 'ERR ' + (e && e.message)); }

  // 2) no-cors 模式（opaque，拿不到状态但能测通不通）
  try {
    const r2 = await fetch(shard, { mode: 'no-cors', headers: { Range: 'bytes=0-99' } });
    out('no-cors-mode', 'type=' + r2.type + ' status=' + r2.status + '（opaque=0 正常）');
    try { if (r2.body) await r2.body.cancel(); } catch (_) {} // eslint-disable-line no-empty
  } catch (e) { out('no-cors-mode', 'ERR ' + (e && e.message)); }

  // 3) 全量 GET（不带 Range，复刻 cache.add 的请求形态，下完即弃）
  try {
    const t0 = performance.now();
    const r3 = await fetch(shard);
    const buf = await r3.arrayBuffer();
    out('cors-full-get', r3.status + ' ' + (buf.byteLength / 1048576).toFixed(1) + 'MB in ' + ((performance.now() - t0) / 1000).toFixed(1) + 's final=' + new URL(r3.url).host);
  } catch (e) { out('cors-full-get', 'ERR ' + (e && e.message)); }

  out('done', 'cors probe complete');
})();
</script>
</body></html>`;

app.whenReady().then(async () => {
  fs.writeFileSync(PROBE_HTML, html);
  const win = new BrowserWindow({
    width: 900, height: 700, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    if (String(msg).includes('[cors]')) console.log(msg);
  });
  await win.loadFile(PROBE_HTML);
  setTimeout(() => {
    try { fs.unlinkSync(PROBE_HTML); } catch (_) { /* 忽略 */ }
    app.exit(0);
  }, 300000);
});
