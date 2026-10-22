// ============================================================
//  笔试中心核心逻辑（纯函数，可单测、无 IO）
//
//  组卷比例：60% 岗位 JD 命中知识点 / 30% 岗位方向基础 / 10% 通用能力。
//  评分规则：单选与判断完全正确得分；多选集合完全一致才得分；
//           填空做归一化后比较；全部不倒扣。
// ============================================================
import type { ExamQuestion, ExamPaper, WrongQuestion, ExamAttempt } from './types';
import { EXAM_BANK, QUESTION_MAP } from './exam-bank';

// ---------------- 知识点关键词 ----------------
// tag 是英文短名（组卷、统计都靠它），这里给出在 JD 文本里可能的写法。
const TAG_KEYWORDS: Record<string, string[]> = {
  java: ['java'],
  jvm: ['jvm', '虚拟机'],
  '集合': ['集合', 'hashmap', 'arraylist', 'linkedlist'],
  '并发': ['并发', '多线程', '线程池', 'volatile', 'synchronized'],
  '异常': ['异常', 'exception'],
  '泛型': ['泛型', 'generic'],
  '基础': ['java基础'],
  spring: ['spring', 'springboot', 'spring boot', 'spring mvc'],
  ioc: ['ioc', '依赖注入', '控制反转'],
  aop: ['aop', '切面'],
  '事务': ['事务', 'transactional', 'acid'],
  mvc: ['mvc', 'controller', 'restful'],
  mysql: ['mysql'],
  sql: ['sql', '查询语句', '数据库'],
  '索引': ['索引', 'index', 'b+树', 'b+ tree'],
  redis: ['redis', '缓存'],
  '缓存': ['缓存', 'cache', '缓存穿透', '缓存击穿'],
  network: ['tcp', 'udp', 'http', 'https', '网络', 'dns'],
  tcp: ['tcp', '三次握手', '四次挥手'],
  http: ['http', 'https', 'restful'],
  os: ['操作系统', 'linux', '进程', '线程', '内存管理'],
  javascript: ['javascript', 'js', 'es6', 'es2015'],
  '原型': ['原型', 'prototype', '继承'],
  '异步': ['异步', 'promise', 'async', 'await', '事件循环'],
  '闭包': ['闭包', 'closure'],
  css: ['css', '样式', 'flex', 'grid'],
  '布局': ['布局', 'flex', 'grid', '响应式'],
  '选择器': ['选择器', 'selector'],
  browser: ['浏览器', 'dom', '渲染'],
  '性能': ['性能', '优化', '首屏', '懒加载'],
  '安全': ['安全', 'xss', 'csrf', '注入'],
  '数据结构': ['数据结构', '链表', '栈', '队列', '哈希', '树'],
  '栈': ['栈', 'stack', '括号匹配'],
  '哈希': ['哈希', 'hash', '散列'],
  '树': ['二叉树', '红黑树', 'bst', '平衡树'],
  '算法': ['算法', '排序', '查找', 'bfs', 'dfs', 'dijkstra'],
  '复杂度': ['复杂度', '时间复杂度', '空间复杂度'],
  '动态规划': ['动态规划', 'dp', '记忆化'],
  '双指针': ['双指针', '滑动窗口'],
  '窗口函数': ['窗口函数', 'row_number', 'rank()', 'over('],
  '数仓': ['数仓', '数据仓库', 'ods', 'dwd', 'dws', 'etl'],
  '统计': ['统计', '均值', '中位数', '方差', '显著性'],
  'ab测试': ['ab测试', 'a/b', 'a/b测试', '实验组', '对照组', '对照实验'],
  '逻辑': ['逻辑', '推理'],
  '沟通': ['沟通', '表达'],
  '职业素养': ['职业素养', '面试礼仪'],
  '表达': ['表达', '反问'],
  '工程实践': ['工程实践', '规范', '代码review'],
  '接口': ['接口设计', 'restful', 'api'],
  '幂等': ['幂等', 'idempotent'],
  '日志': ['日志', 'log'],
  '分布式': ['分布式', '微服务', '一致性'],
  '工程化': ['工程化', '构建', 'webpack', 'vite', '打包'],
  '构建': ['构建', 'webpack', 'vite', 'tree shaking'],
  '数据分析': ['数据分析', '留存', '转化率'],
  // ---- 非技术方向：产品 / 运营 / 财务 / 人事 / 行政 / 英语 / 行测 ----
  '产品': ['产品经理', '产品', 'pm', '需求分析'],
  '需求优先级': ['需求优先级', '优先级', 'rice', '排期'],
  'mvp': ['mvp', '最小可行'],
  '指标': ['指标', '留存率', 'dau', 'mau', '北极星'],
  'kano': ['kano'],
  'prd': ['prd', '需求文档'],
  '用户研究': ['用户研究', '用户访谈', '用户调研'],
  '竞品分析': ['竞品'],
  '运营': ['运营', '用户运营', '内容运营', '活动运营'],
  '获客': ['获客', '拉新', 'cac'],
  'roi': ['roi', '投入产出'],
  '用户分层': ['用户分层', 'rfm'],
  '社群': ['社群', '社区运营'],
  '漏斗': ['漏斗', '转化路径'],
  '私域': ['私域'],
  '电商': ['电商', 'gmv'],
  '用户召回': ['召回', '唤醒'],
  '复盘': ['复盘'],
  '渠道': ['渠道', '投放'],
  'ltv': ['ltv', '生命周期价值'],
  '财务': ['财务', '会计', '出纳', '审计'],
  '报表': ['报表', '三大表', '资产负债表', '利润表'],
  '会计': ['会计', '记账', '借贷'],
  '比率': ['资产负债率', '流动比率', '速动比率', '周转率'],
  '利润': ['毛利率', '净利率', '净利润', '营业利润'],
  '现金流': ['现金流', '现金流量'],
  '折旧': ['折旧', '摊销'],
  '税务': ['税务', '增值税', '所得税', '进项'],
  '预算': ['预算', '全面预算'],
  '成本': ['成本核算', '固定成本', '变动成本'],
  '人力资源': ['人力资源', '人事', 'hr'],
  '招聘': ['招聘', '校招', '社招', '内推'],
  '面试': ['面试', 'star'],
  '劳动法': ['劳动法', '劳动合同法', '劳动合同'],
  '绩效': ['绩效', 'kpi', 'okr', '考核'],
  '薪酬': ['薪酬', '薪资结构', '社保', '公积金'],
  '员工关系': ['员工关系', '离职', '竞业'],
  '培训': ['培训', '人才培养'],
  '组织': ['组织架构', '组织发展', 'od'],
  '行政': ['行政', '前台', '后勤'],
  '公文': ['公文', '请示', '通知', '通报'],
  '会议': ['会议', '纪要'],
  '资产': ['固定资产', '资产盘点'],
  '采购': ['采购', '供应商', '比价'],
  '档案': ['档案'],
  '接待': ['接待', '商务礼仪'],
  '英语': ['英语', 'english', 'cet', '四级', '六级', '雅思', '托福'],
  '语法': ['语法', 'grammar', '时态'],
  '商务写作': ['商务写作', '商务邮件', '英文邮件'],
  '行测': ['行测', '行政职业能力'],
  '数量关系': ['数量关系', '工程问题', '行程问题'],
  '逻辑判断': ['逻辑判断', '真假话', '三段论'],
  '言语理解': ['言语理解', '成语', '病句'],
  '资料分析': ['资料分析', '同比增长', '比重']
};

/** 从任意文本（JD / 技能 / 目标岗位）提取命中的知识点标签 */
export function extractTags(text: string): string[] {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return [];
  const hits: string[] = [];
  for (const [tag, words] of Object.entries(TAG_KEYWORDS)) {
    if (words.some((w) => s.includes(w.toLowerCase()))) hits.push(tag);
  }
  // 题库里出现、但关键词表没覆盖的标签：直接按字面匹配一次
  for (const item of EXAM_BANK) {
    for (const tag of item.tags) {
      if (hits.includes(tag)) continue;
      if (s.includes(tag.toLowerCase())) hits.push(tag);
    }
  }
  return [...new Set(hits)];
}

export interface BuildPaperOptions {
  /** 岗位 JD 原文 */
  jdText?: string;
  /** 岗位技能要求 */
  skills?: string;
  /** 用户目标岗位 / 简历技能 */
  targetRole?: string;
  /** 题量（默认 20） */
  count?: number;
  /** 限时秒数（默认 1800） */
  durationSec?: number;
  /** 及格分（默认 60） */
  passScore?: number;
  /** 指定方向（不传则按标签自动判断） */
  domain?: string;
  /** 随机种子，测试时固定 */
  seed?: number;
}

export interface BuiltPaper {
  questionIds: string[];
  tags: string[];
  domain: string;
  /** 各段占比的实际题数，便于前端展示「这份卷子考了什么」。
   *  fallback 是被迫从全库兜底补的题数，total 是实际出题数——
   *  三者之和可能小于 total，差额就是兜底量，前端据此提示「本卷含 N 道通用补位题」。 */
  composition: { jd: number; domain: number; general: number; fallback: number; total: number };
}

// 简易可复现随机：同一 seed 得到同一套卷（测试与「重做同一份」都要稳定）
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 难度分层抽题：优先覆盖 2-4 星，避免整卷过难或过易 */
function pickByDifficulty(pool: ExamQuestion[], need: number, rng: () => number): ExamQuestion[] {
  if (need <= 0) return [];
  const byDiff = new Map<number, ExamQuestion[]>();
  pool.forEach((item) => {
    const list = byDiff.get(item.difficulty) || [];
    list.push(item);
    byDiff.set(item.difficulty, list);
  });
  // 目标分布：2星 25% / 3星 45% / 4星 25% / 1星 5%（不足时由其它难度补齐）
  const weights: Array<[number, number]> = [[2, 0.25], [3, 0.45], [4, 0.25], [1, 0.05], [5, 0]];
  const picked: ExamQuestion[] = [];
  for (const [diff, w] of weights) {
    const want = Math.round(need * w);
    const list = shuffle(byDiff.get(diff) || [], rng);
    picked.push(...list.slice(0, want));
  }
  // 补齐：按随机顺序从未选中的题里抽
  if (picked.length < need) {
    const pickedIds = new Set(picked.map((x) => x.id));
    const rest = shuffle(pool.filter((x) => !pickedIds.has(x.id)), rng);
    picked.push(...rest.slice(0, need - picked.length));
  }
  return picked.slice(0, need);
}

/**
 * 组卷：60% 岗位知识点 / 30% 方向基础 / 10% 通用。
 * 命中标签不足时自动回落到「同方向题」再回落到「全库随机」，
 * 保证任何岗位都能组出完整的一套卷子。
 */
export function buildPaper(opts: BuildPaperOptions = {}): BuiltPaper {
  const count = Math.min(50, Math.max(5, Math.round(Number(opts.count) || 20)));
  const seed = Number(opts.seed) || (Date.now() % 100000);
  const rng = makeRng(seed);

  const sourceText = [opts.jdText, opts.skills, opts.targetRole].filter(Boolean).join('\n');
  const tags = extractTags(sourceText);

  // 方向：优先显式指定 → 标签出现最多的方向 → general
  const tagOverlap = (item: ExamQuestion) => item.tags.filter((t) => tags.includes(t)).length;
  let domain = String(opts.domain || '').trim();
  if (!domain) {
    const score = new Map<string, number>();
    EXAM_BANK.forEach((item) => {
      score.set(item.domain, (score.get(item.domain) || 0) + tagOverlap(item));
    });
    let best = 'general', bestScore = 0;
    score.forEach((v, k) => { if (v > bestScore) { best = k; bestScore = v; } });
    domain = best;
  }

  const jdNeed = Math.max(1, Math.round(count * 0.6));
  const domainNeed = Math.round(count * 0.3);
  const generalNeed = Math.max(1, count - jdNeed - domainNeed);

  const used = new Set<string>();
  const take = (pool: ExamQuestion[], need: number) => {
    const avail = pool.filter((x) => !used.has(x.id));
    const got = pickByDifficulty(avail, need, rng);
    got.forEach((x) => used.add(x.id));
    return got;
  };

  // 1) 岗位 JD 命中标签的题
  const jdPool = tags.length
    ? EXAM_BANK.filter((x) => x.tags.some((t) => tags.includes(t)))
    : [];
  const jdPicked = take(jdPool, jdNeed);

  // 2) 方向基础题（排除已选）。
  // 没有 JD、或 JD 命中的题不够时，把 JD 份额并给方向题——
  // 否则「选了产品方向」却有一半题从全库兜底抽，考出来完全不是那个方向。
  const domainNeedActual = domainNeed + Math.max(0, jdNeed - jdPicked.length);
  const domainPool = EXAM_BANK.filter((x) => x.domain === domain);
  const domainPicked = take(domainPool, domainNeedActual);

  // 3) 通用能力题
  const generalPool = EXAM_BANK.filter((x) => x.domain === 'general');
  const generalPicked = take(generalPool, generalNeed);

  // 4) 兜底：任何一段不足都从全库补足
  const picked = [...jdPicked, ...domainPicked, ...generalPicked];
  const beforeFallback = picked.length;
  if (picked.length < count) {
    picked.push(...take(EXAM_BANK, count - picked.length));
  }
  const fallback = picked.length - beforeFallback;

  const ordered = shuffle(picked.slice(0, count), rng);
  return {
    questionIds: ordered.map((x) => x.id),
    tags,
    domain,
    composition: {
      jd: jdPicked.length,
      domain: domainPicked.length,
      general: generalPicked.length,
      fallback,
      total: ordered.length
    }
  };
}

// ---------------- 评分 ----------------

export interface GradeDetail {
  questionId: string;
  correct: boolean;
  /** correct=答对，wrong=答了但错，unanswered=没作答（只扣分，不进错题本） */
  reason: 'correct' | 'wrong' | 'unanswered';
  userAnswer: string | string[] | null;
  correctAnswer: string | string[];
  explanation: string;
  tags: string[];
}

export interface GradeResult {
  score: number;
  correctCount: number;
  totalCount: number;
  details: GradeDetail[];
  tagStats: Record<string, { correct: number; total: number }>;
  /** 本次做错的题（用于写错题本） */
  wrongIds: string[];
}

/** 填空归一化：全角转半角、去空白、转小写 */
export function normalizeFill(text: string): string {
  return String(text == null ? '' : text)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function asArray(v: string | string[] | null | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];
}

/** 判断单题是否正确 */
export function isCorrect(question: ExamQuestion, userAnswer: string | string[] | null | undefined): boolean {
  if (userAnswer == null || (Array.isArray(userAnswer) && userAnswer.length === 0)) return false;

  if (question.type === 'multiple') {
    const a = new Set(asArray(userAnswer).map((x) => x.trim()).filter(Boolean));
    const b = new Set(asArray(question.answer).map((x) => x.trim()).filter(Boolean));
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }

  if (question.type === 'fill') {
    const accepted = asArray(question.answer).map(normalizeFill);
    const got = normalizeFill(asArray(userAnswer)[0] || '');
    return !!got && accepted.includes(got);
  }

  // single / judge：选项文本完全一致
  return String(asArray(userAnswer)[0] || '').trim() === String(asArray(question.answer)[0] || '').trim();
}

/** 快照里的一条题目内容（结构与 ExamPaper['snapshots'] 的值一致） */
export type ExamSnapshot = NonNullable<ExamPaper['snapshots']>[string];

/**
 * 把试卷快照还原成 ExamQuestion：让旧卷子脱离当前题库也能渲染与判分。
 * 老快照没有 domain / difficulty，给安全默认值（不影响判分，只影响展示）。
 */
export function snapshotToQuestion(id: string, snap: ExamSnapshot): ExamQuestion {
  return {
    id,
    type: snap.type,
    domain: snap.domain || 'general',
    tags: snap.tags || [],
    difficulty: snap.difficulty || 3,
    stem: snap.stem,
    options: snap.options,
    answer: snap.answer,
    explanation: snap.explanation,
    version: snap.version || 1
  };
}

/**
 * 组卷时把题目内容冻结进试卷：题库改版后，历史成绩仍按当时的题干/答案解释。
 *
 * 放在 exam-core 而不是 main.ts 的原因：截图 mock 层也要用同一份实现，
 * 否则 mock 建出来的卷子没有快照，UI 测试会走「无快照回退题库」的路径，
 * 与真实主进程行为不一致——那种绿灯是假的。
 *
 * resolver 允许注入，方便测试用假题库。
 */
export function buildExamSnapshots(
  ids: string[],
  resolver: (id: string) => ExamQuestion | null = (id) => QUESTION_MAP.get(id) || null
): ExamPaper['snapshots'] {
  const out: NonNullable<ExamPaper['snapshots']> = {};
  for (const id of ids) {
    const q = resolver(id);
    if (!q) continue;
    out[id] = {
      type: q.type,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
      tags: q.tags,
      version: q.version,
      domain: q.domain,
      difficulty: q.difficulty
    };
  }
  return out;
}

/**
 * 下发给渲染层的题目：剥掉 answer / explanation。
 * 答题页不需要答案，交卷后才随结果返回——避免「打开开发者工具直接看答案」。
 */
export function publicExamQuestion(q: ExamQuestion) {
  return {
    id: q.id,
    type: q.type,
    domain: q.domain,
    tags: q.tags,
    difficulty: q.difficulty,
    stem: q.stem,
    options: q.options,
    version: q.version
  };
}

/**
 * 下发给渲染层的试卷：剥掉 snapshots（里面带 answer / explanation）。
 *
 * 安全边界：create / list / get 三个接口都必须走这里。
 * 直接返回 store 里的 paper 会把整份答案送到渲染层，交卷前就能读到。
 */
export function publicExamPaper(paper: ExamPaper) {
  const { snapshots, ...rest } = paper;
  return { ...rest, questionCount: paper.questionIds.length };
}

/** 试卷题目（已剥答案）：优先用快照，老数据没有快照才回退当前题库 */
export function paperQuestions(paper: ExamPaper) {
  return paper.questionIds
    .map((id) => {
      const q = resolveQuestion(id, paper.snapshots);
      return q ? publicExamQuestion(q) : null;
    })
    .filter((q): q is NonNullable<typeof q> => !!q);
}

/**
 * 取一道题：有快照用快照（历史口径），没有才回退当前题库（老数据兼容）。
 * 两者都没有才返回 null（题目确实丢失）。
 */
export function resolveQuestion(
  id: string,
  snapshots?: ExamPaper['snapshots']
): ExamQuestion | null {
  const snap = snapshots && snapshots[id];
  if (snap) return snapshotToQuestion(id, snap);
  return QUESTION_MAP.get(id) || null;
}

/**
 * 交卷评分：百分制，不倒扣。
 * 未作答按错处理，但不计入错题本（只把「答错」的题归档）。
 *
 * snapshots 传入时优先按快照判分：题库改题/删题后，旧卷子仍按组卷当时的答案与解析评分，
 * 不会出现「旧卷子分数变了」或「题目被删导致少算一题」。没有快照的老数据回退当前题库。
 */
export function gradePaper(
  questionIds: string[],
  answers: Record<string, string | string[]>,
  snapshots?: ExamPaper['snapshots']
): GradeResult {
  const details: GradeDetail[] = [];
  const tagStats: Record<string, { correct: number; total: number }> = {};
  const wrongIds: string[] = [];
  let correctCount = 0;

  for (const qid of questionIds) {
    const question = resolveQuestion(qid, snapshots);
    if (!question) continue; // 既无快照、题库里也没有：老卷子里的题确实没了
    const userAnswer = answers[qid] == null ? null : answers[qid];
    const ok = isCorrect(question, userAnswer);
    // 是否真的动过手：空数组 / 空白字符串都算「没作答」
    const answered = userAnswer != null && asArray(userAnswer).some((x) => String(x).trim());
    if (ok) correctCount++;
    else if (answered) {
      // 只有真正作答却答错的才进错题本；空着不算错题
      wrongIds.push(qid);
    }
    question.tags.forEach((tag) => {
      const st = tagStats[tag] || { correct: 0, total: 0 };
      st.total++;
      if (ok) st.correct++;
      tagStats[tag] = st;
    });
    details.push({
      questionId: qid,
      correct: ok,
      reason: ok ? 'correct' : (answered ? 'wrong' : 'unanswered'),
      userAnswer: userAnswer as string | string[] | null,
      correctAnswer: question.answer,
      explanation: question.explanation,
      tags: question.tags
    });
  }

  const totalCount = details.length || questionIds.length || 1;
  const score = Math.round((correctCount / totalCount) * 100);
  return { score, correctCount, totalCount: details.length, details, tagStats, wrongIds };
}

// ---------------- 薄弱项与下一轮 ----------------

export interface WeakTag {
  tag: string;
  correct: number;
  total: number;
  /** 正确率 0-1 */
  rate: number;
}

/** 从错题本 + 历史作答里归纳薄弱知识点（按正确率升序） */
export function weakTagsFromStats(
  statsList: Array<Record<string, { correct: number; total: number }>>
): WeakTag[] {
  const merged: Record<string, { correct: number; total: number }> = {};
  statsList.forEach((stats) => {
    Object.entries(stats || {}).forEach(([tag, st]) => {
      const cur = merged[tag] || { correct: 0, total: 0 };
      cur.correct += st.correct;
      cur.total += st.total;
      merged[tag] = cur;
    });
  });
  return Object.entries(merged)
    .map(([tag, st]) => ({ tag, correct: st.correct, total: st.total, rate: st.total ? st.correct / st.total : 0 }))
    .filter((x) => x.total >= 1)
    .sort((a, b) => a.rate - b.rate || b.total - a.total);
}

/**
 * 下一轮练习：错题优先（含同知识点新题），不足时补通用题。
 * 已掌握（mastered）的错题不再进入。
 */
export function buildReviewPaper(
  wrongs: WrongQuestion[],
  count = 10,
  seed = 0
): string[] {
  const rng = makeRng(seed || Date.now() % 100000);
  const active = (wrongs || []).filter((w) => !w.mastered && QUESTION_MAP.has(w.questionId));
  const picked: string[] = [];
  const used = new Set<string>();

  // 1) 错题本身（按错误次数降序）
  active
    .slice()
    .sort((a, b) => b.errorCount - a.errorCount || b.lastWrongAt - a.lastWrongAt)
    .forEach((w) => {
      if (picked.length >= count) return;
      if (used.has(w.questionId)) return;
      used.add(w.questionId);
      picked.push(w.questionId);
    });

  // 2) 同知识点的新题
  const tags = new Set<string>();
  active.forEach((w) => {
    const question = QUESTION_MAP.get(w.questionId);
    question && question.tags.forEach((t) => tags.add(t));
  });
  if (tags.size && picked.length < count) {
    const pool = shuffle(
      EXAM_BANK.filter((x) => !used.has(x.id) && x.tags.some((t) => tags.has(t))),
      rng
    );
    for (const item of pool) {
      if (picked.length >= count) break;
      used.add(item.id);
      picked.push(item.id);
    }
  }

  // 3) 仍不足则随机补
  if (picked.length < count) {
    const pool = shuffle(EXAM_BANK.filter((x) => !used.has(x.id)), rng);
    for (const item of pool) {
      if (picked.length >= count) break;
      used.add(item.id);
      picked.push(item.id);
    }
  }

  return picked.slice(0, count);
}

/** 组卷展示用：统计一套卷子覆盖的知识点分布 */
export function paperTagSummary(questionIds: string[]): Array<{ tag: string; count: number }> {
  const map = new Map<string, number>();
  questionIds.forEach((id) => {
    const question = QUESTION_MAP.get(id);
    if (!question) return;
    question.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1));
  });
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/** 校验试卷结构（IPC 入口用，防止越界） */
export function validatePaperInput(input: Partial<ExamPaper>): string | null {
  if (!Array.isArray(input.questionIds) || !input.questionIds.length) return '试卷至少需要一道题';
  if (input.questionIds.length > 50) return '单份试卷最多 50 题';
  const unknown = input.questionIds.filter((id) => !QUESTION_MAP.has(String(id)));
  if (unknown.length) return '试卷包含题库中不存在的题目：' + unknown.slice(0, 3).join(', ');
  const dur = Number(input.durationSec);
  if (dur !== undefined && (!isFinite(dur) || dur < 60 || dur > 7200)) return '限时需在 1 分钟到 2 小时之间';
  return null;
}

// ---------------- 知识点趋势 ----------------

export interface TagTrend {
  tag: string;
  /** 该知识点的历史总正确率（0-1），用于排序与图例 */
  rate: number;
  /** 按时间顺序的每次正确率（0-1），前端据此画折线 */
  points: number[];
}

/**
 * 从已交卷记录里归纳知识点趋势：取最薄弱的 topN 个知识点，
 * 各自按时间顺序给出历次正确率。数据全部来自 attempt.tagStats，不需要额外存储。
 * 只统计出现过 2 次以上的知识点——单次样本的「100% / 0%」没有趋势意义。
 */
export function buildTagTrends(attempts: ExamAttempt[], topN = 3): TagTrend[] {
  const done = (attempts || [])
    .filter((a) => a && a.status === 'submitted' && a.tagStats)
    .sort((a, b) => (a.submittedAt || a.startedAt || 0) - (b.submittedAt || b.startedAt || 0));

  const agg: Record<string, { correct: number; total: number }> = {};
  done.forEach((a) => {
    Object.entries(a.tagStats || {}).forEach(([tag, st]) => {
      if (!st) return;
      const cur = agg[tag] || { correct: 0, total: 0 };
      cur.correct += Number(st.correct) || 0;
      cur.total += Number(st.total) || 0;
      agg[tag] = cur;
    });
  });

  return Object.entries(agg)
    .map(([tag, st]) => {
      // 每次考试该知识点的正确率（该次没考到就不出点）
      const points = done
        .map((a) => {
          const s = (a.tagStats || {})[tag];
          return s && s.total ? s.correct / s.total : null;
        })
        .filter((v): v is number => v != null);
      return { tag, rate: st.total ? st.correct / st.total : 0, total: st.total, points };
    })
    // 至少考过两次、且累计做过 2 道以上，才算「有趋势」；
    // 单次考试的 0% / 100% 画不出线，也没有参考价值
    .filter((x) => x.total >= 2 && x.points.length >= 2)
    .sort((a, b) => a.rate - b.rate || b.total - a.total)
    .slice(0, Math.max(1, topN))
    .map((w) => ({ tag: w.tag, rate: w.rate, points: w.points }));
}
