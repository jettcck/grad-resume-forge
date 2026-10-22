'use strict';

// ============================================================
//  统一的 Electron 启动包装
//
//  为什么需要它：本机（以及某些 CI / IDE 终端）会常驻 `ELECTRON_RUN_AS_NODE=1`，
//  此时 `electron xxx` 会退化成纯 Node 进程：
//    - `electron .`         → 不启动应用，require('electron') 拿到的是路径字符串
//    - `electron script.js` → 脚本里 app 是 undefined，报 cannot read ... whenReady
//  表现是「命令跑完了但什么都没发生」，极难排查。
//
//  这里剥掉该变量再 spawn，让 `npm start` / `npm run dev` / 各 smoke 入口开箱可用。
//  test-contract 有一条断言守着「npm script 不许直接调 electron」。
//
//  用法：
//    node scripts/run-electron.js .                 # 等同 electron .
//    node scripts/run-electron.js scripts/screenshot.js --no-sandbox
//    node scripts/run-electron.js --print-exe       # 只打印 Electron 可执行文件路径
// ============================================================
const { spawn } = require('child_process');

// require('electron') 在 Node 环境下返回的是可执行文件路径（不是模块）
const electronPath = require('electron');
if (typeof electronPath !== 'string') {
  console.error('[run-electron] require("electron") 没有返回可执行文件路径，请确认已安装 electron');
  process.exit(1);
}

const args = process.argv.slice(2);

if (args[0] === '--print-exe') {
  console.log(electronPath);
  process.exit(0);
}
if (!args.length) {
  console.error('用法: node scripts/run-electron.js <入口> [参数...]');
  process.exit(1);
}

const env = Object.assign({}, process.env);
// 关键：不剥掉这个变量，Electron 会当成 Node 跑
delete env.ELECTRON_RUN_AS_NODE;
// Electron 自带的 Node 不应被外部 NODE_OPTIONS 干扰（比如 --inspect 冲突）
delete env.NODE_OPTIONS;

const child = spawn(electronPath, args, { stdio: 'inherit', env, windowsHide: false });

child.on('error', (err) => {
  console.error('[run-electron] 启动失败: ' + err.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    // 被信号杀掉时如实转达，不要把 0 当成功
    console.error('[run-electron] 进程被信号终止: ' + signal);
    process.exit(1);
  }
  process.exit(code == null ? 1 : code);
});
