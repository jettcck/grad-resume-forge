'use strict';

// ============================================================
//  双开自测 · worker：设置隔离的 userData 后加载【真实主进程】。
//  与父脚本（smoke-single-instance.js）的约定：
//    - 拿到锁的实例：窗口就绪后写 <role>_READY；收到 second-instance 写 <role>_GOT_SECOND
//    - 没拿到锁的实例：main.ts 会直接 app.quit()，本 worker 不写任何标记
//  锁的 key 是 userData 路径，所以用环境变量传入的临时目录，不碰真实数据。
// ============================================================
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const dir = process.env.GRF_SI_DIR;
const role = process.env.GRF_SI_ROLE || 'A';
if (!dir || !fs.existsSync(dir)) {
  console.error('缺少 GRF_SI_DIR（父脚本负责创建并传入）');
  app.quit();
  return;
}

const mark = (name) => {
  try { fs.writeFileSync(path.join(dir, name), String(Date.now())); } catch (_) { /* 忽略 */ }
};

app.setPath('userData', dir);

// main.ts 自己也注册了 second-instance（聚焦窗口）；这里多挂一个只做记录，
// 多个监听器都会触发，互不影响
app.on('second-instance', () => mark(role + '_GOT_SECOND'));

// 加载真实主进程（申请锁、注册 IPC、建窗口都在里面）
require(path.join(__dirname, '..', 'dist', 'main', 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  // 没拿到锁的实例正在退出：一个标记都不写，让父脚本能分辨「它退了」
  if (!app.hasSingleInstanceLock()) return;
  await sleep(3000); // 等主窗口加载完
  mark(role + '_READY');
  // 兜底：父脚本正常情况下会来 kill；万一没来，30 秒后自杀，不留孤儿进程
  setTimeout(() => { try { app.exit(0); } catch (_) { /* 忽略 */ } }, 30000);
});
