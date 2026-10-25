'use strict';

// 验证 electron-builder 产物能在干净用户目录下启动。
// 这个检查故意不注册 mock IPC，也不加载开发目录：它启动的是
// release/<platform>-unpacked 里的真实可执行文件，覆盖打包后的
// app.asar、资源路径、Electron 主进程初始化和用户数据目录创建。
//
// 用法：
//   npm run smoke:packaged
//   GRF_PACKAGED_EXE=/path/to/app npm run smoke:packaged

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { listPackage } = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const STARTUP_WAIT_MS = 15000;
const DATA_DIR_WAIT_MS = 15000;
const DATA_DIR_POLL_MS = 250;

function findExecutable() {
  const explicit = String(process.env.GRF_PACKAGED_EXE || '').trim();
  const candidates = explicit ? [explicit] : process.platform === 'win32'
    ? [path.join(ROOT, 'release', 'win-unpacked', '简历锻造炉.exe')]
    : process.platform === 'darwin'
      ? [path.join(ROOT, 'release', 'mac', '简历锻造炉.app', 'Contents', 'MacOS', '简历锻造炉')]
      : [path.join(ROOT, 'release', 'linux-unpacked', 'grad-resume-forge')];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) {
    throw new Error('找不到打包版可执行文件。已检查：\n' + candidates.join('\n'));
  }
  return path.resolve(hit);
}

function findAsar(executable) {
  const exe = path.resolve(executable);
  const candidates = process.platform === 'darwin'
    ? [path.join(exe, '..', '..', 'Resources', 'app.asar')]
    : [path.join(path.dirname(exe), 'resources', 'app.asar')];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('找不到打包资源 app.asar：\n' + candidates.join('\n'));
  return path.resolve(hit);
}

function verifyAsar(asarPath) {
  const entries = new Set(listPackage(asarPath).map((entry) =>
    String(entry).replaceAll('\\', '/').replace(/^\/+/, '')
  ));
  const has = (entry) => entries.has(entry);
  const required = [
    'dist/main/main.js',
    'src/renderer/index.html',
    'data/cities.json',
    'packages/agent-core/dist/index.js',
    'packages/llm-adapters/dist/index.js',
    // 提示词是运行时读的文本文件（不在 dist 里），漏打包会让 Agent 一启动就抛错
    'prompts/agentic-system-v1.txt',
    'prompts/rewrite-rules-v1.txt',
    'package.json'
  ];
  const missing = required.filter((entry) => !has(entry));
  if (missing.length) {
    throw new Error('app.asar 缺少关键文件：' + missing.join(', '));
  }
  console.log('✅ app.asar 内容检查通过');
  console.log('  archive:', asarPath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tail(text, max = 4000) {
  const s = String(text || '');
  return s.length > max ? s.slice(-max) : s;
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (_) {
      // 进程可能已在 taskkill 前自行退出，继续等待 close 即可。
    }
  } else {
    try { child.kill('SIGTERM'); } catch (_) { /* 已退出 */ }
  }
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    sleep(2000)
  ]);
  if (child.exitCode === null && !child.signalCode) {
    try { child.kill('SIGKILL'); } catch (_) { /* 已退出 */ }
  }
}

async function main() {
  const executable = findExecutable();
  const asar = findAsar(executable);
  verifyAsar(asar);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-packaged-smoke-'));
  let stdout = '';
  let stderr = '';
  let child;
  try {
    child = spawn(executable, [
      '--no-sandbox',
      '--disable-gpu',
      '--user-data-dir=' + userData
    ], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });

    const result = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        resolve(value);
      };
      child.once('error', (error) => finish({ error }));
      child.once('exit', (code, signal) => finish({ code, signal }));
      setTimeout(() => finish({ alive: true }), STARTUP_WAIT_MS);
    });

    if (!result.alive) {
      throw new Error(
        '打包版在 ' + (result.code == null ? '启动阶段' : ('退出码 ' + result.code)) + ' 退出' +
        (result.signal ? '（' + result.signal + '）' : '') +
        (result.error ? '：' + result.error.message : '') +
        '\nstdout:\n' + tail(stdout) + '\nstderr:\n' + tail(stderr)
      );
    }
    const dataDir = path.join(userData, 'grad-resume-data');
    const dataDeadline = Date.now() + DATA_DIR_WAIT_MS;
    while (!fs.existsSync(dataDir) && Date.now() < dataDeadline) {
      await sleep(DATA_DIR_POLL_MS);
    }
    if (!fs.existsSync(dataDir)) {
      throw new Error('进程保持运行，但在 ' + DATA_DIR_WAIT_MS + 'ms 内没有创建本地数据目录：' + dataDir +
        '\nstdout:\n' + tail(stdout) + '\nstderr:\n' + tail(stderr));
    }
    console.log('✅ 打包版启动冒烟通过');
    console.log('  executable:', executable);
    console.log('  userData:', userData);
  } finally {
    await terminate(child);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (error) {
      console.warn('⚠ 临时用户目录清理失败：' + error.message);
    }
  }
}

main().catch((error) => {
  console.error('❌ 打包版启动冒烟失败：' + error.message);
  process.exitCode = 1;
});
