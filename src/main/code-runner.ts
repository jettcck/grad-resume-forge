// ============================================================
//  编程题判题执行器（JavaScript / Python / C++）
//
//  执行模型：每个用例起一个**独立子进程**，通过 stdin 喂输入、收集 stdout。
//  C++ 需要先编译：整份代码只编译一次，产物 exe 复用于所有用例，
//  编译失败直接判 CE 并把编译器报错原样返回。
//
//  能防的：死循环（超时强杀）、输出爆炸（64KB 截断）、内存失控、崩溃不拖垮主进程。
//  防不了的：子进程仍可读写文件、访问网络 —— 本机单机应用，做题的是用户自己，
//          目标是「防呆」而不是「防恶意」。真要防恶意必须上 WASM 或容器。
//
//  清理：超时/超限一律 taskkill /T /F 杀整棵进程树，避免留下孤儿进程烧 CPU。
// ============================================================
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  CodeQuestion, CodeRunResult, CodeCaseResult, CodeVerdict, ProgramLang
} from './types';

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;
const COMPILE_TIMEOUT_MS = 30000;
/**
 * 进程启动缓冲：Windows 上首次运行「刚编译出来的 exe」会被 Defender 实时扫描，
 * 实测冷启动能到 1.5s 以上。若按题目限制硬卡，用户第一发提交会被误判 TLE。
 * 这里给所有语言统一加一段宽限，真正的死循环仍会被杀掉（只是晚 1.5 秒）。
 */
const RUNTIME_GRACE_MS = 1500;
const PYTHON_CANDIDATES = ['python', 'python3', 'py'];

// 常见安装位置：即便没加进 PATH 也能找到（用户装完 w64devkit 直接解压的情况很常见）
const CPP_FALLBACK_DIRS = [
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'w64devkit', 'bin') : '',
  'C:\\w64devkit\\bin',
  'C:\\msys64\\mingw64\\bin',
  'C:\\mingw64\\bin',
  'C:\\Program Files\\mingw-w64\\mingw64\\bin'
].filter(Boolean);

let pythonCmdCache: string | null | undefined;
export interface CppCompiler {
  /** 可执行文件路径或命令名 */
  cmd: string;
  /** 编译器所在目录（运行时要把它的 bin 加进 PATH，保证能找到 DLL） */
  binDir: string;
  version: string;
}
let cppCache: CppCompiler | null | undefined;

/** 探测本机 Python；结果缓存，避免每次判题都 spawn 一次 */
export function detectPython(): string | null {
  if (pythonCmdCache !== undefined) return pythonCmdCache;
  for (const cmd of PYTHON_CANDIDATES) {
    try {
      const r = spawnSync(cmd, ['--version'], { timeout: 4000, windowsHide: true, encoding: 'utf8' });
      if (r.status === 0) { pythonCmdCache = cmd; return cmd; }
    } catch (_) { /* 试下一个 */ }
  }
  pythonCmdCache = null;
  return null;
}

/** 探测本机 C++ 编译器（只支持 g++ / clang++；MSVC 的 cl 需要 vcvars 环境，暂不支持） */
export function detectCppCompiler(): CppCompiler | null {
  if (cppCache !== undefined) return cppCache;

  const probe = (cmd: string, binDir: string): CppCompiler | null => {
    try {
      const r = spawnSync(cmd, ['--version'], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
      if (r.status === 0) {
        const out = String(r.stdout || '').split('\n')[0].trim();
        return { cmd, binDir, version: out };
      }
    } catch (_) { /* 忽略 */ }
    return null;
  };

  // 1) PATH 里直接可用
  for (const cmd of ['g++', 'clang++']) {
    const hit = probe(cmd, '');
    if (hit) { cppCache = hit; return hit; }
  }
  // 2) 常见安装目录
  const exeNames = process.platform === 'win32' ? ['g++.exe', 'clang++.exe'] : ['g++', 'clang++'];
  for (const dir of CPP_FALLBACK_DIRS) {
    for (const name of exeNames) {
      const exe = path.join(dir, name);
      if (!fs.existsSync(exe)) continue;
      const hit = probe(exe, dir);
      if (hit) { cppCache = hit; return hit; }
    }
  }
  cppCache = null;
  return cppCache;
}

export function detectRuntimes(): {
  javascript: boolean; python: boolean; pythonCmd: string;
  cpp: boolean; cppCmd: string; cppVersion: string;
} {
  const py = detectPython();
  const cpp = detectCppCompiler();
  return {
    javascript: true,
    python: py !== null,
    pythonCmd: py || '',
    cpp: cpp !== null,
    cppCmd: cpp ? cpp.cmd : '',
    cppVersion: cpp ? cpp.version : ''
  };
}

interface RunOutput {
  stdout: string;
  stderr: string;
  timeMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
  exitCode: number | null;
  spawnError?: string;
}

function cleanupDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-pid, 'SIGKILL'); } catch (_) { process.kill(pid, 'SIGKILL'); }
    }
  } catch (_) { /* 进程可能已退出 */ }
}

// ---------------- 程序准备（写文件 / 编译） ----------------

interface Prepared {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
  /** 编译失败等致命错误：直接判 CE */
  error?: string;
}

function compileCpp(compiler: CppCompiler, cwd: string, srcFile: string, exeFile: string): { ok: boolean; output: string } {
  const args = ['-O2', '-std=c++17', '-static', '-o', exeFile, srcFile];
  const r = spawnSync(compiler.cmd, args, {
    cwd,
    timeout: COMPILE_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8',
    // 编译器自己要能找到头文件与库：把它的 bin 目录放进 PATH
    env: compiler.binDir
      ? Object.assign({}, process.env, { PATH: compiler.binDir + ';' + (process.env.PATH || '') })
      : process.env
  });
  if (r.error) return { ok: false, output: r.error.message };
  if (r.status !== 0) {
    const msg = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, output: msg.slice(0, 4000) || ('编译器退出码 ' + r.status) };
  }
  if (!fs.existsSync(exeFile)) return { ok: false, output: '编译器没有产出可执行文件' };
  return { ok: true, output: '' };
}

function prepareProgram(lang: ProgramLang, code: string, memoryLimitMb: number): Prepared {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-code-'));
  const cleanup = () => cleanupDir(dir);
  const baseEnv: NodeJS.ProcessEnv = { ...process.env };

  if (lang === 'javascript') {
    const file = path.join(dir, 'main.js');
    fs.writeFileSync(file, code, 'utf8');
    baseEnv.ELECTRON_RUN_AS_NODE = '1';
    return {
      cmd: process.execPath,
      args: ['--max-old-space-size=' + Math.max(32, Math.round(memoryLimitMb)), file],
      cwd: dir,
      env: baseEnv,
      cleanup
    };
  }

  if (lang === 'python') {
    const py = detectPython();
    if (!py) {
      cleanup();
      return { cmd: '', args: [], cwd: dir, env: baseEnv, cleanup, error: 'NO_PYTHON' };
    }
    const file = path.join(dir, 'main.py');
    fs.writeFileSync(file, code, 'utf8');
    baseEnv.PYTHONIOENCODING = 'utf-8';
    baseEnv.PYTHONUTF8 = '1';
    return { cmd: py, args: [file], cwd: dir, env: baseEnv, cleanup };
  }

  // C++：写源码 → 编译 → 运行产物
  const compiler = detectCppCompiler();
  if (!compiler) {
    cleanup();
    return { cmd: '', args: [], cwd: dir, env: baseEnv, cleanup, error: 'NO_CPP_COMPILER' };
  }
  const src = path.join(dir, 'main.cpp');
  const exe = path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main');
  fs.writeFileSync(src, code, 'utf8');
  const built = compileCpp(compiler, dir, src, exe);
  if (!built.ok) {
    cleanup();
    return { cmd: '', args: [], cwd: dir, env: baseEnv, cleanup, error: 'COMPILE_FAILED:' + built.output };
  }
  // 运行时也把编译器 bin 加进 PATH：动态链接的 libstdc++/libgcc 才找得到
  if (compiler.binDir) {
    baseEnv.PATH = compiler.binDir + ';' + (process.env.PATH || '');
  }
  return { cmd: exe, args: [], cwd: dir, env: baseEnv, cleanup };
}

// ---------------- 单次运行 ----------------

function runOnce(prepared: Prepared, stdin: string, timeLimitMs: number): Promise<RunOutput> {
  const started = Date.now();

  return new Promise<RunOutput>((resolve) => {
    let stdout = '';
    let stderr = '';
    let outBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;

    const child = spawn(prepared.cmd, prepared.args, {
      cwd: prepared.cwd,
      env: prepared.env,
      windowsHide: true,
      detached: process.platform !== 'win32'
    });

    const finish = (partial: Partial<RunOutput>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        stdout, stderr,
        timeMs: Date.now() - started,
        timedOut, outputExceeded,
        exitCode: null,
        ...partial
      });
    };

    let timer: NodeJS.Timeout | undefined;
    // 超时与输出超限都要立刻停表并杀进程树：
    // 只杀进程不清定时器的话，进程退出后定时器仍会触发，把 OLE 误标成 TLE。
    const abort = (reason: 'timeout' | 'output') => {
      if (reason === 'timeout') timedOut = true; else outputExceeded = true;
      if (timer) { clearTimeout(timer); timer = undefined; }
      killTree(child.pid);
    };

    timer = setTimeout(() => abort('timeout'), Math.max(100, Math.round(timeLimitMs)));

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_OUTPUT_BYTES) { abort('output'); return; }
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8').slice(0, MAX_STDERR_BYTES);
    });

    child.on('error', (err) => {
      finish({ stderr: (stderr + '\n' + err.message).trim(), spawnError: err.message });
    });
    child.on('close', (code) => finish({ exitCode: code }));

    try {
      if (child.stdin) {
        child.stdin.on('error', () => { /* EPIPE 忽略 */ });
        child.stdin.write(stdin);
        child.stdin.end();
      }
    } catch (_) { /* 忽略 */ }
  });
}

/** 输出比对：统一换行、去掉每行行尾空白、忽略末尾空行 */
export function normalizeOutput(text: string): string {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

function trimForDisplay(text: string, max = 800): string {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, max) + '\n…（已截断）' : s;
}

/**
 * 判题。
 * @param mode 'samples' 只跑公开样例（「运行」按钮）；'all' 跑全部隐藏用例（「提交」）
 */
export async function judgeCode(
  question: CodeQuestion,
  lang: ProgramLang,
  code: string,
  mode: 'samples' | 'all'
): Promise<CodeRunResult> {
  if (!String(code || '').trim()) {
    return { verdict: 'CE', passed: 0, total: 0, timeMs: 0, cases: [], message: '代码为空' };
  }

  const cases = mode === 'samples'
    ? question.samples.map((s) => ({ input: s.input, output: s.output }))
    : question.testCases;

  // 准备阶段（写文件 / 编译）只做一次，编译失败立刻返回 CE
  let prepared: Prepared;
  try {
    prepared = prepareProgram(lang, code, question.memoryLimitMb);
  } catch (err) {
    return {
      verdict: 'CE', passed: 0, total: cases.length, timeMs: 0, cases: [],
      message: '准备运行环境失败：' + (err as Error).message
    };
  }

  if (prepared.error) {
    const err = prepared.error;
    prepared.cleanup();
    if (err === 'NO_PYTHON') {
      return {
        verdict: 'CE', passed: 0, total: cases.length, timeMs: 0, cases: [],
        message: '未检测到本机 Python，请安装 Python 3 后重试，或改用 JavaScript'
      };
    }
    if (err === 'NO_CPP_COMPILER') {
      return {
        verdict: 'CE', passed: 0, total: cases.length, timeMs: 0, cases: [],
        message: '未检测到 C++ 编译器（g++ / clang++）。请安装 MinGW-w64 并把 bin 目录加入 PATH'
      };
    }
    if (err.startsWith('COMPILE_FAILED:')) {
      return {
        verdict: 'CE', passed: 0, total: cases.length, timeMs: 0,
        message: '编译失败',
        cases: [{
          index: 0, verdict: 'CE', timeMs: 0, isSample: true,
          stderr: trimForDisplay(err.slice('COMPILE_FAILED:'.length), 3000)
        }]
      };
    }
    return {
      verdict: 'CE', passed: 0, total: cases.length, timeMs: 0, cases: [],
      message: '准备运行环境失败：' + err
    };
  }

  const results: CodeCaseResult[] = [];
  let passed = 0;
  let maxTime = 0;
  let firstBad: CodeVerdict | null = null;

  try {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const isSample = mode === 'samples' || i < question.samples.length;
      let out = await runOnce(prepared, c.input, question.timeLimitMs + RUNTIME_GRACE_MS);

      // RE 重试一次：Windows Defender 会杀「刚编译出来的陌生 exe」，
      // 表现为 exitCode != 0，与程序真崩溃无法区分。
      // 真崩溃重试照样崩（只多花一次启动），误杀则第二次就过。
      if (!out.spawnError && !out.timedOut && !out.outputExceeded && out.exitCode !== 0) {
        const retry = await runOnce(prepared, c.input, question.timeLimitMs + RUNTIME_GRACE_MS);
        if (!retry.spawnError && !retry.timedOut && !retry.outputExceeded && retry.exitCode === 0) {
          out = retry;
        }
      }

      if (out.spawnError) {
        return {
          verdict: 'CE', passed, total: cases.length, timeMs: maxTime, cases: results,
          message: '启动运行时失败：' + out.spawnError
        };
      }

      let verdict: CodeVerdict;
      // 输出超限优先于超时：两者都可能导致进程被杀，但 OLE 的提示对用户更有用
      if (out.outputExceeded) verdict = 'OLE';
      else if (out.timedOut) verdict = 'TLE';
      else if (out.exitCode !== 0) verdict = 'RE';
      else if (normalizeOutput(out.stdout) !== normalizeOutput(c.output)) verdict = 'WA';
      else verdict = 'AC';

      if (verdict === 'AC') passed++;
      else if (!firstBad) firstBad = verdict;

      maxTime = Math.max(maxTime, out.timeMs);
      results.push({
        index: i,
        verdict,
        timeMs: out.timeMs,
        isSample,
        // 隐藏用例不回传输入/期望/实际，避免用户直接打印答案
        ...(isSample ? {
          input: c.input,
          expected: c.output,
          actual: trimForDisplay(out.stdout)
        } : {}),
        ...(out.stderr && verdict === 'RE' ? { stderr: trimForDisplay(out.stderr) } : {})
      });

      if (verdict === 'TLE' || verdict === 'RE' || verdict === 'OLE') break;
    }
  } finally {
    prepared.cleanup();
  }

  return {
    verdict: firstBad || 'AC',
    passed,
    total: cases.length,
    timeMs: maxTime,
    cases: results,
    message: firstBad === 'TLE'
      ? '超出时间限制（' + question.timeLimitMs + 'ms）'
      : firstBad === 'OLE'
        ? '输出超过 64KB 上限'
        : firstBad === 'RE'
          ? '程序异常退出'
          : undefined
  };
}
