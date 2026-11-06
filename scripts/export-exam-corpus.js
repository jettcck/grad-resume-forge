#!/usr/bin/env node
'use strict';

// ============================================================
//  把题库导出成 Python 服务可直接读取的语料
//  ------------------------------------------------------------
//  为什么要导出而不是让 Python 去解析 TS：
//    Python 服务要能独立部署（容器里没有 Node，也不该为了读题库装一个）。
//    导出成 JSON 是最小契约；题库变了重跑本脚本即可。
//
//  用法：node scripts/export-exam-corpus.js
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'services', 'python-api', 'data', 'corpus.json');

const bank = require(path.join(ROOT, 'dist', 'main', 'exam-bank.js'));
const items = bank.EXAM_BANK || [];
if (!items.length) {
  console.error('题库为空，先执行 npm run build:core / tsc');
  process.exit(1);
}

const docs = items.map((q) => ({
  id: q.id,
  domain: q.domain || '',
  tags: q.tags || [],
  difficulty: q.difficulty || 0,
  // 检索文本 = 题干 + 选项：解析太长且容易带出答案原文，不作为召回依据
  text: [q.stem, ...(q.options || [])].filter(Boolean).join(' ')
}));

const payload = {
  version: bank.BANK_VERSION || null,
  source: 'src/main/exam-bank.ts',
  count: docs.length,
  generatedAt: new Date().toISOString(),
  docs
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('已写入', path.relative(ROOT, OUT), '| 文档数', docs.length, '| 题库版本', payload.version);
