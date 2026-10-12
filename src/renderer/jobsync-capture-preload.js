'use strict';

// ============================================================
//  同步窗口平台视图的 preload —— 只做一件事：把页面自己发出的
//  JSON 响应旁路回传主进程。
//
//  为什么不用 CDP：debugger.attach('1.3') 会冻结该 webContents 的首帧
//  产出与脚本执行通道 —— loadURL 永不 resolve、executeJavaScript 永不返回、
//  win.show() 都会阻塞主进程，最终就是一个纯白窗口（实测可复现）。
//  改成在 preload 里包装 fetch / XMLHttpRequest，页面正常渲染的同时
//  把响应体送出去，完全不影响渲染管线。
//
//  边界：只读。不修改任何请求、不伪造 cookie、不写入任何东西。
// ============================================================

const { ipcRenderer } = require('electron');

const MAX_BODY = 4 * 1024 * 1024;
const CHANNEL = 'jobsync:captured';

function report(url, text) {
  try {
    if (!text) return;
    const s = String(text).trim();
    if (s.length > MAX_BODY) return;
    if (s[0] !== '{' && s[0] !== '[') return;
    ipcRenderer.send(CHANNEL, { url: String(url || ''), body: s });
  } catch (_) { /* 采集失败绝不影响页面 */ }
}

// ---- fetch ----
try {
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      const target = args[0];
      const url = typeof target === 'string' ? target : (target && target.url) || '';
      const p = originalFetch.apply(this, args);
      try {
        p.then((res) => {
          try {
            res.clone().text().then((t) => report(url, t)).catch(() => { /* 忽略 */ });
          } catch (_) { /* 忽略 */ }
        }).catch(() => { /* 页面自己的失败不干预 */ });
      } catch (_) { /* 忽略 */ }
      return p;
    };
  }
} catch (_) { /* 忽略 */ }

// ---- XMLHttpRequest ----
try {
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__grfUrl = String(url || ''); } catch (_) { /* 忽略 */ }
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      this.addEventListener('load', () => {
        try {
          const type = this.responseType;
          if (type === '' || type === 'text') report(this.__grfUrl, this.responseText);
        } catch (_) { /* 忽略 */ }
      });
    } catch (_) { /* 忽略 */ }
    return send.apply(this, args);
  };
} catch (_) { /* 忽略 */ }
