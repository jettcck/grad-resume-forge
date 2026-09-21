'use strict';

// 工具注册层：把「工具」从「几个写死的函数」变成有契约、有预算、有超时、有重试、
// 有权限区分、有幂等语义、有标准化返回的注册表。
//
// 几个刻意的取舍：
//  1) 只有幂等工具才自动重试。非幂等的写操作重试可能造成重复写入（同一段改写被应用两次），
//     宁可失败让上层决定，也不默默重试。
//  2) 超时用 Promise.race 实现：底层执行函数无法被真正打断（JS 里没有抢占），
//     但调用方会立刻拿到 timeout，不会卡住整个运行。这点在文档里写清楚，不假装能 kill。
//  3) 入参校验是运行时的：TypeScript 类型在运行时不存在，模型给什么都有可能。
//  4) 预算在每次调用前检查，超了返回 budget 错误而不是抛异常，让模型有机会收工。
import {
  Budget,
  JsonSchemaLite,
  ToolErrorType,
  ToolMeta,
  ToolOutcome,
  ToolSpec,
  TraceEntry,
  RunUsage
} from './types';
import { redactValue, truncateArgs } from './run-store';

export interface RegistryOptions {
  runId: string;
  /** true = trace 里保留入参原文（供完整回放）；默认 false，只记 id/长度/指纹 */
  storeTraceArgs?: boolean;
  budget: Budget;
  usage: RunUsage;
  now?: () => number;
  onTrace?: (entry: TraceEntry) => void;
}

// 记录到 trace 的摘要：先按脱敏规则处理（长文本变成「长度 + 指纹」），再压成一行。
// 这样 trace 仍能看出「接受 3 / 覆盖率 43%」这类信息，但带不出简历正文与改写内容。
// 只脱敏入参是不够的：工具输出摘要同样会带上原文（测试里就是这么发现漏洞的）。
function summarize(value: unknown, max = 200): string {
  let s: string;
  try {
    const redacted = redactValue(value);
    s = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  } catch (_) {
    s = '(无法序列化)';
  }
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 运行时校验：只支持我们真正用到的 JSON Schema 子集，返回错误信息或 null */
export function validateArgs(schema: JsonSchemaLite, args: unknown): string | null {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) {
    return '参数必须是对象';
  }
  const obj = args as Record<string, unknown>;
  const props = schema.properties || {};
  for (const key of schema.required || []) {
    if (obj[key] == null) return '缺少必填参数 ' + key;
  }
  for (const key of Object.keys(obj)) {
    const spec = props[key];
    if (!spec) return '出现未声明的参数 ' + key;
    const v = obj[key];
    if (v == null) continue;
    if (spec.type === 'string') {
      if (typeof v !== 'string') return '参数 ' + key + ' 应为字符串';
      if (spec.minLength != null && v.length < spec.minLength) return '参数 ' + key + ' 太短（至少 ' + spec.minLength + ' 字）';
      if (spec.maxLength != null && v.length > spec.maxLength) return '参数 ' + key + ' 太长（最多 ' + spec.maxLength + ' 字）';
    } else if (spec.type === 'number') {
      if (typeof v !== 'number' || Number.isNaN(v)) return '参数 ' + key + ' 应为数字';
    } else if (spec.type === 'boolean') {
      if (typeof v !== 'boolean') return '参数 ' + key + ' 应为布尔值';
    } else if (spec.type === 'array') {
      if (!Array.isArray(v)) return '参数 ' + key + ' 应为数组';
      if (spec.maxItems != null && v.length > spec.maxItems) return '参数 ' + key + ' 最多 ' + spec.maxItems + ' 项';
      if (spec.items) {
        for (let i = 0; i < v.length; i++) {
          const item = v[i];
          if (spec.items.type === 'object') {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) return '参数 ' + key + '[' + i + '] 应为对象';
            const o = item as Record<string, unknown>;
            for (const rk of spec.items.required || []) {
              if (o[rk] == null) return '参数 ' + key + '[' + i + '] 缺少字段 ' + rk;
            }
            for (const ik of Object.keys(spec.items.properties || {})) {
              const iv = o[ik];
              if (iv == null) continue;
              const it = (spec.items.properties || {})[ik]!.type;
              if (it === 'string' && typeof iv !== 'string') return '参数 ' + key + '[' + i + '].' + ik + ' 应为字符串';
              if (it === 'number' && typeof iv !== 'number') return '参数 ' + key + '[' + i + '].' + ik + ' 应为数字';
              if (it === 'boolean' && typeof iv !== 'boolean') return '参数 ' + key + '[' + i + '].' + ik + ' 应为布尔值';
            }
          } else if (typeof item !== spec.items.type) {
            return '参数 ' + key + '[' + i + '] 类型应为 ' + spec.items.type;
          }
        }
      }
    }
  }
  return null;
}

export class ToolRegistry {
  private specs = new Map<string, ToolSpec>();
  private idempotentCache = new Map<string, unknown>();
  private opts: RegistryOptions;

  constructor(opts: RegistryOptions) {
    this.opts = opts;
  }

  register(spec: ToolSpec): this {
    if (this.specs.has(spec.name)) throw new Error('工具重复注册：' + spec.name);
    this.specs.set(spec.name, spec);
    return this;
  }

  registerAll(list: ToolSpec[]): this {
    list.forEach((s) => this.register(s));
    return this;
  }

  has(name: string): boolean {
    return this.specs.has(name);
  }

  names(): string[] {
    return Array.from(this.specs.keys());
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.get(name);
  }

  specsList(): ToolSpec[] {
    return Array.from(this.specs.values());
  }

  /** trace 里的入参：默认脱敏（只留 id/长度/指纹），显式开启才留原文 */
  private traceArgs(args: unknown): unknown {
    return this.opts.storeTraceArgs ? truncateArgs(args) : redactValue(args);
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private trace(entry: Omit<TraceEntry, 'runId'>): void {
    if (this.opts.onTrace) this.opts.onTrace(Object.assign({ runId: this.opts.runId }, entry));
  }

  /** 预算检查：返回错误信息或 null */
  private budgetError(): { error: string; errorType: ToolErrorType } | null {
    const u = this.opts.usage;
    const b = this.opts.budget;
    if (u.toolCalls >= b.maxToolCalls) return { error: '工具调用次数已达上限 ' + b.maxToolCalls, errorType: 'budget' };
    if (u.tokens >= b.maxTokens) return { error: 'token 预算已用尽（' + u.tokens + '/' + b.maxTokens + '）', errorType: 'budget' };
    if (u.ms >= b.maxDurationMs) return { error: '运行时长已达上限 ' + Math.round(b.maxDurationMs / 1000) + ' 秒', errorType: 'budget' };
    return null;
  }

  async call(name: string, args: unknown, ctx: unknown, stepId: number): Promise<ToolOutcome> {
    const startedAt = this.now();
    const baseMeta: ToolMeta = { attempts: 0, latencyMs: 0, idempotentHit: false };
    const spec = this.specs.get(name);
    if (!spec) {
      const meta = Object.assign({}, baseMeta, { latencyMs: this.now() - startedAt });
      this.trace({
        stepId, tool: name, inputSummary: summarize(args), outputSummary: '未知工具',
        latencyMs: meta.latencyMs, retryCount: 0, tokens: null, errorType: 'unknown_tool',
        startedAt, args: this.traceArgs(args)
      });
      return { ok: false, error: '未知工具 ' + name + '（不在白名单：' + this.names().join('、') + '）', errorType: 'unknown_tool', meta };
    }

    const budgetErr = this.budgetError();
    if (budgetErr) {
      const meta = Object.assign({}, baseMeta, { latencyMs: this.now() - startedAt });
      this.trace({
        stepId, tool: name, inputSummary: summarize(args), outputSummary: budgetErr.error,
        latencyMs: meta.latencyMs, retryCount: 0, tokens: null, errorType: budgetErr.errorType,
        startedAt, args: this.traceArgs(args)
      });
      return { ok: false, error: budgetErr.error, errorType: budgetErr.errorType, meta };
    }

    const invalid = validateArgs(spec.inputSchema, args || {});
    if (invalid) {
      const meta = Object.assign({}, baseMeta, { latencyMs: this.now() - startedAt });
      this.trace({
        stepId, tool: name, inputSummary: summarize(args), outputSummary: invalid,
        latencyMs: meta.latencyMs, retryCount: 0, tokens: null, errorType: 'validation',
        startedAt, args: this.traceArgs(args)
      });
      return { ok: false, error: invalid, errorType: 'validation', meta };
    }

    const cacheKey = name + '::' + JSON.stringify(args || {});
    if (spec.idempotent && this.idempotentCache.has(cacheKey)) {
      const meta: ToolMeta = { attempts: 0, latencyMs: this.now() - startedAt, idempotentHit: true };
      const data = this.idempotentCache.get(cacheKey);
      this.trace({
        stepId, tool: name, inputSummary: summarize(args), outputSummary: '幂等命中：' + summarize(data),
        latencyMs: meta.latencyMs, retryCount: 0, tokens: null, errorType: null,
        startedAt, args: this.traceArgs(args)
      });
      return { ok: true, data, meta };
    }

    const maxAttempts = Math.max(1, spec.idempotent ? spec.maxRetries + 1 : 1);
    let attempt = 0;
    let lastError = '';
    let lastErrorType: ToolErrorType = 'runtime';

    while (attempt < maxAttempts) {
      attempt++;
      this.opts.usage.toolCalls++;
      const attemptStart = this.now();
      try {
        const data = await this.withTimeout(spec, args, ctx);
        const latencyMs = this.now() - startedAt;
        const meta: ToolMeta = { attempts: attempt, latencyMs, idempotentHit: false };
        if (spec.idempotent) this.idempotentCache.set(cacheKey, data);
        this.opts.usage.retries += attempt - 1;
        this.trace({
          stepId, tool: name, inputSummary: summarize(args), outputSummary: summarize(data),
          latencyMs, retryCount: attempt - 1, tokens: null, errorType: null,
          startedAt, args: this.traceArgs(args)
        });
        return { ok: true, data, meta };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;
        lastErrorType = /超时|timeout/i.test(message) ? 'timeout' : 'runtime';
        this.opts.usage.retries += 1;
        // 非幂等工具不重试：重复执行可能造成重复写入
        const willRetry = spec.idempotent && attempt < maxAttempts && this.now() - attemptStart < spec.timeoutMs;
        if (!willRetry) break;
        await this.sleep(Math.min(50 * attempt, 200));
      }
    }

    const latencyMs = this.now() - startedAt;
    const meta: ToolMeta = { attempts: attempt, latencyMs, idempotentHit: false };
    this.trace({
      stepId, tool: name, inputSummary: summarize(args), outputSummary: lastError,
      latencyMs, retryCount: attempt - 1, tokens: null, errorType: lastErrorType,
      startedAt, args: this.traceArgs(args)
    });
    return { ok: false, error: lastError, errorType: lastErrorType, meta };
  }

  private async withTimeout(spec: ToolSpec, args: unknown, ctx: unknown): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        Promise.resolve(spec.execute(args as Record<string, unknown>, ctx)),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('工具 ' + spec.name + ' 超时（' + spec.timeoutMs + 'ms）')), spec.timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private sleep(ms: number): Promise<void> {
    // 测试里 now 是注入的假时钟时，不真的等
    if (this.opts.now) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
