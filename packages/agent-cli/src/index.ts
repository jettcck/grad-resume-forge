'use strict';

// ============================================================
//  agent-cli：把 Agent 核心从 Electron 里拿出来单独跑
//
//  为什么值得做：核心逻辑（条目构建 / 校验门 / 收工判定 / 运行时）本来就不依赖 Electron，
//  能脱离界面单独运行，才能说明它是「可测试、可复用、可部署的 Agent 核心」，
//  而不是「只有点开桌面应用才能跑的一坨代码」。
//
//  三个子命令：
//    agent:run    --input case.json [--mode rules|agentic|pipeline] […llm 配置]
//    agent:eval   [--json]                 跑 mock 层评测与质量门禁
//    agent:replay --run <runId> [--runs <agent-runs.jsonl>]
//
//  用法：node packages/agent-cli/dist/index.js run --input case.json
// ============================================================
import fs from 'fs';
import path from 'path';
import { replayRun, createFileRunStore } from '../../agent-core/dist/index';
import type { RunRecord } from '../../agent-core/dist/index';

type Mode = 'rules' | 'agentic' | 'pipeline';

interface CliCase {
  profile?: Record<string, unknown>;
  jd?: string;
  mode?: Mode;
  llm?: { provider?: string; endpoint?: string; model?: string; apiKey?: string; temperature?: number };
  maxSteps?: number;
}

// 复用应用自身的领域实现与 LLM 客户端：评测/CLI 用的必须就是线上那份代码
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ROOT = path.join(__dirname, '..', '..', '..');
function appModule(name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(ROOT, 'dist', 'main', name + '.js'));
}

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string>; bools: Set<string> } {
  const cmd = argv[0] || 'help';
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags[key] = next; i++; }
    else bools.add(key);
  }
  return { cmd, flags, bools };
}

function defaultRunsFile(): string {
  const base = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'grad-resume-forge')
    : path.join(process.env.HOME || process.cwd(), '.config', 'grad-resume-forge');
  return path.join(base, 'grad-resume-data', 'agent-runs.jsonl');
}

async function cmdRun(flags: Record<string, string>): Promise<number> {
  const input = flags.input;
  if (!input) {
    console.error('用法：agent:run --input case.json [--mode rules|agentic|pipeline] [--endpoint URL --model NAME --key KEY] [--max-steps N]');
    return 2;
  }
  const file = path.resolve(input);
  if (!fs.existsSync(file)) { console.error('找不到输入文件：' + file); return 2; }
  const c = JSON.parse(fs.readFileSync(file, 'utf-8')) as CliCase;
  if (!c.profile || !c.jd) { console.error('case.json 需要包含 profile 与 jd 字段'); return 2; }

  const agent = appModule('agent');
  const mode: Mode = (flags.mode as Mode) || c.mode || 'pipeline';
  const maxSteps = Number(flags['max-steps'] || c.maxSteps || 10);
  const runId = 'cli_' + Date.now().toString(36);

  if (mode === 'rules' || mode === 'pipeline') {
    const result = await agent.runAgent(c.profile, c.jd, { rulesOnly: mode === 'rules' });
    console.log(JSON.stringify({
      mode, ok: (result as { accepted?: unknown[] }).accepted ? true : false,
      accepted: ((result as { accepted?: unknown[] }).accepted || []).length,
      rejected: ((result as { rejected?: unknown[] }).rejected || []).length,
      jdBefore: (result as { jdBefore?: number }).jdBefore,
      jdAfter: (result as { jdAfter?: number }).jdAfter,
      steps: ((result as { steps?: unknown[] }).steps || []).length
    }, null, 2));
    return 0;
  }

  const endpoint = flags.endpoint || c.llm?.endpoint || process.env.AGENT_BENCH_ENDPOINT;
  const model = flags.model || c.llm?.model || process.env.AGENT_BENCH_MODEL;
  const apiKey = flags.key || c.llm?.apiKey || process.env.AGENT_BENCH_KEY;
  if (!endpoint || !model) {
    console.error('agentic 模式需要模型：--endpoint 与 --model（或环境变量 AGENT_BENCH_ENDPOINT / AGENT_BENCH_MODEL）');
    return 2;
  }
  const llm = require('../../llm-adapters/dist/index').createLlmClient({
    provider: apiKey ? 'cloud' : 'ollama', endpoint, model, apiKey, temperature: c.llm?.temperature ?? 0.3
  });

  const store = createFileRunStore(flags.runs || defaultRunsFile(), { maxRuns: 50 });
  const result = await agent.agenticLoop(c.profile, c.jd, { llm, maxSteps, runId, taskId: 'cli-run', runStore: store });
  console.log(JSON.stringify({
    runId: runId,
    ok: result.ok,
    status: result.run && result.run.status,
    accepted: result.accepted.length,
    rejected: result.rejected.map((r: { id: string; reason: string }) => r.id + '：' + r.reason),
    jdBefore: result.jdBefore,
    jdAfter: result.jdAfter,
    incomplete: result.incomplete,
    completion: result.completion && result.completion.checks.map((x: { ok: boolean; key: string }) => (x.ok ? '✓' : '✗') + x.key).join(' '),
    usage: result.run && result.run.usage
  }, null, 2));
  console.error('\n运行记录已写入：' + (flags.runs || defaultRunsFile()));
  console.error('回放：agent:replay --run ' + runId);
  return result.ok ? 0 : 1;
}

async function cmdEval(bools: Set<string>): Promise<number> {
  const bench = path.join(ROOT, 'evals', 'agent-bench.js');
  if (!fs.existsSync(bench)) { console.error('找不到评测脚本：' + bench); return 2; }
  // stdio: inherit —— 评测输出直接给用户看，不做二次加工
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const args = bools.has('json') ? ['--json'] : bools.has('verbose') ? ['--verbose'] : [];
  const r = spawnSync(process.execPath, [bench, ...args], { stdio: 'inherit' });
  return r.status == null ? 1 : r.status;
}

async function cmdReplay(flags: Record<string, string>): Promise<number> {
  const runId = flags.run;
  if (!runId) { console.error('用法：agent:replay --run <runId> [--runs <agent-runs.jsonl>] [--input case.json]'); return 2; }
  const runsFile = flags.runs || defaultRunsFile();
  const store = createFileRunStore(runsFile, { maxRuns: 50 });
  const rec = store.get(runId) as RunRecord | null;
  if (!rec) { console.error('在 ' + runsFile + ' 里没有找到 ' + runId); return 2; }
  if (!flags.input) {
    console.log(JSON.stringify({
      runId: rec.runId, status: rec.status, steps: rec.usage.steps, toolCalls: rec.usage.toolCalls,
      usage: rec.usage, inputSnapshot: rec.inputSnapshot,
      trace: rec.trace.map((t) => ({ step: t.stepId, tool: t.tool, ms: t.latencyMs, retry: t.retryCount, err: t.errorType }))
    }, null, 2));
    console.log('\n（只看了记录。要真正重跑工具链，加 --input case.json 提供档案与 JD）');
    return 0;
  }
  const c = JSON.parse(fs.readFileSync(path.resolve(flags.input), 'utf-8')) as CliCase;
  const agent = appModule('agent');
  const items = agent.buildTaskItems(c.profile);
  if (!items.length) { console.error('档案中没有可改写的条目'); return 2; }
  const ctx = { profile: c.profile, jd: String(c.jd || ''), items, accepted: new Map(), rejected: [], jdAnalysis: null, attempts: new Map() };
  const tools = agent.buildAgentTools(ctx).map((t: { name: string; description: string; inputSchema: unknown; run: (a: unknown, c: unknown) => unknown }) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    permission: 'readonly', timeoutMs: 15000, maxRetries: 0, idempotent: true,
    execute: async (args: Record<string, unknown>) => Promise.resolve(t.run(args, ctx))
  }));
  const replayed = await replayRun(rec, { tools, ctx });
  console.log(JSON.stringify({ runId: replayed.runId, okCount: replayed.okCount, errorCount: replayed.errorCount, steps: replayed.steps }, null, 2));
  return replayed.errorCount ? 1 : 0;
}

function usage(): void {
  console.log([
    'agent-cli —— 脱离 Electron 运行 Agent 核心',
    '',
    '  run     --input case.json [--mode rules|agentic|pipeline] [--endpoint URL --model NAME --key KEY] [--max-steps N]',
    '  eval    [--json|--verbose]        跑 mock 层评测与质量门禁',
    '  replay  --run <runId> [--runs <agent-runs.jsonl>] [--input case.json]',
    '',
    'case.json 形状：{ "profile": {...}, "jd": "...", "mode": "agentic", "llm": { "endpoint": "...", "model": "..." } }'
  ].join('\n'));
}

(async () => {
  const { cmd, flags, bools } = parseArgs(process.argv.slice(2));
  let code = 0;
  if (cmd === 'run') code = await cmdRun(flags);
  else if (cmd === 'eval') code = await cmdEval(bools);
  else if (cmd === 'replay') code = await cmdReplay(flags);
  else { usage(); code = cmd === 'help' ? 0 : 2; }
  process.exit(code);
})().catch((e) => { console.error('agent-cli 异常：', e && e.stack ? e.stack : e); process.exit(1); });
