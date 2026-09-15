'use strict';

// ============================================================
//  双开自测：第二个实例必须「拿不到锁 → 自己退出」，第一个实例
//  收到 second-instance 事件并保持存活。验证的是真实主进程
//  （dist/main/main.js），不是 mock。
//  运行：node scripts/smoke-single-instance.js（或 npm run smoke:si）
// ============================================================
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 普通 node 里 require('electron') 得到的是 electron 可执行文件的路径
const electronPath = require('electron');
const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-si-'));

let pass = 0, failCnt = 0;
const t = (cond, msg) => {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (f) => fs.existsSync(path.join(dir, f));

function spawnWorker(role) {
  return spawn(electronPath, [
    path.join(__dirname, 'smoke-single-instance-worker.js'),
    '--no-sandbox', '--disable-gpu'
  ], {
    cwd: root,
    env: Object.assign({}, process.env, { GRF_SI_DIR: dir, GRF_SI_ROLE: role }),
    stdio: 'inherit' // 不用管道（沙箱下受限），直接打到本进程的控制台
  });
}

(async () => {
  const wd = setTimeout(() => {
    console.error('⏰ 看门狗超时：测试疑似悬挂，强制退出');
    process.exit(1);
  }, 150000).unref();

  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 忽略 */ } };

  // ---------- 第一个实例 ----------
  const a = spawnWorker('A');
  let aReady = false;
  for (let i = 0; i < 60 && !aReady; i++) { await sleep(1000); aReady = exists('A_READY'); }
  t(aReady, '第一个实例正常启动（真实主进程 + 窗口就绪）');
  if (!aReady) {
    t(false, '第一个实例 60 秒内未就绪，中止测试');
    try { a.kill(); } catch (_) { /* 忽略 */ }
    await sleep(1500); cleanup();
    process.exit(1);
  }

  // ---------- 第二个实例：应当拿不到锁、自己退出 ----------
  let bCode = null;
  const b = spawnWorker('B');
  b.on('exit', (c) => { bCode = c; });
  for (let i = 0; i < 40 && bCode === null; i++) { await sleep(1000); }
  t(bCode === 0, '第二个实例自己退出且退出码为 0（实际 ' + bCode + '）');
  t(!exists('B_READY'), '第二个实例没有初始化界面（锁住了，不是口头约定）');

  // ---------- 第一个实例的反应 ----------
  await sleep(2500);
  t(exists('A_GOT_SECOND'), '第一个实例收到了 second-instance 事件（会聚焦已有窗口）');
  t(a.exitCode === null, '第一个实例仍然存活，没有被动退出');

  try { a.kill(); } catch (_) { /* 忽略 */ }
  await sleep(1500);
  cleanup();
  clearTimeout(wd);
  console.log('\n单实例锁自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
