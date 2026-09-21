'use strict';

// CLI 自测（评审指出 CLI 覆盖不足）
// 守的是三件事：默认模式不能是「跑不通的模式」、退出码要反映业务结果、回放全跳过不能算成功。
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const ROOT = path.join(__dirname);
const CLI = path.join(ROOT, 'packages', 'agent-cli', 'dist', 'index.js');
const run = (args, env) => spawnSync(process.execPath, [CLI, ...args], {
  cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env || {})
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-cli-'));
const caseFile = path.join(tmp, 'case.json');
fs.writeFileSync(caseFile, JSON.stringify({
  profile: {
    summary: '求职后端', skills: 'Java, MySQL',
    projects: [{ name: '订单系统', tech: 'Java', description: '负责订单系统开发，支撑日活 3 万\n通过赋能业务实现降本增效' }],
    internships: []
  },
  jd: '岗位：Java 后端工程师\n要求：熟悉 Java 与 MySQL，了解 Docker'
}, null, 2), 'utf8');

// 1) 默认模式必须能跑：不再默认给一个「没模型就跑不通」的 pipeline
const def = run(['run', '--input', caseFile]);
assert(def.status === 0, '不带 --mode 直接跑能成功（退出码 ' + def.status + '，默认已改为不需模型的 rules）');
let parsed = {};
try { parsed = JSON.parse(def.stdout); } catch (_) { /* 下面断言会报 */ }
assert(parsed.ok === true && parsed.accepted > 0, '默认模式产出可用改写（accepted=' + parsed.accepted + '）');
assert(parsed.mode === 'rules', '默认模式是 rules（' + parsed.mode + '）');

// 2) 需要模型的模式在没配模型时必须明确报错，而不是抛异常
const pipe = run(['run', '--input', caseFile, '--mode', 'pipeline'], { AGENT_BENCH_ENDPOINT: '', AGENT_BENCH_MODEL: '' });
assert(pipe.status === 2, 'pipeline 模式缺模型时退出码为 2（实得 ' + pipe.status + '）');
assert(/需要模型/.test(pipe.stderr), '并给出明确提示（' + pipe.stderr.trim().split('\n')[0] + '）');

// 3) 退出码反映业务结果：一条改写都没过校验门时不能返回 0
const noGood = path.join(tmp, 'nogood.json');
fs.writeFileSync(noGood, JSON.stringify({
  profile: { summary: '', skills: '', projects: [{ name: 'x', description: '通过赋能业务实现降本增效' }], internships: [] },
  jd: '岗位：Java 后端工程师'
}, null, 2), 'utf8');
const bad = run(['run', '--input', noGood]);
if (bad.status === 0) {
  const out = JSON.parse(bad.stdout || '{}');
  assert(out.ok === false && out.accepted === 0 && bad.status === 1,
    '没有改写通过校验门时 ok=false 且退出码非 0（ok=' + out.ok + '，exit=' + bad.status + '）');
} else {
  assert(true, '没有可改写内容时以非 0 退出（exit=' + bad.status + '）');
}

// 4) 空数组不再是「成功」：ok 必须是真布尔判断
const okField = JSON.parse(def.stdout || '{}').ok;
assert(okField === true && JSON.parse(bad.stdout || '{"ok":false}').ok !== true,
  'ok 字段反映真实业务结果，不是数组真值');

// 5) 回放：全跳过（记录是脱敏的、没有入参原文）不能算成功
const runsFile = path.join(tmp, 'runs.jsonl');
const rec = {
  runId: 'run_cli_test', taskId: 'cli-run', status: 'COMPLETED', currentStep: 'completed',
  createdAt: Date.now(), startedAt: Date.now(), finishedAt: Date.now(), error: null, cancelReason: null,
  inputSnapshot: { itemCount: 1, sections: { projects: 1 }, jdLength: 10, jdDigest: 'aaaa1111:10', profileDigest: 'bbbb2222:20' },
  budget: { maxSteps: 10, maxToolCalls: 40, maxDurationMs: 180000, maxTokens: 120000 },
  usage: { steps: 2, toolCalls: 1, retries: 0, ms: 10, tokens: 0 },
  trace: [{ runId: 'run_cli_test', stepId: 1, tool: 'rewrite_bullets', inputSummary: '摘要', outputSummary: '接受 1', latencyMs: 5, retryCount: 0, tokens: null, errorType: null, startedAt: Date.now(), args: { rewrites: [{ id: 'p0-b0', text: { len: 17, digest: 'abc12345:17' } }] } }],
  result: null
};
fs.writeFileSync(runsFile, JSON.stringify(rec) + '\n', 'utf8');
const replay = run(['replay', '--run', 'run_cli_test', '--runs', runsFile, '--input', caseFile]);
assert(replay.status === 1, '全跳过的回放退出码非 0（实得 ' + replay.status + '）');
const replayOut = JSON.parse(replay.stdout || '{}');
assert(replayOut.skipped >= 1 && replayOut.okCount === 0, 'CLI 输出里带上了 skipped（' + replayOut.skipped + ' 步）');
assert(/skippedReason|提示/.test(replay.stderr + replay.stdout), '并说明为什么跳过（脱敏记录没有入参原文）');

// 6) 找不到记录时明确报错
const missing = run(['replay', '--run', 'run_not_exist', '--runs', runsFile]);
assert(missing.status === 2 && /没有找到/.test(missing.stderr), '记录不存在时退出码 2 并说明');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
console.log('\nCLI 自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
