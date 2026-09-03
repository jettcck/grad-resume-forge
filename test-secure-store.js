'use strict';

// 密钥安全存储测试：分两层
//  - 纯 Node 层（本文件）：函数契约与降级路径（safeStorage 缺失时行为）
//  - Electron 层（scripts/screenshot.js）：真实 DPAPI 加解密往返
const path = require('path');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---- 1) 纯 Node：mock electron 模块缺失场景（降级明文） ----
// secure-store require('electron') 在纯 Node 下会怎样？
// electron 模块在 node 直跑时导出路径字符串（非 API 对象），safeStorage 为 undefined
// —— secure-store 对此的防御：isAvailable 返回 false，encrypt 原样返回。
const secure = require('./src/main/secure-store');
assert(typeof secure.isAvailable === 'function', '模块可加载（纯 Node 下 safeStorage 不可用）');
assert(secure.isAvailable() === false, '纯 Node 环境 isAvailable()=false（降级路径）');
assert(secure.encryptString('sk-test-123') === 'sk-test-123', '降级：加密原样返回明文');
assert(secure.decryptString('sk-test-123') === 'sk-test-123', '向前兼容：旧明文直接透传');
assert(secure.decryptString('') === '', '空字符串处理');
assert(secure.encryptString('') === '', '空值不加密');
assert(secure.isEncrypted('enc:v1:xxxx') === true, '密文前缀识别');
assert(secure.isEncrypted('sk-plain') === false, '明文识别');
// 有密文但环境不可解密：返回空（UI 引导重填），不抛异常
assert(secure.decryptString('enc:v1:AAAA') === '', '密文在不可解密环境返回空串（引导重填）');

// ---- 2) 语义不变量：加解密往返在 Electron 层验证（见 screenshot.js 断言） ----
console.log('（真实 DPAPI 往返断言在 scripts/screenshot.js 的 Electron 环境中执行）');

console.log('\nsecure-store 自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
