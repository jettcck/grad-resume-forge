'use strict';

// ============================================================
//  同步窗口平台视图的 preload —— 只做一件事：把页面**主世界**发出去的
//  JSON 响应旁路回传主进程。
//
//  注入策略（document-start，早于页面自己的任何脚本）：
//    1) 本文件在 document-start 用 webFrame.executeJavaScript 把采集脚本注入
//       **页面主世界**。preload 自己跑在隔离世界，直接在这里包 window.fetch
//       包不到页面自己脚本里的 fetch（实测：钩子白装，已捕获 0 个响应）。
//    2) 主进程在 dom-ready / 主框架加载完成 / 导航时再注入一次兜底
//       （见 job-sync.ts 的 injectCapture）——万一 webFrame 注入被拦，
//       SPA 的数据请求（渲染后才发出）仍然接得到。
//    3) 脚本内容由主进程通过 sendSync('jobsync:script') 提供，单一来源，
//       两边不会各写一份然后悄悄漂移。
//
//  ⚠️ 踩过的坑（都表现为「已捕获 0 个响应」）：
//    a) 本文件路径曾指向 dist/renderer —— tsconfig 排除了 src/renderer，
//       该目录不存在，preload 静默加载失败。现在路径指向 src/renderer。
//    b) 曾用 event.source 与本世界 window 的相等判断过滤跨帧消息 —— 两个世界
//       的 window 不是同一个对象，那个判断会把所有采集消息全部丢掉。
//
//  边界：只读。不修改任何请求、不伪造 cookie、不写入任何东西。
// ============================================================

const { ipcRenderer, webFrame } = require('electron');

const CHANNEL = 'jobsync:captured';
const PAGE_CHANNEL = '__grf_jobsync_capture';
const MAX_BODY = 4 * 1024 * 1024;

function report(url, text) {
  try {
    if (!text) return;
    const s = String(text).trim();
    if (s.length > MAX_BODY) return;
    if (s[0] !== '{' && s[0] !== '[') return; // 只收 JSON
    ipcRenderer.send(CHANNEL, { url: String(url || ''), body: s });
  } catch (_) { /* 采集失败绝不影响页面 */ }
}

// ---- document-start 注入到页面主世界 ----
try {
  const src = ipcRenderer.sendSync('jobsync:script');
  if (typeof src === 'string' && src) {
    webFrame.executeJavaScript(src);
  }
} catch (_) { /* 注入失败时由主进程的兜底注入接管 */ }

// 主世界 → 隔离世界（本文件）→ 主进程。
// 不能拿 event.source 和本世界的 window 做相等判断：两个世界的 window 不是
// 同一个对象，那样会把所有采集消息全部丢掉。
window.addEventListener('message', (event) => {
  try {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.__grfJobsync === PAGE_CHANNEL) {
      report(d.url, d.body);
      return;
    }
    // 采集脚本注入成功后的就绪回执
    if (d.__grfJobsyncReady) {
      ipcRenderer.send('jobsync:probe', { ready: true, url: String(d.url || '') });
    }
  } catch (_) { /* 忽略 */ }
});
