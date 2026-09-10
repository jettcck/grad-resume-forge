'use strict';

// ============================================================
//  探针：验证渲染层加载 web-llm 的可行路径（一次性诊断脚本，可删）
//  1) file:// 下动态 import node_modules 里的 ESM 是否可行（CSP/webSecurity）
//  2) CSP connect-src 是否放行 hf-mirror / gh-proxy 外部 fetch（只看响应头即取消流）
//  3) WebGPU 是否可用
//  运行：npx electron scripts/probe-webllm.js --no-sandbox --disable-gpu
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PROBE_HTML = path.join(ROOT, 'src', 'renderer', 'probe-tmp.html');

// 与 src/renderer/index.html 同构的 CSP + 计划新增的 connect-src/script-src
const CSP = "default-src 'self' 'unsafe-inline' data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://hf-mirror.com https://huggingface.co https://gh-proxy.com https://cdn.jsdelivr.net https://raw.githubusercontent.com; script-src 'self' 'unsafe-inline' data:;";

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
</head><body>
<script>
(async () => {
  const out = (k, v) => { console.log('[probe] ' + k + ' :: ' + v); };

  // 1) 动态 import web-llm（相对路径，dev 与 asar 打包下同构）
  try {
    const m = await import('../../node_modules/@mlc-ai/web-llm/lib/index.js');
    const rec = m.prebuiltAppConfig && m.prebuiltAppConfig.model_list &&
      m.prebuiltAppConfig.model_list.find((r) => r.model_id === 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
    out('import-webllm', 'OK exports=' + Object.keys(m).length +
      ' CreateMLCEngine=' + (typeof m.CreateMLCEngine) +
      ' prebuiltModels=' + (m.prebuiltAppConfig && m.prebuiltAppConfig.model_list ? m.prebuiltAppConfig.model_list.length : 'n/a'));
    out('model-record', rec ? JSON.stringify({ model: rec.model, model_lib: rec.model_lib, vram: rec.vram_required_MB }) : 'NOT FOUND');
  } catch (e) {
    out('import-webllm', 'ERR ' + (e && e.message));
  }

  // 2) CSP connect-src + 镜像连通性：拿到响应头即取消，不真下大文件
  const urls = [
    ['hf-mirror', 'https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json'],
    ['gh-proxy-lib', 'https://gh-proxy.com/https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm'],
    ['hf-direct', 'https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json']
  ];
  for (const [name, url] of urls) {
    try {
      const t0 = performance.now();
      const r = await fetch(url, { headers: { Range: 'bytes=0-99' } });
      const ms = Math.round(performance.now() - t0);
      const status = r.status;
      try { if (r.body) await r.body.cancel(); } catch (_) { /* 忽略 */ }
      out('fetch-' + name, status + ' (' + ms + 'ms)');
    } catch (e) {
      out('fetch-' + name, 'ERR ' + (e && e.message));
    }
  }

  // 3) WebGPU
  try {
    const gpu = navigator.gpu;
    if (!gpu) out('webgpu', 'no navigator.gpu');
    else {
      const a = await gpu.requestAdapter();
      out('webgpu', a ? 'adapter OK' : 'requestAdapter returned null');
    }
  } catch (e) { out('webgpu', 'ERR ' + (e && e.message)); }

  out('done', 'probe complete');
})();
</script>
</body></html>`;

app.whenReady().then(async () => {
  fs.writeFileSync(PROBE_HTML, html);
  const win = new BrowserWindow({
    width: 900, height: 700, show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    if (String(msg).includes('[probe]')) console.log(msg);
  });
  await win.loadFile(PROBE_HTML);
  setTimeout(() => {
    try { fs.unlinkSync(PROBE_HTML); } catch (_) { /* 忽略 */ }
    app.exit(0);
  }, 45000);
});
