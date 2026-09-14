'use strict';

// Debug: why does the agentic submit guard not behave?
const path = require('path');
const agent = require(path.join(__dirname, '..', 'dist/main/agent'));

const PROFILE = {
  name: '李明', targetRole: '后端开发工程师', skills: 'Java, MySQL',
  summary: '后端开发，写过订单系统',
  education: [],
  projects: [{ name: '订单系统', role: '后端', period: '2022', tech: 'Java', description: '负责订单接口开发，把 P99 从 800ms 降到 120ms' }],
  internships: []
};
const JD = '任职要求：熟悉 Java、MySQL、Redis。岗位职责：后端服务开发。';

const call = (name, args) => ({ content: '', toolCalls: [{ name, args: args || {}, raw: { id: 'c-' + name } }], rawToolCalls: [] });

(async () => {
  console.log('=== A) 一上来就收工 ===');
  const lazy = { chat: async () => call('submit_result', {}) };
  const a = await agent.agenticLoop(PROFILE, JD, { llm: lazy, maxSteps: 6 });
  console.log('ok=' + a.ok, '| error=' + JSON.stringify(a.error), '| accepted=' + a.accepted.length);
  console.log('steps:', (a.steps || []).map((s) => (s.ok ? '✓' : '✗') + s.tool + '@' + s.label).join(' | '));

  console.log('=== B) 正常流程 ===');
  let step = 0;
  const good = {
    chat: async () => {
      step++;
      if (step === 1) return call('analyze_jd', {});
      if (step === 2) return call('rewrite_bullets', { rewrites: [{ id: 'p0-b0', text: '主导订单查询优化，P99 从 800ms 降到 120ms' }] });
      if (step === 3) return call('audit_text', {});
      return call('submit_result', {});
    }
  };
  const b = await agent.agenticLoop(PROFILE, JD, { llm: good, maxSteps: 8 });
  console.log('ok=' + b.ok, '| error=' + JSON.stringify(b.error), '| incomplete=' + JSON.stringify(b.incomplete), '| accepted=' + b.accepted.length, '| rejected=' + JSON.stringify(b.rejected.map((r) => r.id + ':' + r.reason)));
  console.log('steps:', (b.steps || []).map((s) => (s.ok ? '✓' : '✗') + s.tool).join(' | '));
})();
