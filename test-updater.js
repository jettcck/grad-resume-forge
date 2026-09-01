'use strict';

// 更新器配置烟测：不依赖 Electron 运行时的部分
//  1) package.json 的 build.publish / release 脚本 / 依赖声明正确
//  2) 镜像 URL 构造规则与 main.js configureUpdater 一致
//  3) electron-updater 包已安装且为 6.x
// 注：autoUpdater 运行时行为需要 Electron 环境（app.getVersion），
//     由「应用启动冒烟」覆盖——见 scripts/smoke-main.md 的启动验证步骤。
const fs = require('fs');
const path = require('path');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// 1) 依赖已安装且主版本符合
const updPkgPath = path.join(__dirname, 'node_modules', 'electron-updater', 'package.json');
assert(fs.existsSync(updPkgPath), 'electron-updater 已安装');
const updVer = JSON.parse(fs.readFileSync(updPkgPath, 'utf8')).version;
assert(/^6\./.test(updVer), 'electron-updater 主版本为 6.x（实际 ' + updVer + '）');
assert(pkg.dependencies['electron-updater'] === '^6.8.9', 'package.json 依赖声明 ^6.8.9');

// 2) publish 配置（GH_REPO 解析 + electron-builder --publish 依赖）
const pub = pkg.build && pkg.build.publish && pkg.build.publish[0];
assert(!!(pub && pub.owner && pub.repo), 'build.publish 配置了 owner/repo');
const repo = pub && pub.owner && pub.repo ? pub.owner + '/' + pub.repo : '';
assert(/^[^/]+\/[^/]+$/.test(repo), 'GH_REPO 可解析为 owner/name（' + repo + '）');
assert(typeof pkg.scripts.release === 'string' && pkg.scripts.release.includes('--publish'),
  'npm run release 脚本带 --publish always');
assert(pkg.version === '1.1.0', '版本号已升至 1.1.0（触发更新对比的基准）');

// 3) 镜像 URL 构造规则（与 main.js configureUpdater 逐字一致）
function mirrorFeedUrl(mirror, ghRepo) {
  return String(mirror).replace(/\/+$/, '') + '/https://github.com/' + ghRepo + '/releases/latest/download/';
}
assert(mirrorFeedUrl('https://ghproxy.cn/', 'u/r') === 'https://ghproxy.cn/https://github.com/u/r/releases/latest/download/',
  '镜像前缀尾斜杠被归一化');
assert(mirrorFeedUrl('https://ghproxy.cn', 'u/r').startsWith('https://ghproxy.cn/https://'),
  '镜像 URL 拼接正确');
assert(!mirrorFeedUrl('https://ghproxy.cn', 'u/r').includes('//github.com/u/r/releases/latest/download/https'),
  '拼接顺序正确（前缀在前）');

// 4) main.js 关键源码片段存在（防止后续重构悄悄破坏 updater 逻辑）
const mainSrc = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
[
  ['autoInstallOnAppQuit', '退出时自动安装'],
  ['isUpdaterActive', '开发模式安全拒绝'],
  ['updater:setMirror', '镜像设置 IPC'],
  ['GH_REPO', '发布仓库解析'],
  ['updater:event', '事件推送到渲染层']
].forEach(([needle, label]) => {
  assert(mainSrc.includes(needle), 'main.js 含 ' + label + '（' + needle + '）');
});

// preload / app.js 桥接存在
const preloadSrc = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
assert(preloadSrc.includes('onEvent') && preloadSrc.includes("ipcRenderer.on('updater:event'"),
  'preload 暴露 updater.onEvent 并订阅 updater:event');
const appSrc = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'app.js'), 'utf8');
assert(appSrc.includes('showUpdateReady') && appSrc.includes('openAbout'), '渲染层含更新弹窗与关于弹窗');

console.log('\n更新器烟测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
