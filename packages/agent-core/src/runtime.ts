'use strict';

// Agent Runtime：把「循环 + 工具 + 校验 + 收工」变成一个可控、可观测、可取消、可复盘的执行过程。
//
// 与旧实现的差别：
//   - 状态显式（RunStateMachine）：能回答「现在在哪一步、为什么停」
//   - 每次运行一条 RunRecord：含脱敏输入快照、预算用量、逐步 trace
//   - 工具走注册表：运行时校验入参、超时、幂等重试、预算拦截
//   - 支持 AbortSignal 取消与时长预算超时，两者都保留已完成的部分结果
//   - 支持按运行记录回放（replayRun）
import {
  Budget,
  DEFAULT_BUDGET,
  RunRecord,
  RunStatus,
  RuntimeOptions,
  RuntimeStepEvent,
  ToolOutcome,
  ToolSpec,
  TraceEntry,
  TraceEntry as _TraceEntry,
  emptyUsage,
  CompletionCheck
} from './types';
import { RunStateMachine } from './state-machine';
import { ToolRegistry } from './tools';


export interface RuntimeOutcome {
  runId: string;
  status: RunStatus;
  finished: boolean;
  cancelled: boolean;
  timedOut: boolean;
  loopError: string | null;
  stepsUsed: number;
  nudges: number;
  completion: {
    checks: CompletionCheck[];
    coverage: { total: number; untouched: number; untouchedIds: string[] };
    rejectedPendingRetry: number;
    nudges: number;
    toolCalls: number;
  } | null;
  incomplete: string | null;
  /** 应用侧 finalize() 的返回值（复测分数等） */
  finalized: unknown;
  record: RunRecord;
  trace: TraceEntry[];
}

export interface RuntimeResult {
  outcome: RuntimeOutcome;
}

function newRunId(now: number): string {
  return 'run_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export async function runAgentRuntime(opts: RuntimeOptions): Promise<RuntimeOutcome> {
  const now = opts.now || (() => Date.now());
  const startedAt = now();
  const runId = opts.runId || newRunId(startedAt);
  const taskId = opts.taskId || 'task';
  const budget: Budget = Object.assign({}, DEFAULT_BUDGET, opts.budget || {});
  const usage = emptyUsage();
  const trace: TraceEntry[] = [];
  const sm = new RunStateMachine(runId, taskId, budget);
  const adapter = opts.adapter;

  sm.transition('PLANNING', 'planning', startedAt);

  const registry = new ToolRegistry({
    runId,
    budget,
    usage,
    now,
    // 是否保留入参原文由注册层决定（在这里二次处理时原文已经丢了 —— 评审指出的问题）
    storeTraceArgs: opts.storeTraceArgs === true,
    onTrace: (e) => trace.push(e)
  });
  registry.registerAll(opts.tools);

  const emit = (ev: RuntimeStepEvent): void => {
    if (opts.onStep) opts.onStep(ev);
  };

  const messages = adapter.initialMessages();
  let finished = false;
  let cancelled = false;
  let timedOut = false;
  let loopError: string | null = null;
  let nudges = 0;
  let incomplete: string | null = null;
  let completion: RuntimeOutcome['completion'] = null;
  let stepsUsed = 0;
  let noToolReplies = 0;
  const MAX_NUDGES = 2;
  const SUBMIT = 'submit_result';

  const cancelRequested = (): boolean => !!(opts.signal && opts.signal.aborted);

  try {
    for (let i = 1; i <= budget.maxSteps && !finished; i++) {
      usage.ms = now() - startedAt;
      if (cancelRequested()) {
        cancelled = true;
        sm.settle('CANCELLED', '用户取消', now());
        break;
      }
      if (usage.ms > budget.maxDurationMs) {
        timedOut = true;
        loopError = '运行超时（超过 ' + Math.round(budget.maxDurationMs / 1000) + ' 秒）';
        sm.settle('FAILED', 'timeout', now());
        break;
      }

      stepsUsed = i;
      usage.steps = i;
      sm.transition('EXECUTING_TOOLS', '第 ' + i + ' 步：模型决策', now());

      let reply: Awaited<ReturnType<typeof adapter.decide>>;
      const t0 = now();
      try {
        reply = await adapter.decide(messages);
      } catch (err) {
        loopError = err instanceof Error ? err.message : String(err);
        emit({ runId, stepId: i, tool: 'agent', label: 'LLM 决策（第 ' + i + ' 步）', ok: false, ms: now() - t0, detail: loopError });
        sm.settle('FAILED', 'llm_error', now());
        break;
      }
      if (typeof reply.tokens === 'number') usage.tokens += reply.tokens;

      const calls = reply.calls || [];
      if (!calls.length) {
        // 模型没调工具：提醒它一次；连续两次就终止（避免空转到步数上限）
        noToolReplies++;
        emit({ runId, stepId: i, tool: 'agent', label: 'LLM 决策（第 ' + i + ' 步）', ok: false, ms: now() - t0, detail: '未调用任何工具' });
        adapter.pushAssistant(messages, { content: reply.content || '(空回复)', raw: reply.raw, calls: [] });
        if (noToolReplies >= 2) {
          loopError = '模型连续未调用工具，终止';
          sm.settle('FAILED', 'no_tool_call', now());
          break;
        }
        continue;
      }
      noToolReplies = 0;

      adapter.pushAssistant(messages, { content: reply.content || '', raw: reply.raw, calls });

      for (const call of calls) {
        if (cancelRequested()) {
          cancelled = true;
          sm.settle('CANCELLED', '用户取消（工具调用之间）', now());
          break;
        }
        const t1 = now();

        if (call.name === SUBMIT) {
          sm.transition('VALIDATING', '收工校验', now());
          const checks = adapter.evaluateCompletion();
          const criticalMissing = checks.filter((c) => c.critical && !c.ok);
          const advisoryMissing = checks.filter((c) => !c.critical && !c.ok);
          if (criticalMissing.length && nudges < MAX_NUDGES) {
            nudges++;
            const tell = criticalMissing.map((c) => c.label).join('；') +
              (advisoryMissing.length ? '（另外建议：' + advisoryMissing.map((c) => c.label).join('；') + '）' : '');
            emit({ runId, stepId: i, tool: SUBMIT, label: '收工被要求补做', ok: false, ms: now() - t1, detail: tell });
            adapter.pushToolResult(messages, { name: SUBMIT, rawId: call.rawId }, {
              ok: false, error: '现在还不能收工：' + tell, errorType: 'validation',
              meta: { attempts: 1, latencyMs: now() - t1, idempotentHit: false }
            });
            sm.transition('CRITIC_REVIEW', 'critic：要求补做', now());
            continue;
          }
          if (criticalMissing.length) incomplete = criticalMissing.map((c) => c.label).join('；');
          const snap = adapter.snapshot();
          const touched = new Set<string>([...snap.attemptedIds, ...snap.acceptedIds, ...snap.rejected.map((r) => r.id)]);
          const untouchedIds = (snap.targetIds || []).filter((id) => !touched.has(id));
          const retryCheck = checks.find((c) => c.key === 'rejected_retried');
          completion = {
            checks,
            coverage: {
              total: (snap.targetIds || []).length,
              untouched: untouchedIds.length,
              untouchedIds: untouchedIds.slice(0, 20)
            },
            rejectedPendingRetry: retryCheck && !retryCheck.ok ? snap.rejected.filter((r) => {
              const key = r.id;
              return (snap.retryCounts || {})[key] == null || (snap.retryCounts || {})[key]! < 2;
            }).length : 0,
            nudges,
            toolCalls: usage.toolCalls
          };
          const passed = checks.filter((c) => c.ok).length;
          emit({
            runId, stepId: i, tool: SUBMIT, label: 'Agent 判定任务完成', ok: criticalMissing.length === 0, ms: now() - t1,
            detail: '完成度 ' + passed + '/' + checks.length +
              (criticalMissing.length ? '（未完成：' + criticalMissing.map((c) => c.label).join('；') + '）' : '') +
              (advisoryMissing.length ? '（可改进：' + advisoryMissing.map((c) => c.label).join('；') + '）' : '')
          });
          finished = true;
          // critical 缺失（如整轮没分析 JD）时不能记成 COMPLETED：
          // 那就是「部分完成假成功」，评审在真实运行里复现过（ok=true 且 incomplete 有值）。
          // 用 PARTIAL 表达「产出可用但不是完成」，让上层与界面都能如实区分。
          if (criticalMissing.length) sm.transition('PARTIAL', 'partial', now());
          else sm.transition('COMPLETED', 'completed', now());
          break;
        }

        const outcome: ToolOutcome = await registry.call(call.name, call.args, undefined, i);
        const latency = now() - t1;
        emit({
          runId, stepId: i, tool: call.name,
          label: outcome.ok ? '调用 ' + call.name : '调用 ' + call.name + ' 失败',
          ok: outcome.ok, ms: latency,
          detail: summarizeOutcome(call.name, outcome),
          retryCount: outcome.meta.attempts > 1 ? outcome.meta.attempts - 1 : 0
        });
        adapter.pushToolResult(messages, { name: call.name, rawId: call.rawId }, outcome);
      }
      if (cancelled) break;
    }
  } catch (err) {
    loopError = loopError || (err instanceof Error ? err.message : String(err));
    sm.settle('FAILED', 'runtime_error', now());
  }

  if (!finished && !cancelled && !timedOut && !loopError) {
    loopError = '达到步数上限（' + budget.maxSteps + ' 步）';
    sm.settle('FAILED', 'max_steps', now());
  }

  let finalized: unknown = null;
  try {
    finalized = adapter.finalize();
  } catch (err) {
    loopError = loopError || ('收尾复测失败：' + (err instanceof Error ? err.message : String(err)));
  }

  usage.ms = now() - startedAt;
  const fallbackSnapshot = { profileName: '', itemCount: 0, sections: {}, jdLength: 0, jdDigest: '', profileDigest: '' };
  const record: RunRecord = {
    runId,
    taskId,
    status: sm.status,
    currentStep: sm.currentStep,
    createdAt: startedAt,
    startedAt,
    finishedAt: now(),
    error: loopError,
    cancelReason: cancelled ? '用户取消' : null,
    inputSnapshot: opts.inputSnapshot || fallbackSnapshot,
    budget,
    usage: Object.assign({}, usage),
    trace: trace.map((t) => Object.assign({}, t)),
    result: finalized
  };
  if (opts.store) opts.store.append(record);
  if (opts.onFinish) opts.onFinish(record);

  return {
    runId,
    status: sm.status,
    finished,
    cancelled,
    timedOut,
    loopError,
    stepsUsed,
    nudges,
    completion,
    incomplete,
    finalized,
    record,
    trace
  };
}

function summarizeOutcome(tool: string, outcome: ToolOutcome): string {
  if (!outcome.ok) return outcome.error;
  const d = outcome.data as { score?: number; accepted?: number; rejected?: number } | undefined;
  if (tool === 'analyze_jd') return '覆盖率 ' + (d && d.score != null ? d.score : '?') + '%';
  if (tool === 'audit_text') return '得分 ' + (d && d.score != null ? d.score : '?');
  if (tool === 'rewrite_bullets') return '接受 ' + (d && d.accepted != null ? d.accepted : '?');
  try {
    const s = JSON.stringify(outcome.data);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch (_) {
    return '(结果无法序列化)';
  }
}

/** 判断入参是不是脱敏后的形态（叶子被替换成 {len, digest}）：这种入参无法用来重跑 */
function looksRedacted(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((v) => looksRedacted(v));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.len === 'number' && typeof o.digest === 'string') return true;
    return Object.keys(o).some((k) => looksRedacted(o[k]));
  }
  return false;
}

/**
 * 回放：拿到一条运行记录，用当前的工具实现按原顺序重跑那些调用。
 * 用途：复盘「当时为什么拒了这条」、改了校验门之后对比效果，都无需再花模型调用。
 *
 * 注意：运行记录默认只保存入参摘要（不含简历正文），这时没有可重跑的入参。
 * 遇到这种步骤会**如实跳过并计数**，而不是拿脱敏后的占位对象去跑（那只会得到一堆
 * 「参数类型不对」的假错误，把真正的原因藏起来）。
 */
export async function replayRun(
  record: RunRecord,
  opts: { tools: ToolSpec[]; ctx?: unknown; now?: () => number }
): Promise<{
  runId: string;
  steps: Array<{ tool: string; ok: boolean; error?: string; data?: unknown }>;
  okCount: number;
  errorCount: number;
  skipped: number;
  skippedReason: string | null;
}> {
  const now = opts.now || (() => Date.now());
  const registry = new ToolRegistry({
    runId: 'replay_' + record.runId,
    budget: record.budget,
    usage: emptyUsage(),
    now
  });
  registry.registerAll(opts.tools);
  const steps: Array<{ tool: string; ok: boolean; error?: string; data?: unknown }> = [];
  let okCount = 0;
  let errorCount = 0;
  let skipped = 0;
  for (let i = 0; i < record.trace.length; i++) {
    const t = record.trace[i]!;
    if (t.tool === 'agent' || t.tool === 'submit_result') continue;
    if (t.args == null || looksRedacted(t.args)) { skipped++; continue; }
    const outcome = await registry.call(t.tool, t.args, opts.ctx, i + 1);
    if (outcome.ok) { okCount++; steps.push({ tool: t.tool, ok: true, data: outcome.data }); }
    else { errorCount++; steps.push({ tool: t.tool, ok: false, error: outcome.error }); }
  }
  const skippedReason = skipped
    ? '这条记录默认未保存工具入参原文（脱敏），有 ' + skipped + ' 步无法回放'
    : null;
  return { runId: 'replay_' + record.runId, steps, okCount, errorCount, skipped, skippedReason };
}
