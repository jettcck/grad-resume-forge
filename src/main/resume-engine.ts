'use strict';

// ============================================================
//  简历规则引擎（TypeScript 版）
//  纯确定性：改写 / 体检 / 匹配 —— 全部可测试、零网络
// ============================================================

import {
  AI_CLICHES, AI_CLICHES_SOFT, AI_EN_WORDS, EMPTY_ADJECTIVES, EMPTY_ADJ_KEEP_HEADS,
  EXTRA_VERB_START_CHARS, JD_REQUIRED_MARKERS, JD_NICE_MARKERS,
  WEAK_TO_STRONG, STRONG_VERBS, ROLE_SKILLS
} from './lexicon';
import type {
  Profile, Resume, GenerateResult, AuditResult, AuditIssue,
  MatchJobResult, MatchJdResult, Domain, EducationEntry,
  GeneratedItem, ExperienceEntry, SkillHit
} from './types';

// ---------- 工具函数 ----------
function clean(str: unknown): string {
  return String(str == null ? '' : str).trim();
}

// 兼容两种形态：单段文本（表单）或多行数组（导入器产物）
function splitLines(text: string | string[] | undefined | null): string[] {
  if (Array.isArray(text)) return text.map((s) => String(s).trim()).filter(Boolean);
  return clean(text)
    .split(/\r?\n|；|;|。(?!\d)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 领域识别规则（按优先级排列）。
// 设计原则：
//  1) 英文关键词统一 \b 词边界，避免子串误判（html⊃ml、javascript⊃java 等）
//  2) 技术（CS）规则在前：金融科技/银行研发等交叉岗位优先给技术词表
//  3) 「数据」类贪婪词收紧为岗位词（数据分析/数据开发/大数据），
//     避免把「负责运营数据整理」的市场岗误判成数据方向
//  4) 全专业方向（金融/市场/设计/工科/土木/教育/医药/人力）在后，
//     词表按 Domain 取用；general 兜底为跨行业可迁移能力
const DOMAIN_RULES: ReadonlyArray<readonly [Domain, RegExp]> = [
  ['llm', /(大模型|大语言模型|\bllm\b|agent|智能体|\brag\b|提示词|prompt|aigc|\bai 应用|微调|\blora\b|\bsft\b|多模态|multimodal|langchain|dify)/i],
  ['algorithm', /(算法|机器学习|深度学习|模型|pytorch|tensorflow|\bcv\b|\bnlp\b|\bml\b)/i],
  ['backend', /(后端|服务端|\bjava\b|\bgo\b|golang|spring|mysql|redis|微服务|\bapi\b|分布式)/i],
  // design 在 frontend 之前：「UI 设计师」靠「设计师」命中 design，
  // 而「UI 开发」无设计词、落到 frontend 的 \bui\b —— 两个方向各得其所
  ['design', /(平面设计|视觉设计|交互设计|设计师|美工|插画|原画|动效|网页设计|广告设计|创意|\bux\b)/i],
  ['frontend', /(前端|react|vue|css|html|页面|\bui\b|typescript|webpack)/i],
  ['data', /(大数据|数据仓库|数仓|数据开发|数据工程|数据分析|数据挖掘|数据可视化|\betl\b|spark|hadoop|\bbi\b|可视化)/i],
  ['civil', /(土木|造价|施工|测绘|监理|道路|桥梁|给排水|暖通|岩土|设计院|工程管理)/i],
  ['finance', /(金融|银行|证券|基金|保险|会计|审计|财务|税务|投资|风控|\bcpa\b)/i],
  ['marketing', /(市场营销|营销|新媒体|运营|品牌|公关|文案|电商|销售|市场专员)/i],
  ['education', /(教师|老师|教研|培训师|课程顾问|助教|辅导员|幼教|学前教育|学科教师)/i],
  ['medical', /(医生|护士|护理|药师|临床|医药|药剂|医院|医学检验)/i],
  ['business', /(人力资源|\bhr\b|招聘|行政|人事|文秘|客服|前台)/i],
  // 「自动化」收紧为「自动化工程师/专业」：避免「自动化测试工程师」误中工科
  ['eng', /(机械|电气|模具|数控|工艺|制造|汽车|机电|设备工程师|自动化工程师|自动化专业)/i]
];

export function detectDomain(text: string): Domain {
  const t = String(text || '');
  for (let i = 0; i < DOMAIN_RULES.length; i++) {
    if (DOMAIN_RULES[i]![1].test(t)) return DOMAIN_RULES[i]![0];
  }
  return 'general';
}

function pickVerb(domain: Domain, seed: number): string {
  const list = STRONG_VERBS[domain] || STRONG_VERBS.general;
  return list[seed % list.length]!;
}

// 删套话后常残留没有信息量的碎片分句（如「通过业务」「实现」），
// 这里按逗号切分，丢弃这些空壳碎片，保留有实质动作或量化数据的分句。
const DANGLING_STARTERS = ['通过', '经过', '借助', '依托', '基于', '采用', '运用', '利用', '为了', '旨在'];
const HOLLOW_FRAGMENTS = new Set([
  '实现', '完成', '进行', '开展', '推进', '负责', '参与', '业务', '工作', '相关工作',
  '业务实现', '工作实现', '相关业务', '各项工作', '各项业务'
]);

export function hasMetric(text: string): boolean {
  return /(\d+%|\d+\s*(万|千|百|亿|人|天|周|个月|倍|ms|qps|次|条|k\b|w\b)|提升|降低|减少|增长)/i.test(text);
}

function isHollowFragment(frag: string): boolean {
  const f = frag.replace(/[的了地得]/g, '').trim();
  if (!f) return true;
  if (hasMetric(frag)) return false;              // 含量化数据的一律保留
  if (HOLLOW_FRAGMENTS.has(f)) return true;       // 明确的空壳词
  // 以悬空介词开头、且整体很短（≤5字）、无量化 → 视为碎片
  if (f.length <= 5 && DANGLING_STARTERS.some((p) => f.startsWith(p))) return true;
  // 介词包裹式空壳：如「通过业务实现」「借助工作完成」——剥掉介词头与谓语尾后所剩无几
  for (const p of DANGLING_STARTERS) {
    if (f.startsWith(p)) {
      const rest = f.slice(p.length).replace(/(实现|完成|进行|开展|推进|落地)$/, '');
      if (rest.length <= 3) return true;
    }
  }
  return false;
}

function cleanupFragments(text: string): string {
  const t = String(text || '').replace(/[，,、]{2,}/g, '，');
  const parts = t.split(/([，,])/);              // 保留分隔符便于重组
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const seg = (parts[i] || '').trim();
    if (seg === '') continue;
    if (isHollowFragment(seg)) continue;         // 丢弃空壳碎片
    kept.push(seg);
  }
  return kept.join('，').replace(/[，,、]+$/, '').replace(/^[，,、]+/, '').trim();
}

// ---------- 空洞形容词删除（带保义守卫） ----------
// 「良好的客户关系」删成「客户关系」语义反而变弱——形容词后接有实义的中心词时保留。
// 体检与改写共用本函数：体检报的问题，改写时一定真的会处理（口径一致）。
export function stripEmptyAdjectives(input: string): string {
  let s = input;
  for (const w of EMPTY_ADJECTIVES) {
    let idx = s.indexOf(w);
    while (idx >= 0) {
      // 形容词后 4 字窗口内出现「有实义的中心词」即保留
      // （覆盖「项目经验」「工作业绩」这类中心词前还带修饰的情况）
      const window = s.slice(idx + w.length, idx + w.length + 4);
      const keep = EMPTY_ADJ_KEEP_HEADS.some((h) => window.includes(h));
      if (keep) {
        idx = s.indexOf(w, idx + w.length);
        continue;
      }
      s = s.slice(0, idx) + s.slice(idx + w.length);
      idx = s.indexOf(w, idx);
    }
  }
  return s;
}

// ---------- 英文 AI 高频词删除（词边界，避免误伤同形子串） ----------
export function stripEnAiWords(input: string): string {
  let s = input;
  for (const w of AI_EN_WORDS) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('(?<![a-z])' + escaped + '(?![a-z])', 'gi'), '');
  }
  return s;
}

// ---------- 动词开头判定：首字集合由词库自动派生 ----------
// 技术债修复：新增方向动词只需改 STRONG_VERBS / WEAK_TO_STRONG，
// 本集合自动跟上（test-engine 有「词库动词零遗漏」的守卫用例）。
const VERB_START_CHARS: ReadonlySet<string> = new Set<string>(
  [
    ...Object.values(STRONG_VERBS).flat(),
    ...Object.values(WEAK_TO_STRONG),
    ...EXTRA_VERB_START_CHARS.split('')
  ].map((v) => v.trim().charAt(0)).filter(Boolean)
);

export function startsWithVerb(text: string): boolean {
  return VERB_START_CHARS.has(text.charAt(0));
}

// ---------- 单条经历改写：去套话 + 强动词 + 保留量化 ----------
export function rewriteBullet(raw: string, domain: Domain, index: number): string {
  let s = clean(raw);
  if (!s) return '';

  s = s.replace(/^[-*·•\d.、\s]+/, '');

  // 顺序：先删带「的/地」的长搭配，再删短词，避免留下孤立助词
  s = stripEmptyAdjectives(s);

  for (const w of AI_CLICHES) {
    s = s.split(w).join('');
  }
  s = stripEnAiWords(s);

  s = cleanupFragments(s);

  for (const weak of Object.keys(WEAK_TO_STRONG)) {
    if (s.startsWith(weak)) {
      s = WEAK_TO_STRONG[weak]! + s.slice(weak.length);
    }
  }

  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';

  // 动词开头识别（首字集合由词库派生，见 VERB_START_CHARS）
  if (!startsWithVerb(s)) {
    s = pickVerb(domain, index) + s;
  }

  s = s.replace(/[。.,，、\s]+$/, '');
  return s;
}

// ============================================================
//  简历生成器：把 profile 组装成结构化简历数据 + 优化建议
// ============================================================
export function generate(profile: Profile, options: { targetRole?: string } | Record<string, never> | undefined): GenerateResult {
  const p = profile || ({} as Profile);
  const targetRole = clean(options?.targetRole || p.targetRole || '');
  const domain = detectDomain(
    targetRole + ' ' + (p.skills || '') + ' ' + (p.summary || '')
  );

  const tips: string[] = [];

  // 基本信息
  const basics = {
    name: clean(p.name),
    phone: clean(p.phone),
    email: clean(p.email),
    city: clean(p.city),
    github: clean(p.github),
    targetRole: targetRole || '软件研发工程师'
  };
  if (!basics.phone || !basics.email) tips.push('补全手机号与邮箱，HR 才能第一时间联系你。');
  // 技术岗推 GitHub（代码背书）；其他方向推作品集/项目展示——各给各的理由
  const isTechDomain = ['backend', 'frontend', 'algorithm', 'data', 'llm'].includes(domain);
  if (!basics.github) {
    tips.push(isTechDomain
      ? '计算机岗建议放上 GitHub / 个人主页，代码即最好的背书。'
      : '放上作品集 / 项目展示 / 证书链接，让成果可以被直接查看。');
  }

  // 教育
  const education: EducationEntry[] = (p.education || []).map((e) => ({
    school: clean(e.school),
    major: clean(e.major),
    degree: clean(e.degree || '本科'),
    period: clean(e.period),
    gpa: clean(e.gpa),
    courses: clean(e.courses)
  })).filter((e) => e.school);
  if (education.length === 0) tips.push('至少填写一段教育经历（学校 / 专业 / 时间）。');

  // 技能：去重、分组
  const skills = clean(p.skills)
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqueSkills = [...new Set(skills)];
  if (uniqueSkills.length < 4) tips.push('技能不足 4 项，补充语言 / 框架 / 工具让画像更完整。');

  // 项目 / 实习：逐条改写去 AI 味
  function processSection(items: ExperienceEntry[] | undefined): GeneratedItem[] {
    return (items || []).map((it, idx) => {
      // 兼容旧数据/测试里直接传 bullets 数组的形态
      const rawBullets = (it as { bullets?: unknown }).bullets;
      const bulletsRaw: string[] = Array.isArray(rawBullets)
        ? (rawBullets as string[])
        : splitLines(it.description || '');
      const itemDomain = detectDomain(it.tech || it.name || '');
      const bullets = bulletsRaw
        .map((b, i) => rewriteBullet(b, itemDomain, idx + i))
        .filter(Boolean);
      bullets.forEach((b) => {
        if (!hasMetric(b)) {
          tips.push('「' + clean(it.name || '') + '」有条目缺少量化数据，尝试补上百分比 / 数量 / 时长。');
        }
      });
      return {
        name: clean(it.name || ''),
        role: clean(it.role),
        period: clean(it.period),
        tech: clean(it.tech),
        bullets
      };
    }).filter((it) => it.name);
  }

  const projects = processSection(p.projects);
  const internships = processSection(p.internships);
  if (projects.length === 0 && internships.length === 0) {
    tips.push('至少写 1 段项目或实习，这是应届简历最核心的部分。');
  }

  // 一句话摘要（本地拼接，不套 AI 模板腔）。
  // 注意：自动拼的简介不参与体检（自产内容不自检——否则「学校+专业」
  // 粘连成长行会被误标「句子过长」，兜底词还会自flag「空洞形容词」）
  let summary = clean(p.summary);
  let summaryIsAuto = false;
  if (!summary) {
    summaryIsAuto = true;
    const edu = education[0];
    const eduName = edu ? edu.school + ' · ' + edu.major : '目标行业';
    const topSkills = uniqueSkills.slice(0, 3).join(' / ');
    const skillPart = topSkills ? '，掌握 ' + topSkills : '';
    summary = eduName + '应届生，方向为' + basics.targetRole + skillPart + '，有 ' +
      (projects.length + internships.length) + ' 段可展示的项目 / 实习经历。';
  }

  const resume: Resume = {
    basics,
    summary,
    education,
    skills: uniqueSkills,
    projects,
    internships,
    domain
  };

  // 生成后自检：只体检用户亲手写的内容（简介 + 经历条目）
  const auditText = (summaryIsAuto ? [] : [summary])
    .concat(projects.flatMap((x) => x.bullets))
    .concat(internships.flatMap((x) => x.bullets))
    .join('\n');
  const audit = auditAiFlavor(auditText);

  // 岗位匹配度
  const matchText = [
    summary,
    uniqueSkills.join(' '),
    projects.flatMap((x) => [x.tech, x.name].concat(x.bullets)).join(' '),
    internships.flatMap((x) => [x.tech, x.name].concat(x.bullets)).join(' ')
  ].join('\n');
  const match = matchJob(matchText, domain, basics.targetRole);
  if (match.missing.length) {
    const top = match.missing.slice(0, 3).map((m) => m.label).join('、');
    tips.push('目标岗位常考「' + top + '」等，简历暂未体现，若你会请补进技能或项目。');
  }

  return { resume, tips: [...new Set(tips)], audit, match };
}

// ============================================================
//  岗位匹配度分析器：本地词库匹配（非大模型）
// ============================================================

// 技能别名匹配器（带缓存）
const _matcherCache = new Map<string, (content: string) => boolean>();
export function aliasMatcher(alias: string): (content: string) => boolean {
  let m = _matcherCache.get(alias);
  if (m) return m;
  if (/^[a-z0-9.+#!?_-]+$/i.test(alias)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![a-z])' + escaped + '(?![a-z])', 'i');
    m = (content: string) => re.test(content);
  } else {
    const needle = alias.toLowerCase();
    m = (content: string) => content.includes(needle);
  }
  _matcherCache.set(alias, m);
  return m;
}

export function matchJob(text: string, domain: Domain, targetRole: string): MatchJobResult {
  const content = clean(text).toLowerCase();
  const skillList = ROLE_SKILLS[domain] || ROLE_SKILLS.general;

  const hit: SkillHit[] = [];
  const missing: SkillHit[] = [];
  skillList.forEach((entry) => {
    const aliases = entry.split('|');
    const label = aliases[0]!;
    const matched = aliases.some((a) => aliasMatcher(a)(content));
    if (matched) hit.push({ label });
    else missing.push({ label });
  });

  const total = skillList.length || 1;
  const score = Math.round((hit.length / total) * 100);
  let level = '高度匹配，放心投递';
  if (score < 40) level = '匹配偏低，建议补强再投';
  else if (score < 65) level = '基本匹配，可补充关键词';
  else if (score < 85) level = '匹配良好，锦上添花';

  return {
    targetRole: clean(targetRole),
    domain,
    score,
    level,
    hit,
    missing,
    hitCount: hit.length,
    total
  };
}

// ============================================================
//  JD 精准匹配：按这份 JD 实际提到的技能逐项比对简历
// ============================================================

function buildResumeText(resume: Partial<Resume> | undefined): string {
  const r = resume || {};
  const parts: string[] = [];
  if (r.summary) parts.push(r.summary);
  if (Array.isArray(r.skills)) parts.push(r.skills.join(' '));
  const exps: GeneratedItem[] = [...(r.projects || []), ...(r.internships || [])];
  exps.forEach((it) => {
    parts.push([it.name, it.role, it.tech].filter(Boolean).join(' '));
    if (Array.isArray(it.bullets)) parts.push(it.bullets.join(' '));
  });
  return parts.filter(Boolean).join('\n');
}

function scanSkillHits(contentLower: string): Array<SkillHit & { domain: Domain }> {
  const seen = new Set<string>();
  const found: Array<SkillHit & { domain: Domain }> = [];
  (Object.keys(ROLE_SKILLS) as Domain[]).forEach((dom) => {
    ROLE_SKILLS[dom].forEach((entry) => {
      const aliases = entry.split('|');
      const label = aliases[0]!;
      if (seen.has(label)) return;
      if (aliases.some((a) => aliasMatcher(a)(contentLower))) {
        seen.add(label);
        found.push({ label, domain: dom });
      }
    });
  });
  return found;
}

// JD 里一项技能的权重：硬性要求 3 / 一般提及 2 / 加分项 1
// 判定方式：只看该技能命中的**那一行**（JD 的权重标记是逐条声明的，
// 用固定字符半径会跨行把上一条的「熟悉」吸进来）
export function skillWeightInJd(jdLower: string, aliases: readonly string[]): number {
  let weight = 0;
  for (const a of aliases) {
    const needle = a.toLowerCase();
    if (!needle) continue;
    let from = 0;
    let idx = jdLower.indexOf(needle, from);
    while (idx >= 0) {
      const lineStart = jdLower.lastIndexOf('\n', idx) + 1;
      let lineEnd = jdLower.indexOf('\n', idx + needle.length);
      if (lineEnd < 0) lineEnd = jdLower.length;
      let win = jdLower.slice(lineStart, lineEnd);
      // 超长行（有些 JD 一整段不分行）再退回字符窗口，避免把整段标记都算上
      if (win.length > 120) {
        const s = Math.max(lineStart, idx - 30);
        const e = Math.min(lineEnd, idx + needle.length + 30);
        win = jdLower.slice(s, e);
      }
      if (JD_REQUIRED_MARKERS.some((m) => win.includes(m))) weight = Math.max(weight, 3);
      else if (JD_NICE_MARKERS.some((m) => win.includes(m))) weight = Math.max(weight, 1);
      from = idx + needle.length;
      idx = jdLower.indexOf(needle, from);
    }
  }
  return weight || 2;
}

export function matchJd(resume: Partial<Resume>, jdText: string): MatchJdResult {
  const jd = clean(jdText);
  if (!jd) throw new Error('请先粘贴职位描述（JD）');

  const jdLower = jd.toLowerCase();
  const resumeLower = buildResumeText(resume).toLowerCase();
  const domain = detectDomain(jd);

  const jdSkills = scanSkillHits(jdLower);
  const resumeSkills = scanSkillHits(resumeLower);
  const resumeLabels = new Set(resumeSkills.map((s) => s.label));

  // 带权重的比对：硬性要求（必须/熟练/掌握）比加分项重要得多，
  // 不加权时「会一个加分项」和「会一个硬指标」等分，会把分数刷好看
  const entryByLabel = new Map<string, readonly string[]>();
  (Object.keys(ROLE_SKILLS) as Domain[]).forEach((dom) => {
    ROLE_SKILLS[dom].forEach((entry) => {
      const aliases = entry.split('|');
      if (!entryByLabel.has(aliases[0]!)) entryByLabel.set(aliases[0]!, aliases);
    });
  });
  const weightOf = (label: string): number => {
    const aliases = entryByLabel.get(label);
    return aliases ? skillWeightInJd(jdLower, aliases) : 2;
  };

  const hit = jdSkills.filter((s) => resumeLabels.has(s.label));
  const missing = jdSkills.filter((s) => !resumeLabels.has(s.label));
  const jdLabels = new Set(jdSkills.map((s) => s.label));
  const extra = resumeSkills.filter((s) => !jdLabels.has(s.label));

  const total = jdSkills.length;
  const totalWeight = jdSkills.reduce((sum, s) => sum + weightOf(s.label), 0);
  const hitWeight = hit.reduce((sum, s) => sum + weightOf(s.label), 0);
  // 加权得分：硬性要求没命中时惩罚更重
  const score = totalWeight ? Math.round((hitWeight / totalWeight) * 100) : 0;
  const rawScore = total ? Math.round((hit.length / total) * 100) : 0;

  // 硬性要求（必须/熟练/掌握）未体现——最该优先补的
  const mustMissing = missing.filter((s) => weightOf(s.label) >= 3);

  let level: string;
  if (!total) level = '未识别出技能关键词，请检查 JD 是否粘贴完整';
  else if (mustMissing.length) level = '有硬性要求未体现，补齐前投递风险偏高';
  else if (score >= 80) level = '高度匹配，放心投递';
  else if (score >= 60) level = '基本匹配，建议补齐缺失关键词';
  else if (score >= 40) level = '匹配偏低，按缺失项补强再投';
  else level = '匹配度低，谨慎投递或先补短板';

  const tips: string[] = [];
  if (!total) {
    tips.push('职位描述通常含「任职要求 / 技能要求」清单，请完整粘贴后再试。');
  } else {
    if (mustMissing.length) {
      tips.push('JD 里的硬性要求（写到「必须 / 熟练 / 掌握」）而简历未体现：' +
        mustMissing.slice(0, 5).map((m) => m.label).join('、') +
        (mustMissing.length > 5 ? ' 等' : '') + '——这几项优先级最高，会的话务必补进技能或项目描述。');
    }
    if (missing.length) {
      tips.push('JD 提到而简历未体现（含加分项）：' + missing.slice(0, 5).map((m) => m.label).join('、') +
        (missing.length > 5 ? ' 等' : '') + '，会的话补进技能或项目描述。');
    }
    if (score >= 60 && hit.length) {
      tips.push('投递前把命中的「' + hit.slice(0, 3).map((h) => h.label).join('、') + '」放进技能清单前半段，更容易被搜到。');
    }
    if (extra.length >= 8) {
      tips.push('简历技能比 JD 更广（' + extra.length + ' 项 JD 未提及），无碍投递，面试可作加分项展开。');
    }
    // 方法是词表级匹配，说清边界（避免用户以为这是语义理解）
    tips.push('说明：本匹配是本地词表级筛查（离线、不编造、结果可复现），已收录常见同义表述；' +
      '若 JD 用完全不同的说法描述同一技能，可能漏判——需要语义级判断时，用「Agent 深度优化」贴同一份 JD 让模型分析。');
  }

  return {
    domain,
    score,
    rawScore,
    level,
    tips,
    hit,
    missing,
    extra,
    mustMissing,
    jdSkillCount: total,
    hitCount: hit.length
  };
}

// ============================================================
//  去 AI 味体检评分器
// ============================================================
export function auditAiFlavor(text: string): AuditResult {
  const content = clean(text);
  const issues: AuditIssue[] = [];
  let penalty = 0;

  // 中文套话（重扣）——硬套话，改写时会真的删掉
  for (const w of AI_CLICHES) {
    const count = content.split(w).length - 1;
    if (count > 0) {
      issues.push({ type: '中文套话', word: w, count });
      penalty += count * 6;
    }
  }

  // 软套话（轻扣，只提示不改写）：这些词也可能是真实术语
  // （「数据对齐」「复盘会议」「闭环控制」「技术生态」），自动删除会破坏语义，
  // 所以只标记，让用户自己判断是不是空话
  for (const w of AI_CLICHES_SOFT) {
    const count = content.split(w).length - 1;
    if (count > 0) {
      issues.push({ type: '疑似套话（也可能是实际术语，请自查）', word: w, count });
      penalty += count * 2;
    }
  }

  // 空洞形容词（中扣）——与改写口径一致：带保义守卫，
  // 「良好的客户关系」这类改写不会处理的，体检也不该报
  const strippedAdjs = stripEmptyAdjectives(content);
  for (const w of EMPTY_ADJECTIVES) {
    const rawCount = content.split(w).length - 1;
    const keptCount = strippedAdjs.split(w).length - 1;
    const count = rawCount - keptCount;
    if (count > 0) {
      issues.push({ type: '空洞形容词', word: w, count });
      penalty += count * 3;
    }
  }

  // 英文 AI 高频词（中扣，忽略大小写）
  const lower = content.toLowerCase();
  for (const w of AI_EN_WORDS) {
    const count = lower.split(w).length - 1;
    if (count > 0) {
      issues.push({ type: '英文AI高频词', word: w, count });
      penalty += count * 4;
    }
  }

  // 结构性检查：整体缺少量化数据
  const lines = splitLines(content);
  const withMetric = lines.filter((l) => hasMetric(l)).length;
  const metricRatio = lines.length ? withMetric / lines.length : 0;
  if (lines.length >= 3 && metricRatio < 0.3) {
    issues.push({ type: '缺少量化', word: '量化数据占比偏低（<30%）' });
    penalty += 12;
  }

  // 冗长句：单句超过 45 字。聚合计数（多条并为一项 ×N），
  // 预览取「首…尾」双端截断并标总长——让用户明白问题是长度而非开头那几个字
  let longCount = 0;
  let longSample = '';
  for (const l of lines) {
    if (l.length > 45) {
      longCount++;
      if (!longSample) longSample = l;
    }
  }
  if (longCount) {
    const preview = longSample.length > 24
      ? longSample.slice(0, 10) + ' … ' + longSample.slice(-8)
      : longSample;
    issues.push({ type: '句子过长', word: preview + '（单条 ' + longSample.length + ' 字，>45）', count: longCount });
    penalty += longCount * 3;
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  let level = '优秀（几乎无 AI 味）';
  if (score < 60) level = '较重 AI 味，建议大改';
  else if (score < 80) level = '存在 AI 味，可优化';
  else if (score < 92) level = '良好，略有痕迹';

  return {
    score,
    level,
    issues,
    metricRatio: Math.round(metricRatio * 100)
  };
}

export { clean as _clean, splitLines as _splitLines };
