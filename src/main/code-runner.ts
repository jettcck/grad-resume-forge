// ============================================================
//  编程题判题执行器
//
//  执行模型：每个用例起一个**独立子进程**，通过 stdin 喂输入、收集 stdout。
//  能防的：死循环（超时强杀）、输出爆炸（64KB 截断）、内存失控（Node 堆上限）、
//          崩溃影响主进程（进程隔离）。
//  防不了的：子进程仍可读写文件、访问网络 —— 本机单机应用，做题的是用户自己，
//          这里的目标是「防呆」而不是「防恶意」。真要防恶意必须上 WASM 或容器。
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
const PYTHON_CANDIDATES = ['python', 'python3', 'py'];

let pythonCmdCache: string | null | undefined;

/** 探测本机 Python；结果缓存，避免每次判题都 spawn 一次 */
export function detectPython(): string | null {
  if (pythonCmdCache !== undefined) return pythonCmdCache;
  for (const cmd of PYTHON_CANDIDATES) {
    try {
      const r = spawnSync(cmd, ['--version'], { timeout: 4000, windowsHide: true });
      if (r.status === 0) { pythonCmdCache = cmd; return cmd; }
    } catch (_) { /* 试下一个 */ }
  }
  pythonCmdCache = null;
  return null;
}

export function detectRuntimes(): { javascript: boolean; python: boolean; pythonCmd: string } {
  const py = detectPython();
  return { javascript: true, python: py !== null, pythonCmd: py || '' };
}

interface RunOptions {
  lang: ProgramLang;
  code: string;
  stdin: string;
  timeLimitMs: number;
  memoryLimitMb: number;
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
  // Windows 上进程刚退出时文件可能仍被占用，失败就忽略（临时目录由系统回收）
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

async function runProgram(opts: RunOptions): Promise<RunOutput> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-code-'));
  const file = path.join(dir, opts.lang === 'javascript' ? 'main.js' : 'main.py');
  fs.writeFileSync(file, opts.code, 'utf8');

  const env: NodeJS.ProcessEnv = { ...process.env };
  let cmd = '';
  let args: string[] = [];

  if (opts.lang === 'javascript') {
    // process.execPath 在打包后是应用自己的 exe，必须用 ELECTRON_RUN_AS_NODE 让它当 node 跑
    cmd = process.execPath;
    args = ['--max-old-space-size=' + Math.max(32, Math.round(opts.memoryLimitMb)), file];
    env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    const py = detectPython();
    if (!py) {
      cleanupDir(dir);
      return {
        stdout: '', stderr: '', timeMs: 0, timedOut: false,
        outputExceeded: false, exitCode: null, spawnError: 'NO_PYTHON'
      };
    }
    cmd = py;
    args = [file];
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
  }

  const started = Date.now();

  return new Promise<RunOutput>((resolve) => {
    let stdout = '';
    let stderr = '';
    let outBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;

    const child = spawn(cmd, args, { cwd: dir, env, windowsHide: true, detached: process.platform !== 'win32' });

    const finish = (partial: Partial<RunOutput>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanupDir(dir);
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

    timer = setTimeout(() => abort('timeout'), Math.max(100, Math.round(opts.timeLimitMs)));

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        abort('output');
        return;
      }
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8').slice(0, MAX_STDERR_BYTES);
    });

    child.on('error', (err) => {
      finish({ stderr: (stderr + '\n' + err.message).trim(), spawnError: err.message });
    });

    child.on('close', (code) => {
      finish({ exitCode: code });
    });

    // 喂输入；程序不读 stdin 时可能 EPIPE，忽略即可
    try {
      if (child.stdin) {
        child.stdin.on('error', () => { /* EPIPE 忽略 */ });
        child.stdin.write(opts.stdin);
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

  const results: CodeCaseResult[] = [];
  let passed = 0;
  let maxTime = 0;
  let firstBad: CodeVerdict | null = null;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const isSample = mode === 'samples' || i < question.samples.length;
    const out = await runProgram({
      lang,
      code,
      stdin: c.input,
      timeLimitMs: question.timeLimitMs,
      memoryLimitMb: question.memoryLimitMb
    });

    if (out.spawnError === 'NO_PYTHON') {
      return {
        verdict: 'CE', passed: 0, total: cases.length, timeMs: 0, cases: results,
        message: '未检测到本机 Python，请安装 Python 3 后重试，或改用 JavaScript'
      };
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
      ...(out.stderr && verdict === 'RE'
        ? { stderr: trimForDisplay(out.stderr) }
        : {})
    });

    // 超时/运行错误/输出超限：后面不用再跑了，早点把结果给用户
    if (verdict === 'TLE' || verdict === 'RE' || verdict === 'OLE') break;
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
