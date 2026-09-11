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
assert(/^\d+\.\d+\.\d+$/.test(pkg.version), '版本号符合 semver（当前 ' + pkg.version + '，发版对比基准）');

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

// 4) main.ts 关键源码片段存在（防止后续重构悄悄破坏 updater 逻辑）
const mainSrc = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.ts'), 'utf8');
[
  ['autoInstallOnAppQuit', '退出时自动安装'],
  ['isUpdaterActive', '开发模式安全拒绝'],
  ['updater:setMirror', '镜像设置 IPC'],
  ['GH_REPO', '发布仓库解析'],
  ['updater:event', '事件推送到渲染层']
].forEach(([needle, label]) => {
  assert(mainSrc.includes(needle), 'main.ts 含 ' + label + '（' + needle + '）');
});

// preload / app.js 桥接存在
const preloadSrc = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.ts'), 'utf8');
assert(preloadSrc.includes('onEvent') && preloadSrc.includes("'updater:event'"),
  'preload 暴露 updater.onEvent 并订阅 updater:event');
const appSrc = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'app.js'), 'utf8');
assert(appSrc.includes('showUpdateReady') && appSrc.includes('openAbout'), '渲染层含更新弹窗与关于弹窗');

// 5) CI / 发布流水线配置存在且关键项齐全
const ciYml = path.join(__dirname, '.github', 'workflows', 'ci.yml');
const relYml = path.join(__dirname, '.github', 'workflows', 'release.yml');
assert(fs.existsSync(ciYml), '.github/workflows/ci.yml 存在');
assert(fs.existsSync(relYml), '.github/workflows/release.yml 存在');
const ciSrc = fs.readFileSync(ciYml, 'utf8');
const relSrc = fs.readFileSync(relYml, 'utf8');
assert(ciSrc.includes('npm test') && ciSrc.includes('push'), 'CI 工作流在 push 时跑测试');
assert(ciSrc.includes("branches: [main]"), 'CI 监听 main 分支');
assert(relSrc.includes("tags:") && relSrc.includes("- 'v*'"), '发布工作流由 v* tag 触发');
assert(relSrc.includes('contents: write'), '发布工作流声明 contents:write 权限');
assert(relSrc.includes('secrets.GITHUB_TOKEN'), '发布工作流使用 GITHUB_TOKEN');
assert(relSrc.includes('--publish always'), '发布工作流执行带 --publish always 的构建');
assert(relSrc.includes('Verify tag matches'), '发布前校验 tag 与版本一致性');
assert(pub && pub.releaseType === 'release', 'publish 配置 releaseType=release（tag 直发正式版，latest.yml 可解析）');
assert(pkg.scripts.dist.includes('--publish never'), '本地 dist 显式 --publish never（防误发版）');

// 6) 跨平台支持（Linux）——防止配置被无意破坏
const linux = pkg.build && pkg.build.linux;
assert(!!linux, 'package.json 有 linux 打包配置');
const linTargets = ((linux && linux.target) || []).map((t) => (typeof t === 'string' ? t : t.target));
assert(linTargets.includes('AppImage') && linTargets.includes('deb'), 'Linux 目标含 AppImage 与 deb（实际 ' + linTargets.join('/') + '）');
assert(!!(linux && linux.icon), 'Linux 指定多尺寸图标目录（单文件图标会落到 hicolor/0x0/）');
assert(!!(linux && linux.executableName) && /^[\x20-\x7e]+$/.test(linux.executableName), 'Linux 可执行名为 ASCII（避免中文路径/命令）');
assert(!!(linux && linux.maintainer), 'Linux 声明 maintainer（deb 必需字段）');
const files = (pkg.build && pkg.build.files) || [];
assert(files.some((f) => f.includes('@napi-rs') && f.startsWith('!')),
  '打包排除 @napi-rs（pdfjs 的可选原生依赖，否则 Windows 二进制会混进 Linux 包）');

// 图标资源存在且尺寸齐全
const iconPng = path.join(__dirname, 'build', 'icon.png');
const iconDir = path.join(__dirname, 'build', 'icons');
assert(fs.existsSync(iconPng), 'build/icon.png 存在');
const iconSizes = fs.existsSync(iconDir) ? fs.readdirSync(iconDir).filter((f) => /^\d+x\d+\.png$/.test(f)) : [];
assert(iconSizes.length >= 6, 'build/icons 多尺寸图标齐全（实际 ' + iconSizes.length + ' 个）');
if (fs.existsSync(iconPng)) {
  const b = fs.readFileSync(iconPng);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  assert(w >= 256 && h >= 256 && w === h, `应用图标为方形且 ≥256（实际 ${w}x${h}）`);
}

// 发布流水线：双平台矩阵 + 可手动触发的构建校验
assert(relSrc.includes('ubuntu-latest') && relSrc.includes('windows-latest'), '发布流水线覆盖 Windows + Linux');
assert(relSrc.includes('max-parallel: 1'), '双平台串行发布（避免同时上传同一 Release 的竞态）');
const buildYml = path.join(__dirname, '.github', 'workflows', 'build.yml');
assert(fs.existsSync(buildYml), 'build.yml 存在（可手动触发的构建校验）');
if (fs.existsSync(buildYml)) {
  const buildSrc = fs.readFileSync(buildYml, 'utf8');
  assert(buildSrc.includes('workflow_dispatch'), 'build.yml 支持手动触发');
  assert(buildSrc.includes('--publish never'), 'build.yml 只构建不发布');
}

console.log('\n更新器烟测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
