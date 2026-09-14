'use strict';

// Probe: is jdMissingAfter stale (does it still list a skill the rewrite added)?
// Three paths: rules / pipeline / agentic. Run: node scripts/probe-jd-missing.js
const path = require('path');
const agent = require(path.join(__dirname, '..', 'dist/main/agent'));

const PROF = {
  name: '张三', targetRole: '后端开发工程师', skills: 'Java, MySQL', summary: '',
  education: [],
  projects: [{ name: '订单系统', role: '后端', period: '2022', tech: 'Java', description: '负责订单接口开发，把 P99 从 800ms 降到 120ms' }],
  internships: []
};
const JD = '任职要求：熟悉 Java、MySQL、Docker、Redis，有消息队列经验。岗位职责：负责后端服务开发。';

// 一个会「补上 Docker」的假模型：保留全部数字、不加套话，确保能过确定性校验门
const addDockerJson = JSON.stringify({
  rewrites: [{ id: 'p0-b0', text: '负责订单接口开发，用 Docker 部署，把 P99 从 800ms 降到 120ms' }]
});
const mockLlm = (replies) => {
  let i = 0;
  return { chat: async () => replies[Math.min(i++, replies.length - 1)] };
};
// agentic loop 需要工具调用能力：给出 submit_result 形状的回复
const mockAgentic = () => {
  let step = 0;
  return {
    chat: async () => {
      step++;
      if (step === 1) {
        return JSON.stringify({
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'rewrite_bullets', arguments: JSON.stringify({ rewrites: [{ id: 'p0-b0', text: '负责订单接口开发，用 Docker 部署服务，P99 从 800ms 降到 120ms，Redis 缓存命中率 92%' }] }) } }]
        });
      }
      if (step === 2) {
        return JSON.stringify({ tool_calls: [{ id: 'c2', type: 'function', function: { name: 'analyze_jd', arguments: '{}' } }] });
      }
      return JSON.stringify({ tool_calls: [{ id: 'c3', type: 'function', function: { name: 'submit_result', arguments: '{}' } }] });
    }
  };
};

const show = (label, r) => {
  console.log(label);
  console.log('  jdBefore=' + r.jdBefore + '  jdAfter=' + r.jdAfter + '  auditBefore=' + r.auditBefore + '  auditAfter=' + r.auditAfter);
  console.log('  accepted=' + r.accepted.length + '  rejected=' + JSON.stringify((r.rejected || []).map((x) => x.id + ':' + x.reason)));
  console.log('  jdMissingAfter=' + JSON.stringify(r.jdMissingAfter));
  if (r.error) console.log('  error=' + r.error);
  const stale = r.jdAfter > r.jdBefore && r.jdMissingAfter.some((m) => /docker/i.test(m));
  console.log('  → ' + (stale ? '❌ 声称已补上 Docker 却仍列在缺失里（旧数据）' : '✅ 与复测结果一致'));
};

(async () => {
  show('=== 1) 规则通道（无模型）===', await agent.runAgent(PROF, JD, { rulesOnly: true }));
  show('=== 2) pipeline（假模型补 Docker）===', await agent.runAgent(PROF, JD, { llm: mockLlm([addDockerJson]), maxRounds: 1 }));
  show('=== 3) agentic（假模型补 Docker）===', await agent.runAgent(PROF, JD, { llm: mockAgentic(), mode: 'agentic', maxRounds: 1 }));
})();
