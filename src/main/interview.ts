'use strict';

// ============================================================
//  面试准备（全本地、零模型）
//  1) 自我介绍生成：直接从档案确定性拼稿（不编造任何你没写过的数字）
//  2) 高频问题：按方向给题 + 考察点 + 回答框架 + 自动指向你自己的素材
//  3) 网申开放题模板 / 反问清单
// ============================================================

import * as engine from './resume-engine';
import { ROLE_SKILLS } from './lexicon';
import {
  GENERAL_QUESTIONS, DOMAIN_QUESTIONS, OPEN_QUESTION_TEMPLATES, QUESTIONS_TO_ASK
} from './interview-bank';
import type { InterviewQuestion, OpenTemplate } from './interview-bank';
import type { Profile, Domain } from './types';

export interface IntroPart { label: string; text: string }
export interface SelfIntroResult {
  /** 30 秒（约 130 字）或 60 秒（约 280 字） */
  seconds: number;
  text: string;
  parts: IntroPart[];
  /** 供用户核对的取材来源（用的是哪条经历） */
  sources: string[];
}

interface Story {
  kind: '实习' | '项目';
  name: string;
  role: string;
  bullet: string;
  score: number;
  hasMetric: boolean;
}

// 从档案里挑出「与目标岗位方向最相关、且有量化」，最适合当面试素材的经历
function pickStories(profile: Partial<Profile>, domain: Domain, targetRole: string): Story[] {
  const roleSkills = ROLE_SKILLS[domain] || ROLE_SKILLS.general;
  const hitCount = (text: string): number => {
    const lower = text.toLowerCase();
    let n = 0;
    roleSkills.forEach((entry) => {
      if (entry.split('|').some((a) => engine.aliasMatcher(a)(lower))) n++;
    });
    return n;
  };
  const jdHit = (text: string): number => {
    if (!targetRole) return 0;
    const lower = text.toLowerCase();
    // 目标岗位名本身命中的技能，权重更高
    return engine.matchJd({ summary: text, skills: [], projects: [], internships: [] }, targetRole).hit.length;
  };

  const stories: Story[] = [];
  const push = (kind: '实习' | '项目', it: { name?: string; role?: string; tech?: string; description?: string }) => {
    if (!it || !engine._clean(it.name)) return;
    const lines = engine._splitLines(it.description || '').map((l) => engine.rewriteBullet(l, domain, 0)).filter(Boolean);
    if (!lines.length) return;
    const pool = [it.name, it.role, it.tech].filter(Boolean).join(' ') + ' ' + lines.join(' ');
    // 优先选带量化的条目：面试说结果最有说服力
    const withMetric = lines.filter((l) => engine.hasMetric(l));
    const bullet = (withMetric.length ? withMetric : lines)[0]!;
    stories.push({
      kind,
      name: engine._clean(it.name),
      role: engine._clean(it.role || ''),
      bullet,
      score: hitCount(pool) * 2 + jdHit(pool) + (withMetric.length ? 3 : 0),
      hasMetric: engine.hasMetric(bullet)
    });
  };
  (profile.internships || []).forEach((it) => push('实习', it as never));
  (profile.projects || []).forEach((it) => push('项目', it as never));
  return stories.sort((a, b) => b.score - a.score);
}

// 从用户技能里挑出与目标方向最相关的几项（没有就按原顺序取前几项）
function pickSkills(profile: Partial<Profile>, domain: Domain, limit: number): string[] {
  const raw = engine._clean(profile.skills || '').split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return [];
  const roleSkills = ROLE_SKILLS[domain] || ROLE_SKILLS.general;
  const rel = (s: string): number => {
    const lower = s.toLowerCase();
    let n = 0;
    roleSkills.forEach((entry) => { if (entry.split('|').some((a) => engine.aliasMatcher(a)(lower))) n++; });
    return n;
  };
  return raw
    .map((s, i) => ({ s, w: rel(s), i }))
    .sort((a, b) => (b.w - a.w) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.s);
}

// 中英混排的连接词处理：只在需要时加空格，避免「包括Excel」或「普通话 和 PPT」这类别扭
const startsLatin = (s: string): boolean => /^[A-Za-z0-9]/.test(s);
const endsLatin = (s: string): boolean => /[A-Za-z0-9)\]]$/.test(s);

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  const head = items.slice(0, -1).join('、');
  const last = items[items.length - 1]!;
  const sep = (endsLatin(head) || startsLatin(last)) ? ' 和 ' : '和';
  return head + sep + last;
}

// ---------------- 自我介绍生成 ----------------
// 原则：只用档案里真实存在的信息，绝不编造数字或经历；数字原样保留
export function buildSelfIntro(profile: Partial<Profile>, opts?: { seconds?: number; company?: string }): SelfIntroResult {
  const p = profile || {};
  const seconds = opts && opts.seconds === 60 ? 60 : 30;
  const targetRole = engine._clean(p.targetRole);
  const domain = engine.detectDomain(targetRole + ' ' + (p.skills || '') + ' ' + (p.summary || ''));
  const stories = pickStories(p, domain, targetRole);
  const parts: IntroPart[] = [];
  const sources: string[] = [];

  // 1) 开场：姓名 + 学校专业 + 应聘岗位
  const edu = (p.education || [])[0] as { school?: string; major?: string; degree?: string } | undefined;
  const school = engine._clean(edu && edu.school);
  const major = engine._clean(edu && edu.major);
  const name = engine._clean(p.name);
  const openingBits: string[] = [];
  if (name) openingBits.push('我是' + name);
  if (school || major) {
    const who = [school, major].filter(Boolean).join('');
    // 学校名常已含「大学/学院」，专业直接跟随，避免「XX学院专业」这类别扭拼接
    openingBits.push((school ? '就读于' + school : '') + (major ? (school ? '，' : '就读于') + major + '专业' : ''));
  }
  const opening = openingBits.join('，') + (targetRole ? '，应聘' + targetRole + '。' : '。');
  parts.push({ label: '开场', text: opening });

  // 2) 经历：优先最相关且含量化
  // 项目/公司名用「」括起来——名字末尾常是英文（…Forge），直接接中文会读不断句
  const story = stories[0];
  if (story) {
    const where = story.kind === '实习' ? '实习期间' : '在校期间';
    const tail = story.role
      ? '在「' + story.name + '」担任' + story.role + '，' + story.bullet + '。'
      : '做了「' + story.name + '」这个项目，' + story.bullet + '。';
    parts.push({ label: '核心经历', text: where + '我' + tail });
    sources.push(story.kind + '：' + story.name + '（' + story.bullet + '）');
  }

  // 3) 60 秒版再加一段经历
  if (seconds === 60 && stories[1]) {
    const s2 = stories[1];
    parts.push({
      label: '补充经历',
      text: '另外在「' + s2.name + '」里，我' + (s2.role ? '担任' + s2.role + '，' : '') + s2.bullet + '。'
    });
    sources.push(s2.kind + '：' + s2.name + '（' + s2.bullet + '）');
  }

  // 3b) 60 秒版：补一句学习基础（GPA / 主修课程，都是档案里的真实信息）
  if (seconds === 60 && edu) {
    const gpa = engine._clean((edu as { gpa?: string }).gpa);
    const courses = engine._clean((edu as { courses?: string }).courses);
    const bits: string[] = [];
    if (gpa) bits.push('GPA ' + gpa);
    if (courses) bits.push('主修' + courses);
    if (bits.length) parts.push({ label: '学习基础', text: bits.join('，') + '。' });
  }

  // 4) 技能：用「技能包括」而不是「主要用」——证书类（教师资格证/CPA）跟「用」搭配不通
  const skills = pickSkills(p, domain, seconds === 60 ? 4 : 3);
  if (skills.length) {
    const sep = startsLatin(skills[0]!) ? ' ' : '';
    parts.push({ label: '能力', text: '技能方面包括' + sep + joinList(skills) + '。' });
  }

  // 5) 收尾
  const company = engine._clean(opts && opts.company);
  const closing = company
    ? '我希望能在' + company + '把这个方向做深，也相信前面的经历能让我快速上手。'
    : '我希望能在' + (targetRole ? '「' + targetRole + '」这个方向' : '这个方向') + '上做深，也相信前面的经历能让我快速上手。';
  parts.push({ label: '收尾', text: closing });

  const text = parts.map((x) => x.text).join('');
  return { seconds, text, parts, sources };
}

// ---------------- 面试题（带素材指向） ----------------
export interface PreparedQuestion extends InterviewQuestion {
  /** 建议用自己档案里的哪条素材来答（若有） */
  material?: string;
}

export interface InterviewPrepResult {
  domain: Domain;
  targetRole: string;
  intro30: SelfIntroResult;
  intro60: SelfIntroResult;
  general: PreparedQuestion[];
  domainSpecific: PreparedQuestion[];
  openTemplates: readonly OpenTemplate[];
  askBack: readonly string[];
  /** 素材清单（供用户核对） */
  sources: string[];
}

export function prepareInterview(profile: Partial<Profile>, opts?: { company?: string }): InterviewPrepResult {
  const p = profile || {};
  const targetRole = engine._clean(p.targetRole);
  const domain = engine.detectDomain(targetRole + ' ' + (p.skills || '') + ' ' + (p.summary || ''));
  const stories = pickStories(p, domain, targetRole);
  const best = stories[0];

  const intro30 = buildSelfIntro(p, { seconds: 30, company: opts && opts.company });
  const intro60 = buildSelfIntro(p, { seconds: 60, company: opts && opts.company });

  const attach = (list: readonly InterviewQuestion[]): PreparedQuestion[] =>
    list.map((q) => {
      // 只有「讲自己经历」类的问题才自动指向素材，避免答非所问
      if (q.useOwnStory && best) {
        return { ...q, material: best.kind + '「' + best.name + '」——' + best.bullet };
      }
      return { ...q };
    });

  return {
    domain,
    targetRole,
    intro30,
    intro60,
    general: attach(GENERAL_QUESTIONS),
    domainSpecific: attach(DOMAIN_QUESTIONS[domain] || DOMAIN_QUESTIONS.general),
    openTemplates: OPEN_QUESTION_TEMPLATES,
    askBack: QUESTIONS_TO_ASK,
    sources: Array.from(new Set([...intro60.sources, ...(best ? [best.kind + '：' + best.name] : [])]))
  };
}
