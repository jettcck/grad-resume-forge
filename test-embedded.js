'use strict';

// ============================================================
//  「零门槛」回归守卫：内嵌模型通道（应用内模型）结构性自测
//
//  背景：embedded-llm.js 曾以经典 <script> 加载却带顶层 export / TS 注解，
//  整个文件从未执行过，window.EmbeddedLlm 一直不存在——"零门槛"名存实亡。
//  本测试守住这条线：加载形态、国内镜像、CSP 放行、默认选项、诚实文案。
// ============================================================
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 1) embedded-llm.js 必须是可执行的经典脚本 ----------
const emb = R('src/renderer/embedded-llm.js');

// new Function 只编译不执行 —— 语法层面证明它能作为经典 <script> 跑起来
let syntaxOk = true;
try { new Function(emb); } catch (e) { syntaxOk = false; console.log('   语法错误:', e.message); }
assert(syntaxOk, 'embedded-llm.js 可作为经典脚本编译（无顶层 export / TS 注解）');
assert(!/^\s*export\s/m.test(emb), '无顶层 export（经典脚本禁止）');
assert(!/\bas\s+any\b/.test(emb) && !/\)\s*:\s*(boolean|string|number)\b/.test(emb), '无 TS 类型注解残留');
assert(/window\.EmbeddedLlm\s*=/.test(emb), '挂载 window.EmbeddedLlm（app.js 依赖此全局）');

// ---------- 2) 国内镜像直连（huggingface 直连在国内不通，探针实测） ----------
assert(/hf-mirror\.com\/mlc-ai\/Qwen2\.5-0\.5B-Instruct-q4f16_1-MLC\/resolve\/main\//.test(emb),
  '模型权重走 hf-mirror 镜像');
assert(/gh-proxy\.com\/https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs/.test(emb),
  '模型库 wasm 走 gh-proxy 代理');
assert(/'\.\.\/\.\.\/node_modules\/@mlc-ai\/web-llm\/lib\/index\.js'/.test(emb),
  'web-llm 用相对路径动态 import（dev 与 asar 打包同构）');
assert(/mirroredAppConfig/.test(emb) && /model_lib:\s*MIRROR_MODEL_LIB_URL/.test(emb),
  'appConfig 同时改写权重与模型库两个下载地址');
assert(/totalMB:\s*28\d/.test(emb), 'modelInfo 标注真实下载量（约 281MB，非 500MB）');
assert(/moduleSelfTest/.test(emb), '提供 moduleSelfTest 诊断入口（不触发 281MB 下载）');

// ---------- 3) CSP 必须放行镜像源 ----------
const html = R('src/renderer/index.html');
const csp = (html.match(/Content-Security-Policy[^>]*content="([^"]+)"/) || [])[1] || '';
assert(/connect-src[^;]*hf-mirror\.com/.test(csp), 'CSP connect-src 放行 hf-mirror.com');
assert(/connect-src[^;]*gh-proxy\.com/.test(csp), 'CSP connect-src 放行 gh-proxy.com');
assert(/script-src/.test(csp), 'CSP 显式声明 script-src（动态 import 依赖）');

// ---------- 4) 配置弹窗：默认选应用内模型 + 诚实文案 ----------
const app = R('src/renderer/app.js');
assert(/isCloudStored \? 'cloud' : 'embedded'/.test(app), '未配置时默认选「应用内模型」（零门槛首选）');
assert(/国内镜像/.test(app) && /281MB/.test(app), '配置弹窗明示 281MB 与国内镜像');
assert(!/约 500MB/.test(app), '配置弹窗不再宣称 500MB');

// ---------- 5) 全站无 500MB 夸大宣称 ----------
const knowledge = R('src/main/assistant-knowledge.ts');
assert(!/500\s?MB/.test(emb + app + knowledge + html), '渲染层/知识库无 500MB 旧口径');
assert(/281MB/.test(knowledge) && /镜像/.test(knowledge), '小助手「免安装」条目更新为 281MB + 镜像口径');

// ---------- 6) 自检钩子（打包版验证与用户自查用） ----------
const preload = R('src/main/preload.ts');
assert(/embeddedSelfTest/.test(preload) && /GRF_EMBEDDED_SELFTEST/.test(preload),
  'preload 暴露 env.embeddedSelfTest（GRF_EMBEDDED_SELFTEST=1 触发自检）');
assert(/embedded-selftest/.test(app), 'app.js 在自检模式下输出链路诊断日志');

// ---------- 7) README 双语：能力×依赖矩阵 + 措辞校准 ----------
const en = R('README.md');
const zh = R('README.zh-CN.md');
assert(/Zero-barrier/i.test(en) && /Needs a model/i.test(en), '英文 README 含能力×依赖矩阵');
assert(/零门槛起步/.test(zh) && /需要模型/.test(zh), '中文 README 含能力×依赖矩阵');
assert(/in-app model/i.test(en) && /281\s?MB/i.test(en), '英文 README 提及应用内模型与真实下载量');
assert(/应用内模型/.test(zh) && /281\s?MB/.test(zh), '中文 README 提及应用内模型与真实下载量');
assert(/hf-mirror/i.test(en) && /hf-mirror/.test(zh), '双语 README 说明国内镜像来源');

// ---------- 8) 本测试挂在 npm test 上（CI 门禁） ----------
const pkg = JSON.parse(R('package.json'));
assert(/test-embedded\.js/.test(pkg.scripts.test), 'npm test 包含 test-embedded.js');

console.log('\n零门槛守卫自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
