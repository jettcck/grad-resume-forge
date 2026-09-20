'use strict';

// ============================================================
//  agent-core 类型定义
//  这一层刻意不认识 Electron、不认识简历业务：业务通过 RuntimeAdapter 注入进来。
//  目标是把「可控的 Agent Runtime」做成可以单独测试、单独运行（CLI）、单独复用的模块。
// ============================================================

/** 运行状态机。终态：COMPLETED / FAILED / CANCELLED */
export type RunStatus =
  | 'CREATED'
  | 'ANALYZING_JD'
  | 'PLANNING'
  | 'EXECUTING_TOOLS'
  | 'VALIDATING'
  | 'CRITIC_REVIEW'
  | 'WAITING_HUMAN_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export const TERMINAL_STATUSES: ReadonlyArray<RunStatus> = ['COMPLETED', 'FAILED', 'CANCELLED'];

/** 预算：一次运行最多花多少步 / 多少次工具调用 / 多少时间 / 多少 token */
export interface Budget {
  maxSteps: number;
  maxToolCalls: number;
  maxDurationMs: number;
  maxTokens: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 12,
  maxToolCalls: 40,
  maxDurationMs: 180_000,
  maxTokens: 120_000
};

export interface RunUsage {
  steps: number;
  toolCalls: number;
  retries: number;
  ms: number;
  tokens: number;
}

export function emptyUsage(): RunUsage {
  return { steps: 0, toolCalls: 0, retries: 0, ms: 0, tokens: 0 };
}

// ---------- 工具 ----------
/** 够用的 JSON Schema 子集：只校验我们真正会用到的形状，不追求完整实现 */
export interface JsonSchemaLite {
  type: 'object';
  properties?: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    minLength?: number;
    maxLength?: number;
    maxItems?: number;
    items?: {
      type: 'string' | 'number' | 'boolean' | 'object';
      properties?: Record<string, { type: 'string' | 'number' | 'boolean'; minLength?: number; maxLength?: number; description?: string }>;
      required?: string[];
    };
  }>;
  required?: string[];
}

export type ToolErrorType = 'validation' | 'timeout' | 'runtime' | 'unknown_tool' | 'budget';

export interface ToolMeta {
  attempts: number;
  latencyMs: number;
  /** 幂等命中：同样的入参已经执行过，直接返回上次结果（不再产生副作用） */
  idempotentHit: boolean;
}

export type ToolOutcome =
  | { ok: true; data: unknown; meta: ToolMeta }
  | { ok: false; error: string; errorType: ToolErrorType; meta: ToolMeta };

export interface ToolSpec<A = Record<string, unknown>, C = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchemaLite;
  /** readonly 工具不产生副作用；write 工具需要考虑幂等与重试风险 */
  permission: 'readonly' | 'write';
  timeoutMs: number;
  maxRetries: number;
  /** 幂等工具才允许自动重试（非幂等的写操作重试可能造成重复写入） */
  idempotent: boolean;
  execute(args: A, ctx: C): Promise<unknown> | unknown;
}

// ---------- 可观测性 ----------
export interface TraceEntry {
  runId: string;
  stepId: number;
  tool: string;
  inputSummary: string;
  outputSummary: string;
  latencyMs: number;
  retryCount: number;
  /** 该步消耗的 token（适配器没给就是 null，不猜） */
  tokens: number | null;
  errorType: ToolErrorType | null;
  startedAt: number;
  /** 回放用：入参（字符串按 300 字截断，避免把整份简历写进日志） */
  args?: unknown;
}

/** 脱敏后的输入快照：不保存简历正文与 JD 原文，只留可核对的结构信息与摘要指纹 */
export interface InputSnapshot {
  profileName: string;
  itemCount: number;
  sections: Record<string, number>;
  jdLength: number;
  jdDigest: string;
  profileDigest: string;
}

export interface RunRecord {
  runId: string;
  taskId: string;
  status: RunStatus;
  currentStep: string;
  createdAt: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  cancelReason: string | null;
  inputSnapshot: InputSnapshot;
  budget: Budget;
  usage: RunUsage;
  trace: TraceEntry[];
  /** 运行结果摘要（回放与复盘用） */
  result?: unknown;
}

// ---------- 运行时 ----------
export interface RuntimeStepEvent {
  runId: string;
  stepId: number;
  tool: string;
  label: string;
  ok: boolean;
  ms: number;
  detail: string;
  retryCount?: number;
}

export interface CompletionCheck {
  key: string;
  ok: boolean;
  critical: boolean;
  label: string;
}

/** 领域适配器：core 只负责「怎么跑」，业务语义由应用侧实现 */
export interface RuntimeAdapter {
  /** 初始消息（含系统提示与工具清单） */
  initialMessages(): unknown[];
  /** 让模型决策下一步 */
  decide(messages: unknown[]): Promise<{
    content: string;
    calls: Array<{ name: string; args: Record<string, unknown>; rawId?: string }>;
    raw?: unknown;
    tokens?: number | null;
  }>;
  /** 把 assistant 回复写回消息列表 */
  pushAssistant(messages: unknown[], reply: { content: string; raw?: unknown; calls: Array<{ name: string; args: Record<string, unknown>; rawId?: string }> }): void;
  /** 把一次工具结果写回消息列表 */
  pushToolResult(messages: unknown[], call: { name: string; rawId?: string }, outcome: ToolOutcome): void;
  /** 当前进度快照：用于收工校验 */
  snapshot(): {
    /** 本次任务的目标条目 id（覆盖度＝其中有多少条被碰过） */
    targetIds: string[];
    jdAnalyzed: boolean;
    audited: boolean;
    acceptedIds: string[];
    rejected: Array<{ id: string; reason: string }>;
    attemptedIds: string[];
    /** 每个条目被提交过几次（判断拒收后有没有重试） */
    retryCounts?: Record<string, number>;
  };
  /** 完成度检查（critical 缺失才算没干完，advisory 只记录） */
  evaluateCompletion(): CompletionCheck[];
  /** 收工时做最终复测（应用侧算分），返回值会进结果与运行记录 */
  finalize(): unknown;
}

export interface RuntimeOptions {
  runId?: string;
  taskId?: string;
  adapter: RuntimeAdapter;
  tools: ToolSpec[];
  budget?: Partial<Budget>;
  /** 脱敏后的输入快照（简历/JD 不存正文，只存结构与指纹） */
  inputSnapshot?: InputSnapshot;
  /** 取消信号：外部（用户点取消）触发后，运行时在安全点退出并标记 CANCELLED */
  signal?: AbortSignal;
  onStep?: (ev: RuntimeStepEvent) => void;
  store?: RunStore;
  /** 时钟注入：测试里可以假装时间流逝，不必真的等 */
  now?: () => number;
  /** 收集一次运行的完成度/用量等额外结果 */
  onFinish?: (record: RunRecord) => void;
}

export interface RunStore {
  append(rec: RunRecord): void;
  /** 最近的运行在前 */
  list(limit?: number): RunRecord[];
  get(runId: string): RunRecord | null;
  clear(): number;
}
