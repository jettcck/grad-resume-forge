'use strict';

const assert = require('assert');
const FORBIDDEN_ALIASES = {
  'backend-profile-java-jd-v1': [['docker', '容器化', 'containerization'], ['分布式', 'distributed']],
  'frontend-profile-vue-jd-v1': [['react', 'reactjs', 'react.js', 'react native']]
};
const pct = (x) => Math.round(x * 1000) / 10;
const mean = (xs) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
const toPercent = (value, unit) => value == null ? null : (unit === 'percent' ? value : value * 100);

function forbiddenSkills(caseId, text) {
  const lower = String(text || '').toLowerCase();
  return (FORBIDDEN_ALIASES[caseId] || []).filter((aliases) => aliases.some((alias) => {
    if (!/^[a-z]/.test(alias)) return lower.includes(alias);
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])').test(lower);
  })).map((aliases) => aliases[0]);
}

function failureType(row) {
  if (row.ok) return null;
  const error = String(row.error || '');
  if (/token.*预算/i.test(error)) return 'token_budget';
  if (/超时|timeout|aborted/i.test(error)) return 'timeout';
  if (/步数上限/.test(error)) return 'step_budget';
  if (/工具调用次数.*上限/.test(error)) return 'tool_budget';
  if (/未调用工具/.test(error)) return 'no_tool_calls';
  if (/HTTP|fetch failed|ECONN/i.test(error)) return 'request_error';
  if (row.status === 'CANCELLED') return 'cancelled';
  if (row.status === 'PARTIAL' || row.incomplete) return 'incomplete';
  if (!row.accepted) return row.rejected ? 'all_rejected' : 'no_accepted_rewrites';
  return 'runtime_error';
}

function wilson(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054, p = successes / total, d = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / d;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d;
  return [pct(Math.max(0, center - half)), pct(Math.min(1, center + half))];
}

function quantile(xs, p) {
  if (!xs.length) return null;
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function summarize(rows) {
  const total = rows.length;
  const ok = rows.filter((r) => r.ok).length;
  const accepted = rows.reduce((s, r) => s + (r.accepted || 0), 0);
  const rejected = rows.reduce((s, r) => s + (r.rejected || 0), 0);
  const requests = rows.reduce((s, r) => s + (r.requests || []).length, 0);
  const knownRequests = rows.flatMap((r) => r.requests || []).filter((r) => r.tokens != null);
  const tokensReported = knownRequests.reduce((s, r) => s + r.tokens, 0);
  const failures = {};
  for (const row of rows) { const kind = failureType(row); if (kind) failures[kind] = (failures[kind] || 0) + 1; }
  const lost = rows.reduce((s, r) => s + (r.lost || 0), 0);
  const fabricated = rows.reduce((s, r) => s + (r.fabricated || 0), 0);
  const targets = rows.reduce((s, r) => s + (r.targetBullets || 0), 0);
  return {
    totalRuns: total, completedRuns: ok, failedRuns: total - ok,
    returnedRuns: rows.filter((r) => !r.transportError).length,
    successRate: total ? pct(ok / total) : null,
    successRateCi95: wilson(ok, total),
    acceptanceRate: accepted + rejected ? pct(accepted / (accepted + rejected)) : null,
    avgLatencyMs: mean(rows.map((r) => r.ms)),
    p50LatencyMs: quantile(rows.map((r) => r.ms), 0.5),
    p95LatencyMs: quantile(rows.map((r) => r.ms), 0.95),
    avgSteps: total ? Math.round(rows.reduce((s, r) => s + (r.steps || 0), 0) / total * 10) / 10 : null,
    avgTokens: requests === knownRequests.length && total ? mean(rows.map((r) => r.tokens)) : null,
    tokens: requests === knownRequests.length ? tokensReported : null,
    tokensReported, tokenReportedRequests: knownRequests.length, modelRequests: requests,
    tokenCoverage: requests ? pct(knownRequests.length / requests) : null,
    accepted, rejected, metricLoss: lost, fabricated,
    targetBullets: targets,
    acceptedCoverage: targets ? pct(accepted / targets) : null,
    hallucinationRate: accepted ? pct(fabricated / accepted) : null,
    failureCounts: failures
  };
}

function selfTest() {
  assert.deepStrictEqual(forbiddenSkills('backend-profile-java-jd-v1', '采用 Docker 与容器化部署'), ['docker']);
  assert.deepStrictEqual(forbiddenSkills('frontend-profile-vue-jd-v1', 'react.js 页面'), ['react']);
  assert.deepStrictEqual(forbiddenSkills('frontend-profile-vue-jd-v1', 'reactive 数据'), []);
  assert.strictEqual(failureType({ ok: true, error: '旧错误' }), null);
  assert.strictEqual(failureType({ ok: false, error: '模型连续未调用工具，终止' }), 'no_tool_calls');
  assert.strictEqual(failureType({ ok: false, error: '运行超时' }), 'timeout');
  assert.strictEqual(failureType({ ok: false, status: 'PARTIAL', accepted: 1 }), 'incomplete');
  const rows = [{ ok: false, ms: 100, accepted: 0, rejected: 1, steps: 2, tokens: 15,
    requests: [{ tokens: 15 }] }, { ok: true, ms: 10, accepted: 2, rejected: 0, steps: 1, tokens: 5, requests: [{ tokens: 5 }] }];
  const m = summarize(rows);
  assert.strictEqual(m.successRate, 50);
  assert.strictEqual(m.completedRuns, 1);
  assert.strictEqual(m.avgLatencyMs, 55);
  assert.strictEqual(m.avgTokens, 10);
  assert.deepStrictEqual(m.failureCounts, { all_rejected: 1 });
  assert.deepStrictEqual(wilson(0, 12), [0, 24.2]);
  assert.strictEqual(summarize([{ ok: false, ms: 10, requests: [{ tokens: null }] }]).tokens, null);
  assert.strictEqual(summarize([{ ok: false, ms: 10, accepted: 0 }]).hallucinationRate, null);
  assert.strictEqual(toPercent(0.5, 'percent'), 0.5);
  assert.strictEqual(toPercent(0.005, 'fraction'), 0.5);
  console.log('评测指标自测：17 项通过');
}

module.exports = { forbiddenSkills, failureType, summarize, selfTest, toPercent };
if (require.main === module) selfTest();
