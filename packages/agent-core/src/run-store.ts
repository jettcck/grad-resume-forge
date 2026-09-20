'use strict';

// 运行记录：每次 Agent 运行留一条可复盘、可回放、可清理的记录。
//
// 脱敏原则（对应方案里的「可观测性」要求）：
//   - 不记录 API Key（这一层根本拿不到）
//   - 输入只留摘要指纹：简历不存正文、JD 不存原文，只存长度 + 指纹 + 结构统计
//   - 工具入参为回放保留，但字符串按 300 字截断，避免把整份简历写进日志
//   - 提供 clear()，界面上有「清理运行记录」入口
import fs from 'fs';
import path from 'path';
import { RunRecord, RunStore, InputSnapshot } from './types';

const ARG_MAX_STR = 300;

/** 简单稳定的字符串指纹：用于比对「是不是同一份输入」，不需要密码学强度 */
export function digest(text: string): string {
  let hash = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}

export function buildInputSnapshot(input: {
  profileName?: string;
  itemCount: number;
  sections: Record<string, number>;
  jd: string;
  profileDigestSource: string;
}): InputSnapshot {
  return {
    profileName: String(input.profileName || '').slice(0, 40),
    itemCount: input.itemCount,
    sections: input.sections,
    jdLength: String(input.jd || '').length,
    jdDigest: digest(String(input.jd || '')),
    profileDigest: digest(input.profileDigestSource || '')
  };
}

/** 截断工具入参里的长字符串，保留可回放的形状 */
export function truncateArgs(args: unknown, max = ARG_MAX_STR): unknown {
  if (typeof args === 'string') return args.length > max ? args.slice(0, max) + '…(' + args.length + '字)' : args;
  if (Array.isArray(args)) return args.map((a) => truncateArgs(a, max));
  if (args && typeof args === 'object') {
    const out: Record<string, unknown> = {};
    Object.keys(args as Record<string, unknown>).forEach((k) => {
      out[k] = truncateArgs((args as Record<string, unknown>)[k], max);
    });
    return out;
  }
  return args;
}

export function createMemoryRunStore(opts: { maxRuns?: number } = {}): RunStore {
  const maxRuns = opts.maxRuns || 50;
  const runs: RunRecord[] = [];
  return {
    append(rec) {
      runs.unshift(rec);
      if (runs.length > maxRuns) runs.length = maxRuns;
    },
    list(limit) {
      return runs.slice(0, limit == null ? runs.length : limit);
    },
    get(runId) {
      return runs.find((r) => r.runId === runId) || null;
    },
    clear() {
      const n = runs.length;
      runs.length = 0;
      return n;
    }
  };
}

/**
 * 文件版运行记录：JSONL 追加写，超过 maxRuns 就重写一份（而不是无限增长）。
 * 用追加写而不是整库重写，是为了不给主数据文件 db.json 增加体积与损坏风险。
 */
export function createFileRunStore(filePath: string, opts: { maxRuns?: number } = {}): RunStore {
  const maxRuns = opts.maxRuns || 50;

  function readAll(): RunRecord[] {
    try {
      if (!fs.existsSync(filePath)) return [];
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
      const out: RunRecord[] = [];
      lines.forEach((line) => {
        try { out.push(JSON.parse(line) as RunRecord); } catch (_) { /* 跳过坏行，不让一条脏数据毁掉全部记录 */ }
      });
      return out;
    } catch (_) {
      return [];
    }
  }

  function writeAll(list: RunRecord[]): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, list.map((r) => JSON.stringify(r)).join('\n') + (list.length ? '\n' : ''), 'utf-8');
      fs.renameSync(tmp, filePath);
    } catch (_) { /* 记录失败不影响主流程 */ }
  }

  return {
    append(rec) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, JSON.stringify(rec) + '\n', 'utf-8');
        const all = readAll();
        if (all.length > maxRuns) writeAll(all.slice(all.length - maxRuns));
      } catch (_) { /* 忽略 */ }
    },
    list(limit) {
      const all = readAll();
      const newestFirst = all.slice().reverse();
      return limit == null ? newestFirst : newestFirst.slice(0, limit);
    },
    get(runId) {
      return readAll().find((r) => r.runId === runId) || null;
    },
    clear() {
      const all = readAll();
      writeAll([]);
      return all.length;
    }
  };
}
