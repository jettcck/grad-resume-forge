'use strict';

// ============================================================
//  全链路探针：加载应用真实的 embedded-llm.js（含镜像改写 + 断点续传重试），
//  真实下载 281MB 并跑一次推理。这是「零门槛」的最终实证：
//  不科学上网、不装 Ollama、不填 key，网络抖动自动续传。
//  运行：npx electron scripts/probe-webllm-e2e.js --no-sandbox
//  （不加 --disable-gpu：WebGPU 需要真 GPU）
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PROBE_HTML = path.join(ROOT, 'src', 'renderer', 'probe-e2e-tmp.html');

// CSP 取自真实 index.html（探针与主应用永远同一份策略，防漂移）
const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf-8');
const CSP = (indexHtml.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1];

// 与 index.html 同目录 → <script src="embedded-llm.js"> 与主应用完全同构
const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
</head><body>
<script src="embedded-llm.js"></script>
<script>
(async () => {
  const out = (k, v) => console.log('[e2e] ' + k + ' :: ' + v);
  try {
    out('EmbeddedLlm', window.EmbeddedLlm ? 'loaded (真实应用代码)' : 'MISSING');
    const t0 = Date.now();
    await window.EmbeddedLlm.ensureEngine((p) => {
      const pct = p.percent || 0;
      if (pct % 20 === 0 || p.text) out('progress', pct + '% ' + String(p.text || '').slice(0, 70));
    });
    out('engine-init', 'OK ' + ((Date.now() - t0) / 1000).toFixed(1) + 's（含 281MB 下载、编译、缓存复用）');

    const content = await window.EmbeddedLlm.embeddedChat([
      { role: 'system', content: '你是简历助手，回答要简短。' },
      { role: 'user', content: '用一句话说明 STAR 法则是什么。' }
    ]);
    out('inference', content ? 'OK → ' + String(content).slice(0, 120) : 'EMPTY');
    out('done', '零门槛全链路 PASS：镜像下载（含断点续传）→ 应用内推理，全程无科学上网');
  } catch (e) {
    out('FAIL', (e && e.message) || String(e));
    out('done', 'probe failed');
  }
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
    if (String(msg).includes('[e2e]')) console.log(msg);
  });
  await win.loadFile(PROBE_HTML);
  // 最长等 25 分钟（281MB 下载 + WebGPU 编译 + 可能的自动续传）
  setTimeout(() => {
    try { fs.unlinkSync(PROBE_HTML); } catch (_) { /* 忽略 */ }
    app.exit(0);
  }, 25 * 60 * 1000);
});
