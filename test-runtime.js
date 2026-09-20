'use strict';

// Agent Runtime 自测（第二阶段）
// 这一层刻意用「假领域」测：说明 agent-core 不依赖 Electron、也不依赖简历业务，
// 业务是通过 RuntimeAdapter 注入的。业务侧的行为由 test-agent.js 守着。
const path = require('path');
const core = require(path.join(__dirname, 'packages', 'agent-core', 'dist', 'index.js'));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeTool(name, opts) {
  const o = opts || {};
  const calls = { count: 0 };
  const spec = {
    name,
    description: name + ' 工具',
    // 默认 schema 允许 id/text 这类常见入参：运行时校验会拒绝「未声明的参数」，
    // 所以假工具也得把参数声明清楚（这本身就说明校验在工作）。
    inputSchema: o.schema || {
      type: 'object',
      properties: { id: { type: 'string' }, text: { type: 'string' } },
      required: []
    },
    permission: o.permission || 'readonly',
    timeoutMs: o.timeoutMs || 200,
    maxRetries: o.maxRetries == null ? 1 : o.maxRetries,
    idempotent: o.idempotent !== false,
    execute: async (args) => {
      calls.count++;
      if (o.behavior) return o.behavior(args, calls.count);
      return { ok: name, args };
    }
  };
  return { spec, calls };
}

/** 一个最小的假适配器：按脚本产出工具调用，收工时的完成度由 checksFn 给 */
function makeAdapter(opts) {
  const messages = [];
  let step = 0;
  const script = opts.script;
  const state = { jdAnalyzed: false, audited: false, acceptedIds: [], rejected: [], attemptedIds: [] };
  return {
    state,
    adapter: {
      initialMessages: () => messages,
      decide: async () => {
        const entry = script[Math.min(step, script.length - 1)];
        step++;
        if (typeof entry.tokens === 'number') return { content: '', calls: entry.calls || [], tokens: entry.tokens };
        return { content: entry.content || '', calls: entry.calls || [] };
      },
      pushAssistant: () => {},
      pushToolResult: (msgs, call, outcome) => {
        msgs.push({ tool: call.name, ok: outcome.ok });
        if (call.name === 'analyze') state.jdAnalyzed = true;
        if (call.name === 'audit') state.audited = true;
        if (call.name === 'rewrite' && outcome.ok) {
          state.attemptedIds.push('b0');
          state.acceptedIds.push('b0');
        }
      },
      snapshot: () => ({
        targetIds: opts.targetIds || ['b0'],
        jdAnalyzed: state.jdAnalyzed,
        audited: state.audited,
        acceptedIds: state.acceptedIds,
        rejected: state.rejected,
        attemptedIds: state.attemptedIds,
        retryCounts: {}
      }),
      evaluateCompletion: () => (opts.checksFn ? opts.checksFn(state) : [
        { key: 'jd_analyzed', ok: state.jdAnalyzed, critical: true, label: '未分析 JD' },
        { key: 'accepted', ok: state.acceptedIds.length > 0, critical: true, label: '无改写过门' }
      ]),
      finalize: () => ({ note: 'finalized' })
    }
  };
}

(async () => {
  // ============================================================
  //  1) 状态机
  // ============================================================
  {
    const sm = new core.RunStateMachine('r1', 't1', core.DEFAULT_BUDGET);
    assert(sm.status === 'CREATED', '初始状态 CREATED');
    assert(core.canTransition('CREATED', 'PLANNING') === true, '允许 CREATED → PLANNING');
    assert(core.canTransition('COMPLETED', 'EXECUTING_TOOLS') === false, '终态不可再转移');
    let threw = '';
    try { sm.transition('COMPLETED'); } catch (e) { threw = e.message; }
    assert(/非法状态转移/.test(threw), '非法转移直接抛错（CREATED → COMPLETED）：' + threw);
    sm.transition('PLANNING', 'planning', 1000);
    sm.transition('EXECUTING_TOOLS', 'step1', 1001);
    sm.settle('CANCELLED', '用户取消', 1002);
    assert(sm.status === 'CANCELLED' && sm.isTerminal(), '可结算为 CANCELLED 且是终态');
    sm.settle('COMPLETED', 'completed', 1003);
    assert(sm.status === 'CANCELLED', '已到终态后 settle 不会覆盖结果');
    assert(sm.transitions().length === 3, '状态转移历史可查（' + sm.transitions().length + ' 条）');
    assert(core.isTerminal('FAILED') && core.isTerminal('COMPLETED'), 'isTerminal 覆盖三种终态');
  }

  // ============================================================
  //  2) 工具注册层：校验 / 未知工具 / 超时 / 幂等与重试
  // ============================================================
  {
    const budget = Object.assign({}, core.DEFAULT_BUDGET);
    const usage = core.emptyUsage();
    const reg = new core.ToolRegistry({ runId: 'r2', budget, usage });
    const good = makeTool('ok_tool', {
      schema: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 10 }, items: { type: 'array', maxItems: 2, items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
        required: ['text']
      }
    });
    reg.register(good.spec);

    const unknown = await reg.call('nope', {}, undefined, 1);
    assert(unknown.ok === false && unknown.errorType === 'unknown_tool', '未知工具被拦截（' + unknown.error + '）');

    const missing = await reg.call('ok_tool', {}, undefined, 1);
    assert(missing.ok === false && missing.errorType === 'validation' && /缺少必填/.test(missing.error), '缺必填参数 → validation：' + missing.error);

    const wrongType = await reg.call('ok_tool', { text: 123 }, undefined, 1);
    assert(wrongType.ok === false && /应为字符串/.test(wrongType.error), '参数类型错 → validation：' + wrongType.error);

    const undeclared = await reg.call('ok_tool', { text: 'a', extra: 1 }, undefined, 1);
    assert(undeclared.ok === false && /未声明/.test(undeclared.error), '未声明参数被拒：' + undeclared.error);

    const tooLong = await reg.call('ok_tool', { text: 'x'.repeat(11) }, undefined, 1);
    assert(tooLong.ok === false && /太长/.test(tooLong.error), '超长字符串被拒：' + tooLong.error);

    const badItems = await reg.call('ok_tool', { text: 'a', items: [{ id: 1 }] }, undefined, 1);
    assert(badItems.ok === false && /应为字符串/.test(badItems.error), '数组元素字段类型错被拒：' + badItems.error);

    const okCall = await reg.call('ok_tool', { text: 'a', items: [{ id: 'x' }] }, undefined, 2);
    assert(okCall.ok === true && okCall.meta.attempts === 1, '合法调用成功且 attempts=1');

    // 幂等：同样入参第二次不再真正执行
    const again = await reg.call('ok_tool', { text: 'a', items: [{ id: 'x' }] }, undefined, 3);
    assert(again.ok === true && again.meta.idempotentHit === true && good.calls.count === 1,
      '幂等命中：同样入参不重复执行（实际执行 ' + good.calls.count + ' 次）');

    // 超时：幂等工具会重试，但最终仍以 timeout 收场
    const slow = makeTool('slow_tool', { timeoutMs: 30, maxRetries: 1, behavior: () => sleep(100).then(() => 'never') });
    reg.register(slow.spec);
    const timedOut = await reg.call('slow_tool', {}, undefined, 4);
    assert(timedOut.ok === false && timedOut.errorType === 'timeout', '超时被识别（' + timedOut.error + '）');

    // 非幂等工具不重试：重复执行可能造成重复写入
    const flaky = makeTool('flaky_write', {
      idempotent: false, maxRetries: 3,
      behavior: () => { throw new Error('第一次失败'); }
    });
    reg.register(flaky.spec);
    const noRetry = await reg.call('flaky_write', {}, undefined, 5);
    assert(noRetry.ok === false && flaky.calls.count === 1, '非幂等工具失败不重试（执行 ' + flaky.calls.count + ' 次）');

    // 幂等工具失败会重试
    let attempts = 0;
    const retryable = makeTool('retry_tool', {
      maxRetries: 2,
      behavior: () => { attempts++; if (attempts < 2) throw new Error('先失败一次'); return '第二次成功'; }
    });
    reg.register(retryable.spec);
    const retried = await reg.call('retry_tool', {}, undefined, 6);
    assert(retried.ok === true && retried.meta.attempts === 2, '幂等工具失败后重试成功（attempts=' + retried.meta.attempts + '）');
  }

  // ============================================================
  //  3) 预算：工具次数 / token / 时长
  // ============================================================
  {
    const usage = core.emptyUsage();
    const budget = Object.assign({}, core.DEFAULT_BUDGET, { maxToolCalls: 1 });
    const reg = new core.ToolRegistry({ runId: 'r3', budget, usage });
    const t = makeTool('t');
    reg.register(t.spec);
    const first = await reg.call('t', {}, undefined, 1);
    const second = await reg.call('t', {}, undefined, 2);
    assert(first.ok === true, '预算内第一次调用成功');
    assert(second.ok === false && second.errorType === 'budget', '超出工具次数预算被拦（' + second.error + '）');

    const usage2 = core.emptyUsage();
    usage2.tokens = 999;
    const reg2 = new core.ToolRegistry({ runId: 'r4', budget: Object.assign({}, core.DEFAULT_BUDGET, { maxTokens: 100 }), usage: usage2 });
    reg2.register(makeTool('t2').spec);
    const overTokens = await reg2.call('t2', {}, undefined, 1);
    assert(overTokens.ok === false && /token/.test(overTokens.error), 'token 预算用尽被拦（' + overTokens.error + '）');
  }

  // ============================================================
  //  4) Runtime：正常收工 / 取消 / 超时 / 运行记录 / 脱敏 / 回放
  // ============================================================
  {
    const store = core.createMemoryRunStore();
    const t = makeTool('rewrite', { permission: 'write' });
    const a = makeAdapter({
      script: [
        { calls: [{ name: 'analyze', args: {} }] },
        { calls: [{ name: 'rewrite', args: { id: 'b0' } }] },
        { calls: [{ name: 'submit_result', args: {} }] }
      ]
    });
    const out = await core.runAgentRuntime({
      adapter: a.adapter,
      tools: [
        Object.assign({}, t.spec, { name: 'analyze' }),
        t.spec,
        makeTool('audit').spec
      ],
      budget: { maxSteps: 6 },
      store,
      taskId: 'unit-task',
      inputSnapshot: core.buildInputSnapshot({
        profileName: '张三', itemCount: 1, sections: { projects: 1 },
        jd: '一份很长的 JD 原文，里面写着「招聘后端工程师，熟悉 Redis 与 Kafka」', profileDigestSource: '{"name":"张三"}'
      })
    });
    assert(out.status === 'COMPLETED' && out.finished === true, '正常流程收工为 COMPLETED');
    assert(out.stepsUsed === 3, '步数与脚本一致（' + out.stepsUsed + '）');
    assert(out.record.usage.toolCalls === 2, '运行记录记下工具调用次数（' + out.record.usage.toolCalls + '）');
    assert(out.trace.length >= 2 && out.trace.every((e) => typeof e.latencyMs === 'number'), 'trace 每条都有耗时');
    assert(out.record.inputSnapshot.jdLength > 0 && /^[0-9a-f]{8}:\d+$/.test(out.record.inputSnapshot.jdDigest),
      '输入快照只留长度与指纹（' + out.record.inputSnapshot.jdDigest + '）');
    const serialized = JSON.stringify(out.record);
    assert(!serialized.includes('熟悉 Redis 与 Kafka'), '运行记录里不含 JD 原文（脱敏生效）');
    assert(!serialized.includes('"name":"张三"'), '运行记录里不含简历正文（脱敏生效）');
    assert(store.list().length === 1 && store.get(out.runId) && store.get(out.runId).taskId === 'unit-task',
      '运行记录可列表、可按 runId 取回');
    assert(store.clear() === 1 && store.list().length === 0, '运行记录可清理');

    // 取消：保留已完成的改写，状态为 CANCELLED
    const controller = new AbortController();
    const t2 = makeTool('rewrite2', { permission: 'write' });
    const a2 = makeAdapter({
      script: [
        { calls: [{ name: 'rewrite2', args: { id: 'b0' } }] },
        { calls: [{ name: 'rewrite2', args: { id: 'b0' } }] }
      ]
    });
    const origPush = a2.adapter.pushToolResult;
    a2.adapter.pushToolResult = (msgs, call, outcome) => {
      origPush(msgs, call, outcome);
      controller.abort(); // 第一次写入后用户点了取消
    };
    const cancelled = await core.runAgentRuntime({
      adapter: a2.adapter,
      tools: [t2.spec],
      signal: controller.signal,
      budget: { maxSteps: 6 }
    });
    assert(cancelled.status === 'CANCELLED' && cancelled.cancelled === true, '取消后状态为 CANCELLED');
    assert(t2.calls.count === 1, '取消发生在安全点：已完成的工具调用保留（' + t2.calls.count + ' 次）');
    assert(cancelled.record.cancelReason === '用户取消', '运行记录写明取消原因');

    // 时长预算：假装时间已经用掉
    let fake = 0;
    const t3 = makeTool('slowstep');
    const a3 = makeAdapter({ script: [{ calls: [{ name: 'slowstep', args: {} }] }, { calls: [{ name: 'slowstep', args: {} }] }] });
    const timedOut = await core.runAgentRuntime({
      adapter: a3.adapter,
      tools: [t3.spec],
      budget: { maxSteps: 6, maxDurationMs: 50 },
      now: () => { fake += 60; return fake; }
    });
    assert(timedOut.timedOut === true && timedOut.status === 'FAILED', '超时长预算终止并标 FAILED');
    assert(/超时/.test(timedOut.loopError || ''), '错误信息说明是超时（' + timedOut.loopError + '）');

    // token 预算：适配器上报 token 后，后续工具调用应被预算拦住
    const t4 = makeTool('tok');
    const a4 = makeAdapter({ script: [{ calls: [{ name: 'tok', args: {} }], tokens: 5000 }, { calls: [{ name: 'tok', args: {} }] }] });
    const overTokens = await core.runAgentRuntime({ adapter: a4.adapter, tools: [t4.spec], budget: { maxSteps: 6, maxTokens: 1000 } });
    assert(t4.calls.count === 0, 'token 已超预算时工具不执行（执行 ' + t4.calls.count + ' 次）');
    assert(/token/.test(overTokens.trace.map((x) => x.outputSummary).join(' ')), 'trace 里能查到预算拦截原因');
    assert(overTokens.record.usage.tokens === 5000, '运行记录累计 token（' + overTokens.record.usage.tokens + '）');

    // 回放：按记录里的工具调用重跑一遍，不花模型调用
    const store2 = core.createMemoryRunStore();
    const t5 = makeTool('rewrite3', { permission: 'write' });
    const a5 = makeAdapter({ script: [
      { calls: [{ name: 'rewrite3', args: { id: 'b0', text: '改写内容' } }] },
      { calls: [{ name: 'submit_result', args: {} }] }
    ] });
    const run = await core.runAgentRuntime({ adapter: a5.adapter, tools: [t5.spec], budget: { maxSteps: 4 }, store: store2 });
    const record = store2.get(run.runId);
    const replay = await core.replayRun(record, { tools: [t5.spec] });
    assert(replay.okCount === 1 && replay.errorCount === 0, '回放重跑记录里的工具调用（成功 ' + replay.okCount + '）');
    assert(replay.steps[0].tool === 'rewrite3' && JSON.stringify(replay.steps[0].data).includes('改写内容'),
      '回放使用的是记录下来的入参');
    assert(t5.calls.count === 2, '回放确实又执行了工具（累计 ' + t5.calls.count + ' 次）');
  }

  console.log('\nAgent Runtime 自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
})().catch((e) => {
  console.error('❌ 测试异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
