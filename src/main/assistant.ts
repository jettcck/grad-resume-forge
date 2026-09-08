'use strict';

// ============================================================
//  小助手检索引擎（纯确定性，零网络零模型）
//  词边界关键词计分（复用引擎的 aliasMatcher 思路）+ 方向上下文加权
//  + 兜底策略：分数不够不硬答，给操作型引导
// ============================================================

import { KNOWLEDGE, FALLBACK_ACTIONS } from './assistant-knowledge';
import { aliasMatcher, detectDomain } from './resume-engine';
import type { KnowledgeEntry } from './assistant-knowledge';
import type { Domain } from './types';

export interface AssistantAnswer {
  matched: boolean;            // 是否命中知识条目（false = 兜底）
  question: string;            // 用户原问（回显）
  hitQuestion: string;         // 命中的知识标题
  answer: string;
  action?: { label: string; route: string };
  score: number;               // 匹配分（兜底时为 0）
  alternatives: string[];      // 其他候选（供「你是不是想问」）
}

// 单条知识计分：命中关键词数 × 权重（长关键词信息量大）
function scoreEntry(entry: KnowledgeEntry, q: string, domain: Domain): number {
  if (entry.domains[0] !== 'all' && !entry.domains.includes(domain)) return 0;
  let score = 0;
  for (const kw of entry.keywords) {
    if (aliasMatcher(kw)(q)) {
      score += kw.length >= 3 ? 3 : 2; // 长关键词（如「教师资格证」）权重高
    }
  }
  // 方向专属知识在方向上下文中加权（用户档案方向 = 提问语境）
  if (entry.domains[0] !== 'all' && entry.domains.includes(domain)) score += 1;
  return score;
}

export function askAssistant(query: string, contextDomain?: Domain | string | null): AssistantAnswer {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return {
      matched: false,
      question: '',
      hitQuestion: '输入为空',
      answer: '随便问，比如：「没有实习经历怎么办」「简历写几页」「量化是什么意思」。',
      score: 0,
      alternatives: ['简历写几页', '没有实习怎么办', 'AI 优化怎么用']
    };
  }

  const domain = (contextDomain && contextDomain !== 'general' ? contextDomain : detectDomain(q)) as Domain;

  // 计分排序
  const scored = KNOWLEDGE
    .map((e) => ({ e, s: scoreEntry(e, q, domain) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (scored.length && scored[0]!.s >= 2) {
    const top = scored[0]!;
    return {
      matched: true,
      question: query,
      hitQuestion: top.e.question,
      answer: top.e.answer,
      action: top.e.action,
      score: top.s,
      alternatives: scored.slice(1, 4).map((x) => x.e.question)
    };
  }

  // 兜底：不硬编答案，给操作引导（按问题语境选兜底）
  const fb = /投|公司|岗位|招聘|网申|offer|薪资|面试/.test(q)
    ? FALLBACK_ACTIONS[1]!
    : FALLBACK_ACTIONS[0]!;
  return {
    matched: false,
    question: query,
    hitQuestion: fb.question,
    answer: fb.answer,
    action: fb.action,
    score: 0,
    alternatives: KNOWLEDGE.slice(0, 0).map(() => '')
      .concat(['简历写几页', '没有实习经历怎么办', '自我评价怎么写'])
      .filter((s) => s && s.length)
  };
}

// 热门问题（面板空态展示，引导提问）
export function hotQuestions(): string[] {
  return [
    '没有实习经历怎么办',
    '简历应该写几页',
    '自我评价怎么写不空洞',
    '怎么把经历写出说服力',
    '校招时间线是什么时候',
    'AI 深度优化怎么用'
  ];
}
