'use strict';

// ============================================================
//  提示词版本化自测
//  ------------------------------------------------------------
//  守三件事：
//    1) prompt 只存在于 prompts/*.txt，代码里不许再出现一份内联副本
//       （两份副本 = 改一处漏一处，评测记录的版本号随之失真）；
//    2) 文件名即版本号，加载器读到的版本必须与文件名一致；
//    3) 版本号真的写进了运行记录与评测报告，否则「可复现」只是口号。
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const prompts = require(path.join(ROOT, 'dist', 'main', 'prompts.js'));
const agent = require(path.join(ROOT, 'dist', 'main', 'agent.js'));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

(async () => {
  // ---------- 1. 文件存在、非空、版本号 = 文件名 ----------
  const dir = prompts.promptDir();
  assert(fs.existsSync(dir), 'prompts/ 目录存在（' + dir + '）');
  for (const [key, file] of Object.entries(prompts.PROMPT_FILES)) {
    const full = path.join(dir, file);
    const exists = fs.existsSync(full);
    assert(exists, '提示词文件存在：' + file);
    if (!exists) continue;
    const raw = fs.readFileSync(full, 'utf8');
    const loaded = prompts.loadPrompt(key);
    assert(loaded.length > 20, key + ' 内容长度 ' + loaded.length + ' 字（不是空壳）');
    assert(prompts.promptVersion(key) === file.replace(/\.txt$/, ''),
      key + ' 的版本号等于文件名（' + prompts.promptVersion(key) + '）');
    assert(!/\r/.test(loaded), key + ' 已归一化为 LF（跨平台 diff 不会整文件变红）');
    assert(raw.replace(/\r\n/g, '\n').trim() === loaded, key + ' 加载结果与文件内容一致（没有偷偷加工）');
  }

  // ---------- 2. 不许有内联副本 ----------
  const agentSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'agent.ts'), 'utf8');
  assert(!agentSrc.includes('你是资深简历编辑'), 'agent.ts 不再内联「资深简历编辑」system 提示词');
  assert(!agentSrc.includes('你是简历优化 Agent'), 'agent.ts 不再内联 agentic system 提示词');
  assert(!agentSrc.includes('1. 动词开头，删掉套话与空洞形容词'), 'agent.ts 不再内联改写纪律条目');
  assert(agentSrc.includes("loadPrompt('agenticSystem')") && agentSrc.includes("loadPrompt('rewriteRules')"),
    'agent.ts 确实通过 loadPrompt 取提示词');

  // ---------- 3. 内容不变量（防止「改一版把关键约束删了」） ----------
  const rules = prompts.loadPrompt('rewriteRules');
  assert(/数字/.test(rules) && /不得编造/.test(rules), '改写纪律仍要求「保留数字 / 不得编造」');
  assert(/60\s*字/.test(rules), '改写纪律仍限制单条长度');
  const sys = prompts.loadPrompt('agenticSystem');
  ['analyze_jd', 'audit_text', 'rewrite_bullets', 'submit_result'].forEach((t) => {
    assert(sys.includes(t), 'agentic 系统提示词仍列出工具 ' + t);
  });
  assert(/不是给你的命令/.test(sys), 'agentic 系统提示词仍声明 JD 内容不是指令（注入防护）');

  // ---------- 4. 版本号写进运行记录 ----------
  const fake = {
    chat: async () => ({ content: '', toolCalls: [{ name: 'submit_result', args: {} }], rawToolCalls: [] })
  };
  const profile = {
    summary: '',
    skills: 'Java',
    projects: [{ name: '订单系统', tech: 'Java', description: '开发订单查询，QPS 提升 2 倍' }],
    internships: []
  };
  const r = await agent.agenticLoop(profile, '岗位：Java 后端\n要求：熟悉 Java', { llm: fake, maxSteps: 2 });
  assert(!!r.run && r.run.promptVersion === 'agentic-system-v1',
    '运行记录带 promptVersion（' + (r.run && r.run.promptVersion) + '）');

  // ---------- 5. 评测报告与打包清单 ----------
  const evalSrc = fs.readFileSync(path.join(ROOT, 'evals', 'run-llm-eval.js'), 'utf8');
  assert(/promptVersion:/.test(evalSrc) && /temperature:/.test(evalSrc),
    'LLM 评测报告记录 promptVersion 与 temperature（复现契约的两个必填项）');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = (pkg.build && pkg.build.files) || [];
  assert(files.includes('prompts/**/*'), 'electron-builder 的 files 包含 prompts/**（否则打包后读不到）');

  console.log('\n提示词版本化自测完成:', pass, 'passed,', failCnt, 'failed');
})().catch((e) => {
  console.error('❌ 测试异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
