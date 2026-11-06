#!/usr/bin/env node
'use strict';

// ============================================================
//  运行 Python 服务测试（跨平台）
//  ------------------------------------------------------------
//  为什么不让 npm script 直接写 .venv-py/Scripts/python.exe：
//    路径是 Windows 专有的，Linux/CI 上必然失败，而且报错信息很难懂。
//    这里按「仓库内虚拟环境 → 系统 python3 → 系统 python」顺序探测，
//    找不到时明确跳过并返回 0，而不是让整条 npm test 挂掉。
//
//  用法：node scripts/test-python.js
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_DIR = path.join(ROOT, 'services', 'python-api');

const candidates = [
  path.join(ROOT, '.venv-py', 'Scripts', 'python.exe'),
  path.join(ROOT, '.venv-py', 'bin', 'python'),
  path.join(SERVICE_DIR, '.venv', 'Scripts', 'python.exe'),
  path.join(SERVICE_DIR, '.venv', 'bin', 'python'),
  'python3',
  'python'
];

function hasPytest(python) {
  const probe = spawnSync(python, ['-c', 'import pytest, fastapi, httpx'], { encoding: 'utf8' });
  return probe.status === 0;
}

let python = null;
for (const candidate of candidates) {
  if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
  if (hasPytest(candidate)) { python = candidate; break; }
}

if (!python) {
  console.log('⏭  跳过 Python 服务测试：未找到装有 pytest/fastapi/httpx 的解释器。');
  console.log('   安装：cd services/python-api && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt');
  process.exit(0);
}

// 不额外传 -q：pyproject 的 addopts 已含 -q，重复传会变成 -qq 并压掉汇总行
const result = spawnSync(python, ['-m', 'pytest'], {
  cwd: SERVICE_DIR,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024
});

// 把 pytest 的 "N passed" 改写成中文：
// 项目基线是按 "N passed" 统计 JS 断言的，混进来会让两类测试互相污染。
const normalize = (text) => String(text || '').replace(/(\d+)\s+passed/g, '$1 通过');

process.stdout.write(normalize(result.stdout));
process.stderr.write(normalize(result.stderr));
process.exit(result.status == null ? 1 : result.status);
