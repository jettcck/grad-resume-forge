'use strict';

// Windows-only NSIS installation smoke test. It installs the freshly built
// setup executable on a disposable GitHub-hosted runner, boots the installed
// binary, then runs its uninstaller. A temporary directory alone does not
// isolate NSIS registry/shortcut writes, so local execution is forbidden.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('⏭ 安装器冒烟仅适用于 Windows，跳过');
  process.exit(0);
}

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  console.log('⏭ 安装器冒烟仅允许在 GitHub 托管临时 runner 上运行，本地跳过；请使用 smoke:packaged。');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');
const setup = path.join(ROOT, 'release', 'grad-resume-forge-setup.exe');
const waitMs = 7000;
const appConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Same UUID v5 inputs as electron-builder's default NSIS GUID. Deriving it
// from build.appId keeps this guard correct if the application id changes.
function uuidV5(name, namespaceHex) {
  const namespace = Buffer.from(namespaceHex.replace(/-/g, ''), 'hex');
  const digest = crypto.createHash('sha1').update(Buffer.concat([
    namespace, Buffer.from(name, 'utf8')
  ])).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

const installerGuid = uuidV5(String(appConfig.build && appConfig.build.appId || ''),
  '50e065bc-3134-11e6-9bab-38c9862bdaf3');

function assertNoInstalledCopy() {
  // Installing this product also uninstalls a prior copy, even with /D.
  // Refuse either registry key in either hive before invoking NSIS.
  for (const hive of ['HKCU', 'HKLM']) {
    for (const key of ['Software\\' + installerGuid,
      'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + installerGuid]) {
      const query = spawnSync('reg.exe', ['query', hive + '\\' + key], { windowsHide: true });
      if (query.error) throw query.error;
      if (query.status === 0) throw new Error('runner 上存在已有安装，拒绝安装测试：' + hive + '\\' + key);
    }
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function killTree(child) {
  if (!child || child.pid == null) return;
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch (_) { /* process already exited */ }
}

async function main() {
  if (!fs.existsSync(setup)) throw new Error('找不到安装包：' + setup);
  assertNoInstalledCopy();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-installer-smoke-'));
  const installDir = path.join(root, 'installed');
  const userData = path.join(root, 'userdata');
  let app;
  try {
    const install = spawnSync(setup, ['/S', '/D=' + installDir], {
      cwd: path.dirname(setup),
      windowsHide: true,
      encoding: 'utf8',
      timeout: 120000
    });
    if (install.error) throw install.error;
    if (install.status !== 0) {
      throw new Error('安装器退出码 ' + install.status + '\n' + String(install.stderr || '').slice(-2000));
    }

    const executable = path.join(installDir, '简历锻造炉.exe');
    if (!fs.existsSync(executable)) throw new Error('安装完成后找不到主程序：' + executable);
    app = spawn(executable, [
      '--no-sandbox',
      '--disable-gpu',
      '--user-data-dir=' + userData
    ], {
      cwd: installDir,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    const exited = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      app.once('error', (error) => finish({ error }));
      app.once('exit', (code, signal) => finish({ code, signal }));
      setTimeout(() => finish({ alive: true }), waitMs);
    });
    if (!exited.alive) {
      throw new Error('安装后的程序未能保持运行' +
        (exited.error ? '：' + exited.error.message : '') +
        (exited.code == null ? '' : '（退出码 ' + exited.code + '）'));
    }
    if (!fs.existsSync(path.join(userData, 'grad-resume-data'))) {
      throw new Error('安装后的程序没有创建本地数据目录');
    }
    console.log('✅ NSIS 安装器冒烟通过');
    console.log('  installer:', setup);
    console.log('  installed:', executable);
  } finally {
    killTree(app);
    await sleep(500);
    const uninstaller = path.join(installDir, 'Uninstall 简历锻造炉.exe');
    if (fs.existsSync(uninstaller)) {
      const uninstall = spawnSync(uninstaller, ['/S', '/currentuser', '_?=' + installDir], {
        windowsHide: true, timeout: 120000, encoding: 'utf8'
      });
      if (uninstall.error || uninstall.status !== 0) {
        throw new Error('测试后卸载失败，保留临时目录：' + root);
      }
      assertNoInstalledCopy();
    }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (error) {
      console.warn('⚠ 临时安装目录清理失败：' + error.message);
    }
  }
}

main().catch((error) => {
  console.error('❌ NSIS 安装器冒烟失败：' + error.message);
  process.exitCode = 1;
});
