'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { execFileSync } = require('child_process');
const agent = require('../dist/main/agent');
const evidenceLib = require('../dist/main/resume-evidence');
const { createLlmClient } = require('../packages/llm-adapters/dist/index');
const { summarize } = require('./real-model-metrics');
const cases = require('./resume-evidence-cases');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const sampleIndex = args.indexOf('--sample');
const sample = sampleIndex < 0 ? 3 : Math.max(1, Number(args[sampleIndex + 1]) || 3);
const SELF_TEST = args.includes('--self-test');
const outputIndex = args.indexOf('--output');
const output = path.resolve(ROOT, outputIndex < 0 ? 'benchmarks/resume-evidence.json' : args[outputIndex + 1]);
const endpoint = process.env.AGENT_BENCH_ENDPOINT || 'http://127.0.0.1:11434';
const model = process.env.AGENT_BENCH_MODEL || 'qwen2.5:1.5b';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const pct = (num, den) => den ? Math.round(num / den * 1000) / 10 : null;
function git(params) {
  try { return execFileSync('git', params, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) { return ''; }
}

function snapshot() {
  const files = new Set(Object.keys(require.cache).filter((file) => file.startsWith(ROOT + path.sep) && !file.includes(path.sep + 'node_modules' + path.sep)));
  for (const name of ['package.json', 'package-lock.json']) files.add(path.join(ROOT, name));
  for (const version of Object.values(agent.promptVersions())) files.add(path.join(ROOT, 'prompts', version + '.txt'));
  const payload = JSON.stringify({ schemaVersion: 1, files: [...files].sort().map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return { path: path.relative(ROOT, file).replace(/\\/g, '/'), sha256: hash(text), text };
  }) });
  const sha256 = hash(payload), relative = 'benchmarks/source-snapshots/' + sha256.slice(0, 16) + '.json';
  fs.mkdirSync(path.dirname(path.join(ROOT, relative)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, relative), payload + '\n');
  return { path: relative, sha256 };
}

async function metadata() {
  const [tags, version, shown] = await Promise.all([
    fetch(endpoint + '/api/tags', { signal: AbortSignal.timeout(5000) }).then((r) => r.json()),
    fetch(endpoint + '/api/version', { signal: AbortSignal.timeout(5000) }).then((r) => r.json()),
    fetch(endpoint + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }), signal: AbortSignal.timeout(5000) }).then((r) => r.json())
  ]);
  const installed = tags.models.find((m) => m.name === model || m.name === model + ':latest');
  assert(installed, '端点没有模型 ' + model);
  return { digest: installed.digest, details: shown.details, ollamaVersion: version.version };
}

function measuredClient(client) {
  const requests = [];
  return { requests, client: { chat: async (messages, options = {}) => {
    const start = Date.now(); let usage, content = '', error = null;
    try {
      const reply = await client.chat(messages, { ...options, onUsage: (u) => { usage = u; options.onUsage?.(u); } });
      content = typeof reply === 'string' ? reply : reply.content;
      return reply;
    } catch (e) { error = e.message; throw e; }
    finally { requests.push({ ms: Date.now() - start, tokens: usage?.total_tokens ?? null,
      promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null,
      content: content.slice(0, 4000), error }); }
  } } };
}

function metrics(rows) {
  const accepted = rows.flatMap((r) => r.acceptedRewrites || []);
  const eligible = rows.filter((r) => r.expectedSkill);
  return { ...summarize(rows),
    targetSkillHits: eligible.filter((r) => r.targetSkillHit).length,
    targetSkillRuns: eligible.length,
    targetSkillCoverage: pct(eligible.filter((r) => r.targetSkillHit).length, eligible.length),
    sourceCoverage: pct(rows.reduce((n, r) => n + r.verifiedSources, 0), accepted.length),
    unsupportedSkillAccepted: rows.reduce((n, r) => n + r.unsupportedSkillAccepted, 0),
    evidenceRejections: rows.reduce((n, r) => n + (r.rejections || []).filter((x) => /经历证据|本条经历证据|编造技能/.test(x.reason)).length, 0)
  };
}

async function main() {
  const modelInfo = SELF_TEST ? null : await metadata();
  const sourceSnapshot = SELF_TEST ? null : snapshot();
  const client = SELF_TEST ? null : createLlmClient({ provider: 'ollama', endpoint, model, temperature: 0.3, timeout: 60000 });
  const runs = [];
  console.log('=== 用户经历检索 · 同输入有/无检索对照 ===');
  for (const c of cases) for (let repeat = 1; repeat <= sample; repeat++) {
    for (const mode of repeat % 2 ? ['none', 'bm25'] : ['bm25', 'none']) {
      const fake = { chat: async (_messages, options) => {
        options.onUsage?.({ prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 });
        const source = c.profile.projects[0].description;
        const text = c.expectedSkill && mode === 'bm25' ? c.expectedSkill + ' ' + source : source;
        return JSON.stringify({ rewrites: [{ id: 'p0-b0', text }] });
      } };
      const measured = measuredClient(client || fake), start = Date.now();
      const result = await agent.runAgent(c.profile, c.jd, { llm: measured.client, evidenceMode: mode,
        maxRounds: 2, maxDurationMs: 60000 });
      let verifiedSources = 0;
      for (const rewrite of result.accepted) {
        try { evidenceLib.resolveEvidence(c.profile, rewrite.id, rewrite.evidence); verifiedSources++; } catch (_) {}
      }
      const target = result.accepted.find((r) => r.id === 'p0-b0');
      const targetSkillHit = !!target && !!c.expectedSkill && target.text.toLowerCase().includes(c.expectedSkill) &&
        target.evidence.some((ref) => ref.sourceId === c.expectedSource);
      const unsupportedSkillAccepted = result.accepted.filter((r) => r.id === 'p0-b0' &&
        c.forbiddenSkills.some((skill) => r.text.toLowerCase().includes(skill))).length;
      const lost = result.accepted.filter((r) => agent.numberTokens(r.old).some((n) => !agent.numberTokens(r.text).includes(n))).length;
      const requests = measured.requests;
      const row = { case: c.id, run: repeat, mode, ok: result.ok, ms: Date.now() - start,
        steps: result.rounds, status: result.run.status, error: result.error,
        accepted: result.accepted.length, rejected: result.rejected.length,
        targetBullets: agent.buildTaskItems(c.profile).reduce((n, i) => n + i.lines.length, 0),
        requests, tokens: requests.every((r) => r.tokens != null) ? requests.reduce((n, r) => n + r.tokens, 0) : null,
        lost, fabricated: unsupportedSkillAccepted, unsupportedSkillAccepted, verifiedSources,
        expectedSkill: c.expectedSkill, targetSkillHit, acceptedRewrites: result.accepted,
        rejections: result.rejected, stepTrace: result.steps,
        retrievedSources: evidenceLib.evidencePayload(evidenceLib.createProfileEvidence(c.profile, c.jd, mode)) };
      runs.push(row);
      console.log(c.id + ' #' + repeat + ' ' + mode + ' | ok=' + row.ok + ' | 接受=' + row.accepted +
        ' | 目标技能=' + targetSkillHit + ' | ' + row.ms + 'ms');
    }
  }
  const byMode = Object.fromEntries(['none', 'bm25'].map((mode) => [mode, metrics(runs.filter((r) => r.mode === mode))]));
  console.log(JSON.stringify(byMode, null, 2));
  if (SELF_TEST) {
    assert(runs.every((r) => r.requests.length === r.steps && r.tokens > 0));
    assert(runs.every((r) => r.verifiedSources === r.accepted));
    assert.strictEqual(byMode.bm25.targetSkillCoverage, 100);
    assert.strictEqual(byMode.none.targetSkillCoverage, 0);
    assert.strictEqual(byMode.bm25.unsupportedSkillAccepted, 0);
    console.log('评测链路自测通过；真实模型报告与源码快照均未写入。');
    return;
  }
  const commit = git(['rev-parse', 'HEAD']);
  const report = {
    schemaVersion: 1, suite: 'resume-evidence-ablation', suiteVersion: '1', timestamp: new Date().toISOString(),
    provider: 'ollama', endpoint, model, modelInfo, temperature: 0.3, sample, cases: cases.length,
    modes: ['none', 'bm25'], runner: 'pipeline', maxRounds: 2, maxDurationMs: 60000,
    contextWindow: 'server-default', rateUnit: 'percent',
    promptVersion: agent.promptVersions(), commit, commitShort: commit.slice(0, 7), gitDirty: !!git(['status', '--porcelain']),
    runtime: { node: process.version, platform: process.platform, arch: process.arch }, sourceSnapshot,
    caseSet: { id: 'resume-evidence-fixed-v1', count: cases.length, sha256: hash(JSON.stringify(cases)), inputs: cases },
    reproducible: { reproducible: !!commit && !!modelInfo.digest && !!sourceSnapshot.sha256, missingFields: [] },
    metrics: metrics(runs), byMode, runs
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log('已写入 ' + output);
}
main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
