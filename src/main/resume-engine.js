'use strict';

const { __lex } = require('./lexicon');
const {
  AI_CLICHES,
  AI_EN_WORDS,
  EMPTY_ADJECTIVES,
  WEAK_TO_STRONG,
  STRONG_VERBS,
  ROLE_SKILLS
} = __lex;

// ---------- 工具函数 ----------
function clean(str) {
  return String(str == null ? '' : str).trim();
}

function splitLines(text) {
  return clean(text)
    .split(/\r?\n|；|;|。(?!\d)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 领域识别规则（按优先级排列）。
// 英文关键词统一加 \b 词边界，避免子串误判：html 误命中 ml、javascript 误命中 java、
// mobile/rabbitmq 误命中 bi、require 误命中 ui 等。
// llm 规则放在 algorithm 之前：「大模型/Agent/RAG」等词含「模型」等算法词根，
// 应用方向优先于算法方向归类。
const DOMAIN_RULES = [
  ['llm', /(大模型|大语言模型|\bllm\b|agent|智能体|\brag\b|提示词|prompt|aigc|\bai 应用|微调|\blora\b|\bsft\b|多模态|multimodal|langchain|dify)/i],
  ['algorithm', /(算法|机器学习|深度学习|模型|pytorch|tensorflow|\bcv\b|\bnlp\b|\bml\b)/i],
  ['backend', /(后端|服务端|\bjava\b|\bgo\b|golang|spring|mysql|redis|微服务|\bapi\b|分布式)/i],
  ['frontend', /(前端|react|vue|css|html|页面|\bui\b|typescript|webpack)/i],
  ['data', /(数据(?!结构)|数仓|\betl\b|spark|hadoop|\bbi\b|可视化|大数据)/i]
];

function detectDomain(text) {
  const t = String(text || '');
  for (let i = 0; i < DOMAIN_RULES.length; i++) {
    if (DOMAIN_RULES[i][1].test(t)) return DOMAIN_RULES[i][0];
  }
  return 'general';
}

function pickVerb(domain, seed) {
  const list = STRONG_VERBS[domain] || STRONG_VERBS.general;
  return list[seed % list.length];
}

// 删套话后常残留没有信息量的碎片分句（如「通过业务」「实现」），
// 这里按逗号切分，丢弃这些空壳碎片，保留有实质动作或量化数据的分句。
const DANGLING_STARTERS = ['通过', '经过', '借助', '依托', '基于', '采用', '运用', '利用', '为了', '旨在'];
const HOLLOW_FRAGMENTS = new Set([
  '实现', '完成', '进行', '开展', '推进', '负责', '参与', '业务', '工作', '相关工作',
  '业务实现', '工作实现', '相关业务', '各项工作', '各项业务'
]);

function isHollowFragment(frag) {
  const f = frag.replace(/[的了地得]/g, '').trim();
  if (!f) return true;
  if (hasMetric(frag)) return false;              // 含量化数据的一律保留
  if (HOLLOW_FRAGMENTS.has(f)) return true;       // 明确的空壳词
  // 以悬空介词开头、且整体很短（≤5字）、无量化 → 视为碎片
  if (f.length <= 5 && DANGLING_STARTERS.some((p) => f.startsWith(p))) return true;
  // 介词包裹式空壳：如「通过业务实现」「借助工作完成」——剥掉介词头与谓语尾后所剩无几
  for (const p of DANGLING_STARTERS) {
    if (f.startsWith(p)) {
      let rest = f.slice(p.length).replace(/(实现|完成|进行|开展|推进|落地)$/, '');
      if (rest.length <= 3) return true;
    }
  }
  return false;
}

function cleanupFragments(text) {
  let t = String(text || '').replace(/[，,、]{2,}/g, '，');
  const parts = t.split(/([，,])/);              // 保留分隔符便于重组
  const kept = [];
  for (let i = 0; i < parts.length; i += 2) {
    const seg = (parts[i] || '').trim();
    if (seg === '') continue;
    if (isHollowFragment(seg)) continue;         // 丢弃空壳碎片
    kept.push(seg);
  }
  return kept.join('，').replace(/[，,、]+$/, '').replace(/^[，,、]+/, '').trim();
}

// ---------- 单条经历改写：去套话 + 强动词 + 保留量化 ----------
function rewriteBullet(raw, domain, index) {
  let s = clean(raw);
  if (!s) return '';

  // 去掉列表符号
  s = s.replace(/^[-*·•\d.、\s]+/, '');

  // 删除空洞形容词
  EMPTY_ADJECTIVES.forEach((w) => {
    s = s.split(w).join('');
  });

  // 删除中文套话
  AI_CLICHES.forEach((w) => {
    s = s.split(w).join('');
  });

  // 清理删词后残留的断裂语句：按逗号切分，丢弃只剩虚词/空壳的碎片分句
  s = cleanupFragments(s);

  // 弱动词 → 强动词
  Object.keys(WEAK_TO_STRONG).forEach((weak) => {
    if (s.startsWith(weak)) {
      s = WEAK_TO_STRONG[weak] + s.slice(weak.length);
    }
  });

  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';

  // 若不是动词开头，补一个领域强动词
  const startsWithVerb = /^[主设实优重搭封开还构清分建训调解承完运推排交独带领写攻测]/.test(s);
  if (!startsWithVerb) {
    s = pickVerb(domain, index) + s;
  }

  // 结尾统一不加句号（条目式简历更干净）
  s = s.replace(/[。.,，、\s]+$/, '');
  return s;
}

// ---------- 量化提示：无数字的条目给出补充提醒 ----------
function hasMetric(text) {
  return /(\d+%|\d+\s*(万|千|百|亿|人|天|周|个月|倍|ms|qps|次|条|k\b|w\b)|提升|降低|减少|增长)/i.test(text);
}

// ============================================================
//  简历生成器：把 profile 组装成结构化简历数据 + 优化建议
// ============================================================
function generate(profile, options) {
  const p = profile || {};
  const targetRole = clean(options.targetRole || p.targetRole || '');
  const domain = detectDomain(
    targetRole + ' ' + (p.skills || '') + ' ' + (p.summary || '')
  );

  const tips = [];

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
  if (!basics.github) tips.push('计算机岗建议放上 GitHub / 个人主页，代码即最好的背书。');

  // 教育
  const education = (p.education || []).map((e) => ({
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
  function processSection(items) {
    return (items || []).map((it, idx) => {
      const bulletsRaw = Array.isArray(it.bullets)
        ? it.bullets
        : splitLines(it.description || it.bullets || '');
      const bullets = bulletsRaw
        .map((b, i) => rewriteBullet(b, detectDomain(it.tech || it.name || '') , idx + i))
        .filter(Boolean);
      bullets.forEach((b) => {
        if (!hasMetric(b)) {
          tips.push('「' + clean(it.name || it.company) + '」有条目缺少量化数据，尝试补上百分比 / 数量 / 时长。');
        }
      });
      return {
        name: clean(it.name || it.company),
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

  // 一句话摘要（本地拼接，不套 AI 模板腔）
  let summary = clean(p.summary);
  if (!summary) {
    const eduName = education[0] ? education[0].school + education[0].major : '计算机相关专业';
    const topSkills = uniqueSkills.slice(0, 3).join(' / ') || '扎实的编程基础';
    summary = eduName + '应届生，方向为' + basics.targetRole + '，掌握 ' + topSkills + '，有 ' +
      (projects.length + internships.length) + ' 段可展示的项目 / 实习经历。';
  }

  const resume = {
    basics,
    summary,
    education,
    skills: uniqueSkills,
    projects,
    internships,
    domain
  };

  // 生成后自检
  const auditText = [summary]
    .concat(projects.flatMap((x) => x.bullets))
    .concat(internships.flatMap((x) => x.bullets))
    .join('\n');
  const audit = auditAiFlavor(auditText);

  // 岗位匹配度：用简历全文（技能 + 经历 + 摘要）对目标方向核心技能做命中分析
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
//  依据目标方向的核心技能词库，扫描简历全文，算命中率并列出缺口
// ============================================================

// 技能别名匹配器：
// 纯 ASCII 别名按「词边界」匹配（边界只看字母，允许 vue3 / java8 这类带版本号的写法），
// 避免子串误判——javascript 误命中 java、html 误命中 ml、algorithm 误命中 go、json 误命中 js。
// 含中文或空格的别名退回 includes 子串匹配（中文本身无子串歧义）。
const _matcherCache = new Map();
function aliasMatcher(alias) {
  let m = _matcherCache.get(alias);
  if (m) return m;
  if (/^[a-z0-9.+#!?_-]+$/i.test(alias)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![a-z])' + escaped + '(?![a-z])', 'i');
    m = (content) => re.test(content);
  } else {
    const needle = alias.toLowerCase();
    m = (content) => content.includes(needle);
  }
  _matcherCache.set(alias, m);
  return m;
}

function matchJob(text, domain, targetRole) {
  const content = clean(text).toLowerCase();
  const skillList = ROLE_SKILLS[domain] || ROLE_SKILLS.general;

  const hit = [];
  const missing = [];
  skillList.forEach((entry) => {
    const aliases = entry.split('|');
    const label = aliases[0];
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
//  JD 精准匹配：粘贴职位描述，按 JD 中实际出现的技能词逐项比对简历
//  （本地词库匹配，非大模型；与 matchJob 的区别：matchJob 按「方向词表」
//   泛匹配，matchJd 按「这一份 JD」实际提到的技能精准匹配）
// ============================================================

// 汇总简历全部可匹配文本：摘要 + 技能 + 各段经历的名称/技术栈/条目
function buildResumeText(resume) {
  const r = resume || {};
  const parts = [];
  if (r.summary) parts.push(r.summary);
  if (Array.isArray(r.skills)) parts.push(r.skills.join(' '));
  const exps = [].concat(r.projects || [], r.internships || []);
  exps.forEach((it) => {
    parts.push([it.name, it.role, it.tech].filter(Boolean).join(' '));
    if (Array.isArray(it.bullets)) parts.push(it.bullets.join(' '));
  });
  return parts.filter(Boolean).join('\n');
}

// 扫描一段文本命中了词库中的哪些技能（跨全部方向去重），返回 [{label, domain}]
function scanSkillHits(contentLower) {
  const seen = new Set();
  const found = [];
  Object.keys(ROLE_SKILLS).forEach((dom) => {
    ROLE_SKILLS[dom].forEach((entry) => {
      const aliases = entry.split('|');
      const label = aliases[0];
      if (seen.has(label)) return;
      if (aliases.some((a) => aliasMatcher(a)(contentLower))) {
        seen.add(label);
        found.push({ label, domain: dom });
      }
    });
  });
  return found;
}

function matchJd(resume, jdText) {
  const jd = clean(jdText);
  if (!jd) throw new Error('请先粘贴职位描述（JD）');

  const jdLower = jd.toLowerCase();
  const resumeLower = buildResumeText(resume).toLowerCase();
  const domain = detectDomain(jd);

  // JD 中实际出现的词库技能 vs 简历中出现的词库技能
  const jdSkills = scanSkillHits(jdLower);
  const resumeSkills = scanSkillHits(resumeLower);
  const resumeLabels = new Set(resumeSkills.map((s) => s.label));

  const hit = jdSkills.filter((s) => resumeLabels.has(s.label));
  const missing = jdSkills.filter((s) => !resumeLabels.has(s.label));
  // 简历独有：JD 没提但你写了 —— 面试可展开的加分项
  const jdLabels = new Set(jdSkills.map((s) => s.label));
  const extra = resumeSkills.filter((s) => !jdLabels.has(s.label));

  const total = jdSkills.length;
  const score = total ? Math.round((hit.length / total) * 100) : 0;

  let level;
  if (!total) level = '未识别出技能关键词，请检查 JD 是否粘贴完整';
  else if (score >= 80) level = '高度匹配，放心投递';
  else if (score >= 60) level = '基本匹配，建议补齐缺失关键词';
  else if (score >= 40) level = '匹配偏低，按缺失项补强再投';
  else level = '匹配度低，谨慎投递或先补短板';

  const tips = [];
  if (!total) {
    tips.push('职位描述通常含「任职要求 / 技能要求」清单，请完整粘贴后再试。');
  } else {
    if (missing.length) {
      tips.push('JD 明确要求而简历未体现：' + missing.slice(0, 5).map((m) => m.label).join('、') +
        (missing.length > 5 ? ' 等' : '') + '，会的话补进技能或项目描述。');
    }
    if (score >= 60 && hit.length) {
      tips.push('投递前把命中的「' + hit.slice(0, 3).map((h) => h.label).join('、') + '」放进技能清单前半段，更容易被搜到。');
    }
    if (extra.length >= 8) {
      tips.push('简历技能比 JD 更广（' + extra.length + ' 项 JD 未提及），无碍投递，面试可作加分项展开。');
    }
  }

  return {
    domain,
    score,
    level,
    tips,
    hit,
    missing,
    extra,
    jdSkillCount: total,
    hitCount: hit.length
  };
}

// ============================================================
//  去 AI 味体检评分器：给一段文本打分并列出问题点
//  分数越高越「像真人写的」（满分 100）
// ============================================================
function auditAiFlavor(text) {
  const content = clean(text);
  const issues = [];
  let penalty = 0;

  function scan(list, label, per) {
    list.forEach((w) => {
      let idx = content.indexOf(w);
      while (idx !== -1) {
        issues.push({ type: label, word: w });
        penalty += per;
        idx = content.indexOf(w, idx + w.length);
      }
    });
  }

  // 中文套话（重扣）
  AI_CLICHES.forEach((w) => {
    const count = content.split(w).length - 1;
    if (count > 0) {
      issues.push({ type: '中文套话', word: w, count });
      penalty += count * 6;
    }
  });

  // 空洞形容词（中扣）
  EMPTY_ADJECTIVES.forEach((w) => {
    const count = content.split(w).length - 1;
    if (count > 0) {
      issues.push({ type: '空洞形容词', word: w, count });
      penalty += count * 3;
    }
  });

  // 英文 AI 高频词（中扣，忽略大小写）
  const lower = content.toLowerCase();
  AI_EN_WORDS.forEach((w) => {
    const count = lower.split(w).length - 1;
    if (count > 0) {
      issues.push({ type: '英文AI高频词', word: w, count });
      penalty += count * 4;
    }
  });

  // 结构性检查：整体缺少量化数据
  const lines = splitLines(content);
  const withMetric = lines.filter((l) => hasMetric(l)).length;
  const metricRatio = lines.length ? withMetric / lines.length : 0;
  if (lines.length >= 3 && metricRatio < 0.3) {
    issues.push({ type: '缺少量化', word: '量化数据占比偏低（<30%）' });
    penalty += 12;
  }

  // 冗长句：单句超过 45 字，阅读体验差、也偏 AI
  lines.forEach((l) => {
    if (l.length > 45) {
      issues.push({ type: '句子过长', word: l.slice(0, 16) + '…' });
      penalty += 3;
    }
  });

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

module.exports.detectDomain = detectDomain;
module.exports.rewriteBullet = rewriteBullet;
module.exports.hasMetric = hasMetric;
module.exports.splitLines = splitLines;
module.exports.clean = clean;
module.exports.generate = generate;
module.exports.auditAiFlavor = auditAiFlavor;
module.exports.matchJob = matchJob;
module.exports.matchJd = matchJd;
module.exports.aliasMatcher = aliasMatcher;
module.exports.buildResumeText = buildResumeText;
