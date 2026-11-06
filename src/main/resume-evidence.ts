import { createHash } from 'crypto';
import * as engine from './resume-engine';
import { Bm25Index } from '../../packages/retrieval/dist/index';
import type { Profile, RewriteEvidence } from './types';

export type EvidenceMode = 'none' | 'bm25';
export interface ProfileSource {
  id: string;
  path: string;
  label: string;
  scope: string;
  text: string;
  digest: string;
}
export interface ProfileEvidence {
  mode: EvidenceMode;
  query: string;
  sources: ProfileSource[];
  retrieved: ProfileSource[];
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
export const normalizeTargetId = (id: string): string => id === 'summary-b0' ? 'summary' : id;

/** 每次运行只索引传入档案；不读题库、联系人，也不跨账号缓存正文。 */
export function profileSources(profile: Partial<Profile>): ProfileSource[] {
  const sources: ProfileSource[] = [];
  const add = (id: string, path: string, label: string, scope: string, value: unknown): void => {
    const text = engine._clean(value);
    if (text) sources.push({ id, path, label, scope, text, digest: hash(text) });
  };
  add('summary', 'summary', '个人简介', 'summary', profile.summary);
  add('skills', 'skills', '个人技能', 'skills', profile.skills);
  (['projects', 'internships'] as const).forEach((kind) => {
    (profile[kind] || []).forEach((entry, i) => {
      const scope = (kind === 'projects' ? 'p' : 'i') + i;
      const label = (kind === 'projects' ? '项目' : '实习') + ' ' + (i + 1) + ' · ' + engine._clean(entry.name);
      (['name', 'role', 'tech'] as const).forEach((field) =>
        add(scope + '-' + field, kind + '[' + i + '].' + field, label, scope, entry[field]));
      engine._splitLines(entry.description || '').forEach((line, j) =>
        add(scope + '-b' + j, kind + '[' + i + '].description[' + j + ']', label + ' · 第 ' + (j + 1) + ' 条', scope, line));
    });
  });
  (profile.education || []).forEach((entry, i) => {
    (['school', 'major', 'degree', 'courses'] as const).forEach((field) =>
      add('e' + i + '-' + field, 'education[' + i + '].' + field, '教育经历 ' + (i + 1), 'e' + i, entry[field]));
  });
  (profile.awards || []).forEach((award, i) => add('award-' + i, 'awards[' + i + ']', '奖项 ' + (i + 1), 'awards', award));
  return sources;
}

export function createProfileEvidence(profile: Partial<Profile>, query: string, mode: EvidenceMode = 'bm25', topK = 6): ProfileEvidence {
  const sources = profileSources(profile);
  const n = Number.isFinite(topK) ? Math.max(1, Math.min(10, Math.floor(topK))) : 6;
  const byId = new Map(sources.map((s) => [s.id, s]));
  const hits = mode === 'none' ? [] : new Bm25Index(sources).search(query, n);
  return { mode, query, sources, retrieved: hits.map((h) => byId.get(h.id)!) };
}

export function evidenceReference(source: ProfileSource): RewriteEvidence {
  return { sourceId: source.id, path: source.path, label: source.label, quote: source.text.slice(0, 300), digest: source.digest };
}

export function evidencePayload(evidence: ProfileEvidence): {
  sourceType: 'user_profile'; mode: EvidenceMode; query: string; results: RewriteEvidence[];
} {
  return { sourceType: 'user_profile', mode: evidence.mode, query: evidence.query,
    results: evidence.retrieved.map(evidenceReference) };
}

/** 项目只能引用本项目，实习只能引用本实习；简介可汇总全档案的检索命中。 */
export function sourcesForRewrite(evidence: ProfileEvidence, targetId: string): ProfileSource[] {
  const id = normalizeTargetId(targetId);
  const anchor = evidence.sources.find((s) => s.id === id);
  if (!anchor) return [];
  const support = evidence.retrieved.filter((s) => id === 'summary' || s.scope === anchor.scope);
  return [anchor, ...support.filter((s) => s.id !== anchor.id)];
}

/** 应用时重新按原始档案核对位置、原文摘要及引用片段，避免过期候选写入新档案。 */
export function resolveEvidence(profile: Partial<Profile>, targetId: string, refs: RewriteEvidence[]): ProfileEvidence {
  if (!Array.isArray(refs) || !refs.length) throw new Error('改写缺少经历来源，请重新优化');
  const sources = profileSources(profile);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const retrieved = refs.map((ref) => {
    const source = byId.get(ref.sourceId);
    if (!source || source.digest !== ref.digest || source.path !== ref.path || source.text.slice(0, 300) !== ref.quote) {
      throw new Error('引用的原始经历已变化，请重新优化后再应用');
    }
    return source;
  });
  if (!retrieved.some((s) => s.id === normalizeTargetId(targetId))) throw new Error('改写没有引用对应原始条目');
  const evidence: ProfileEvidence = { mode: 'bm25', query: '', sources, retrieved };
  if (sourcesForRewrite(evidence, targetId).length !== new Set(retrieved.map((s) => s.id)).size) {
    throw new Error('改写引用了其他项目或实习的经历');
  }
  return evidence;
}
