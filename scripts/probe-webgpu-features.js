'use strict';

// ============================================================
//  探针：WebGPU 适配器能力——是否支持 shader-f16（q4f16 模型的硬要求）
//  e2e 探针在 shader 编译（entryPoint: index_kernel）失败，
//  高度怀疑 q4f16 的 f16 shader 在无 shader-f16 特性的 GPU 上编译不过。
//  运行：npx electron scripts/probe-webgpu-features.js --no-sandbox
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PROBE_HTML = path.join(ROOT, 'src', 'renderer', 'probe-gpufeat-tmp.html');

const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf-8');
const CSP = (indexHtml.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1];

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
</head><body>
<script>
(async () => {
  const out = (k, v) => console.log('[gpu] ' + k + ' :: ' + v);
  try {
    const gpu = navigator.gpu;
    if (!gpu) { out('adapter', 'no navigator.gpu'); return; }
    const adapter = await gpu.requestAdapter();
    if (!adapter) { out('adapter', 'null'); return; }

    // 适配器信息（厂商/架构，判断是不是软渲染）
    try {
      const info = adapter.info || {};
      out('adapter-info', 'vendor=' + (info.vendor || '?') + ' arch=' + (info.architecture || '?') + ' desc=' + (info.description || '?').slice(0, 60));
    } catch (e) { out('adapter-info', 'ERR ' + (e && e.message)); }

    // 特性清单
    const feats = [];
    try { adapter.features.forEach((f) => feats.push(f)); } catch (_) {} // eslint-disable-line no-empty
    out('features', feats.join(', ') || '(空)');
    out('shader-f16', adapter.features.has('shader-f16') ? '支持' : '不支持（q4f16 模型会编译失败 → 必须回退 q4f32）');

    // 试着按 f16 建设备（WebLLM 内部的做法）
    try {
      const dev = await gpu.requestDevice({ requiredFeatures: ['shader-f16'] });
      out('device-f16', dev ? 'OK（可建 f16 设备）' : 'null');
      try { dev.destroy ? dev.destroy() : null; } catch (_) {} // eslint-disable-line no-empty
    } catch (e) { out('device-f16', 'ERR ' + (e && e.message)); }

    // 真编译一个最小 f16 计算着色器（比 features 标记更硬的证据）
    try {
      const dev2 = await gpu.requestDevice();
      const mod = dev2.createShaderModule({ code:
        'enable f16;\\n' +
        '@compute @workgroup_size(1)\\n' +
        'fn main(@builtin(global_invocation_id) gid: vec3u) { let x: f16 = f16(1.0); }'
      });
      await mod.getCompilationInfo();
      out('f16-shader-compile', mod.getCompilationInfo ? 'submitted（见下一条信息）' : 'n/a');
      const ci = await mod.getCompilationInfo();
      const errs = ci.messages.filter((m) => m.type === 'error').map((m) => m.message).join(' | ');
      out('f16-shader-result', errs ? 'ERRORS: ' + errs.slice(0, 160) : 'OK（f16 着色器可编译）');
    } catch (e) { out('f16-shader-compile', 'ERR ' + (e && e.message)); }

    // 对照组：普通 f32 着色器
    try {
      const dev3 = await gpu.requestDevice();
      const mod3 = dev3.createShaderModule({ code:
        '@compute @workgroup_size(1)\\n' +
        'fn main(@builtin(global_invocation_id) gid: vec3u) { let x: f32 = 1.0; }'
      });
      const ci3 = await mod3.getCompilationInfo();
      const errs3 = ci3.messages.filter((m) => m.type === 'error').map((m) => m.message).join(' | ');
      out('f32-shader-result', errs3 ? 'ERRORS: ' + errs3.slice(0, 160) : 'OK（f32 着色器可编译）');
    } catch (e) { out('f32-shader-compile', 'ERR ' + (e && e.message)); }
  } catch (e) { out('FAIL', (e && e.message)); }
  out('done', 'gpu features probe complete');
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
    if (String(msg).includes('[gpu]')) console.log(msg);
  });
  await win.loadFile(PROBE_HTML);
  setTimeout(() => {
    try { fs.unlinkSync(PROBE_HTML); } catch (_) { /* 忽略 */ }
    app.exit(0);
  }, 30000);
});
