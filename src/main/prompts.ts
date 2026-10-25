'use strict';

// ============================================================
//  提示词加载器（版本化的那一半）
//  ------------------------------------------------------------
//  为什么要把 prompt 从代码里搬出来：
//    prompt 是「会被反复调参的输入」，不是「逻辑」。写在 agent.ts 里时，
//    改一个字就混进代码 diff，评测报告也没法记录「这次跑的是哪版」，
//    于是「prompt 改好了吗」只能回答「我手动试过」。
//
//  约定：
//    1) 文件名即版本号：rewrite-system-v1.txt → 版本 'rewrite-system-v1'；
//    2) 改内容必须新建 -v2 文件，不许原地改 v1（否则历史评测记录全部失真）；
//    3) 运行记录与评测报告都带 promptVersion，复现时按版本号取回原文。
//
//  打包：electron-builder 的 files 里必须包含 prompts/**（见 package.json），
//  运行时路径是 app.asar/prompts。
// ============================================================

import fs from 'fs';
import path from 'path';

export const PROMPT_FILES = {
  /** 流水线模式：单条批量改写的 system 消息 */
  rewriteSystem: 'rewrite-system-v1.txt',
  /** 流水线模式：改写纪律与输出格式（拼在 user 消息尾部） */
  rewriteRules: 'rewrite-rules-v1.txt',
  /** Agent 模式：系统提示词（工具说明与流程） */
  agenticSystem: 'agentic-system-v2.txt'
} as const;

export type PromptKey = keyof typeof PROMPT_FILES;

const cache = new Map<PromptKey, string>();

export function promptDir(): string {
  // 开发：dist/main → 仓库根 /prompts；打包后：app.asar/dist/main → app.asar/prompts
  return path.resolve(__dirname, '..', '..', 'prompts');
}

/** 文件名去掉 .txt 就是版本号 */
export function promptVersion(key: PromptKey): string {
  return PROMPT_FILES[key].replace(/\.txt$/, '');
}

export function promptVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(PROMPT_FILES) as PromptKey[]).forEach((k) => { out[k] = promptVersion(k); });
  return out;
}

export function loadPrompt(key: PromptKey): string {
  const hit = cache.get(key);
  if (hit != null) return hit;
  const file = path.join(promptDir(), PROMPT_FILES[key]);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    throw new Error('缺少提示词文件 ' + PROMPT_FILES[key] + '（期望位置：' + promptDir() + '）');
  }
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) throw new Error('提示词文件为空：' + PROMPT_FILES[key]);
  cache.set(key, normalized);
  return normalized;
}

/** 测试用：清掉缓存，便于改文件后重新读取 */
export function clearPromptCache(): void {
  cache.clear();
}
