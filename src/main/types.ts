// ============================================================
//  共享领域类型：主进程各模块的契约层
//  迁移策略：先定义类型（这份文件是「数据形状」的唯一权威），
//  再逐模块改造实现 —— 类型即文档，跨模块数据流从此可静态检查。
// ============================================================

// ---------- IPC 信封 ----------
export interface IpcOk<T> { ok: true; data: T }
export interface IpcFail { ok: false; error: string }
export type IpcResult<T> = IpcOk<T> | IpcFail;

// ---------- 档案 ----------
export interface EducationEntry {
  school: string;
  major: string;
  degree: string;
  period: string;
  gpa: string;
  courses: string;
}

export interface ExperienceEntry {
  name: string;
  role: string;
  period: string;
  tech: string;
  // 存储形态：单段文本（表单录入）；解析器产物：多行数组（每条一行）
  description: string | string[];
}

export interface Profile {
  name: string;
  phone: string;
  email: string;
  city: string;
  github: string;
  targetRole: string;
  summary: string;
  skills: string;
  education: EducationEntry[];
  internships: ExperienceEntry[];
  projects: ExperienceEntry[];
  /** 竞赛 / 奖项 / 荣誉 / 证书：每行一条，原样保留用户写法（如「省级国画大赛三等奖 2008」） */
  awards: string[];
}

// ---------- 生成结果 ----------
export interface Basics {
  name: string;
  phone: string;
  email: string;
  city: string;
  github: string;
  targetRole: string;
}

export interface GeneratedItem {
  name: string;
  role: string;
  period: string;
  tech: string;
  bullets: string[];
}

export interface Resume {
  basics: Basics;
  summary: string;
  education: EducationEntry[];
  skills: string[];
  projects: GeneratedItem[];
  internships: GeneratedItem[];
  awards: string[];
  domain: Domain;
}

export type Domain =
  // 技术方向
  | 'backend' | 'frontend' | 'algorithm' | 'data' | 'llm'
  // 全专业方向
  | 'finance'    // 金融财务（银行/证券/会计/审计）
  | 'marketing'  // 市场运营（新媒体/品牌/销售/电商）
  | 'design'     // 创意设计（平面/UI/插画/视频）
  | 'eng'        // 工科制造（机械/电气/自动化/汽车）
  | 'civil'      // 土木建筑（造价/施工/监理/测绘）
  | 'education'  // 教育培训（教师/教研/课程）
  | 'medical'    // 医药卫生（医师/护理/药学）
  | 'business'   // 人力行政（HR/行政/招聘/客服）
  | 'general';

export interface AuditIssue {
  type: string;
  word: string;
  count?: number;
}

export interface AuditResult {
  score: number;
  level: string;
  issues: AuditIssue[];
  metricRatio: number;
}

export interface SkillHit { label: string }

export interface MatchJobResult {
  targetRole: string;
  domain: Domain;
  score: number;
  level: string;
  hit: SkillHit[];
  missing: SkillHit[];
  hitCount: number;
  total: number;
}

export interface MatchJdResult {
  domain: Domain;
  /** 加权得分：硬性要求（必须/熟练/掌握）权重 3、一般提及 2、加分项 1 */
  score: number;
  /** 未加权的纯命中率（保留用于对比与回归） */
  rawScore: number;
  level: string;
  tips: string[];
  hit: Array<SkillHit & { domain: Domain }>;
  missing: Array<SkillHit & { domain: Domain }>;
  extra: Array<SkillHit & { domain: Domain }>;
  /** 硬性要求（JD 中「必须/熟练/掌握」）但简历未体现的项 */
  mustMissing: Array<SkillHit & { domain: Domain }>;
  jdSkillCount: number;
  hitCount: number;
}

export interface GenerateResult {
  resume: Resume;
  tips: string[];
  audit: AuditResult;
  match: MatchJobResult;
}

// ---------- Agent ----------
export interface AgentStep {
  tool: string;
  label: string;
  ok: boolean;
  ms: number;
  detail: string;
  /** 该步工具重试了几次（工具注册层记录，>0 说明第一次失败了） */
  retryCount?: number;
}

export interface AcceptedRewrite {
  id: string;
  old: string;
  text: string;
}

export interface RejectedRewrite {
  id: string;
  reason: string;
}

export interface PipelineResult {
  ok: boolean;
  /** pipeline = LLM 流水线；rules = 零下载规则通道（不调用任何模型） */
  mode: 'pipeline' | 'rules';
  error: string | null;
  rounds: number;
  accepted: AcceptedRewrite[];
  rejected: RejectedRewrite[];
  auditBefore: number;
  auditAfter: number;
  jdBefore: number;
  jdAfter: number;
  jdMissingAfter: string[];
  contextOmitted?: number;
  contextTruncated?: number;
  steps: AgentStep[];
}

export interface AgenticResult {
  ok: boolean;
  /** 有可用改写但关键步骤没做完：界面要展示结果 + 明确警告，而不是当成彻底失败 */
  partial?: boolean;
  mode: 'agentic';
  error: string | null;
  /** 收工时仍缺的关键动作（如没分析 JD）：有值说明这次不算完整完成，要如实告诉用户 */
  incomplete?: string | null;
  /** 收工时的完成度校验明细（哪些项通过、条目覆盖多少、催了几次、用了几次工具） */
  completion?: {
    checks: Array<{ key: string; ok: boolean; critical: boolean; label: string }>;
    coverage: { total: number; untouched: number; untouchedIds: string[] };
    rejectedPendingRetry: number;
    nudges: number;
    toolCalls: number;
  } | null;
  /** Agentic 运行的完整记录（状态机终态、预算用量、逐步 trace），供界面复盘与 CLI 回放 */
  run?: {
    runId: string;
    taskId: string;
    status: string;
    currentStep: string;
    startedAt: number;
    finishedAt: number | null;
    error: string | null;
    cancelReason: string | null;
    usage: { steps: number; toolCalls: number; retries: number; ms: number; tokens: number };
    inputSnapshot: {
      itemCount: number; sections: Record<string, number>;
      jdLength: number; jdDigest: string; profileDigest: string;
    };
  } | null;
  stepsUsed: number;
  rounds: number;
  accepted: AcceptedRewrite[];
  rejected: RejectedRewrite[];
  auditBefore: number;
  auditAfter: number;
  jdBefore: number;
  jdAfter: number;
  jdMissingAfter: string[];
  steps: AgentStep[];
}

// ---------- LLM ----------
// 这些类型现在归 packages/llm-adapters 所有（它要能独立编译与测试），应用侧统一从这里再导出，
// 保证「线上用的类型」与「适配层实现里的类型」是同一份定义。
export type {
  ChatMessage, RawToolCall, NormalizedToolCall, ToolCallReply, LlmClient, LlmConfig, LlmStatus, ChatOptions
} from '../../packages/llm-adapters/dist/index';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx?: unknown) => unknown;
}

export interface ProtocolTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---------- 快照 ----------
export interface AgentSnapshotMeta {
  id: string;
  label: string;
  createdAt: number;
}

export interface AgentSnapshot extends AgentSnapshotMeta {
  profile: Profile;
}

// ---------- 简历版本（多版本：一个岗位一版） ----------
/** 落盘的版本记录（含档案本体与针对的 JD） */
export interface ResumeVersion {
  id: string;
  name: string;
  note: string;
  targetRole: string;
  template: string;
  /** 保存时算好的体检分 / JD 覆盖率（便于横向比较哪版更合适） */
  auditScore: number | null;
  jdScore: number | null;
  jdHit: number;
  jdTotal: number;
  createdAt: number;
  updatedAt: number;
  profile: Profile;
  jdText: string;
}

/** 列表用的轻量元数据：去掉两个大字段，hasJd 由 jdText 派生（不落盘） */
export interface ResumeVersionMeta extends Omit<ResumeVersion, 'profile' | 'jdText'> {
  hasJd: boolean;
}

// ---------- 用户 / 会话 ----------
export interface StoredUser {
  id: string;
  email: string;
  name: string;
  salt: string;
  hash: string;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export interface SessionInfo {
  token: string;
  expiresAt: number;
}

export interface Application {
  id?: string;
  company: string;
  position?: string;
  url?: string;
  stage?: string;
  createdAt?: number;
  updatedAt?: number;
  /** 公司所在地：从招聘平台抄下来的写法，如「北京·朝阳区」（用于查内置坐标表） */
  place?: string;
  /** 精确坐标（纬度、经度），内部统一 WGS-84；有它时优先于 place 的查表结果 */
  lat?: number;
  lng?: number;
  /** 坐标来源：city/district=内置城市表，manual=手填，map=地图点选 */
  placeSource?: string;
  /** 备注：粘贴导入时把识别到的薪资/平台/学历/经验写在这里，不丢信息 */
  notes?: string;
  // ---------- 岗位结构化信息（从官网/平台抄下来的原文，存池时原样带走） ----------
  /** 薪资范围，如「12k-18k·14薪」 */
  salary?: string;
  /** 学历要求，如「本科」 */
  education?: string;
  /** 经验要求，如「应届 / 3-5年」 */
  experience?: string;
  /** 技能要求，如「Java / Spring / Redis」 */
  skills?: string;
  /** 招聘平台同步字段：仅接受用户授权导出的数据或官方接口返回值 */
  source?: string;
  externalId?: string;
  syncStatus?: 'manual' | 'synced' | 'stale' | 'error';
  syncError?: string;
  lastSyncedAt?: number;
  address?: string;
  // ---------- 投递跟进（全部可选：老数据自动兼容，缺省即无跟进信息） ----------
  /** 下一步行动，如「等 HR 回复」「发跟进邮件」 */
  nextAction?: string;
  /** 该投递关联的目标岗位池条目 id */
  jobId?: string;
  /** 笔试时间（ISO 8601 或 YYYY-MM-DD HH:mm 字符串） */
  examAt?: string;
  /** 下一轮面试时间 */
  interviewAt?: string;
  /** 目前进行到的面试轮次（1 = 一面…） */
  interviewRound?: number;
  /** HR / 招聘联系人姓名 */
  contactName?: string;
  /** HR 联系方式（邮箱 / 微信 / 电话） */
  contact?: string;
  /** 下次跟进日期（ISO 8601 日期字符串） */
  nextDueAt?: string;
  /** 被拒绝原因（stage = rejected 时填写） */
  rejectReason?: string;
}

// ---------- 岗位池（统一管理目标岗位：完整 JD、优先级、收藏、匹配分） ----------
export interface Job {
  id?: string;
  /** 公司名 */
  company: string;
  /** 岗位名称 */
  position: string;
  /** 完整 JD 原文 */
  jdText?: string;
  /** 薪资描述（原文即可，如「15-20k·13薪」） */
  salary?: string;
  /** 城市，如「北京·朝阳区」 */
  city?: string;
  /** 学历要求 */
  education?: string;
  /** 经验要求 */
  experience?: string;
  /** 核心技能标签（逗号分隔） */
  skills?: string;
  /** 来源（招聘平台 / 官网 / 内推） */
  source?: string;
  /** 链接 */
  url?: string;
  /** 收藏标记 */
  starred?: boolean;
  /** 淘汰标记（不再考虑） */
  rejected?: boolean;
  /** 淘汰原因（rejected = true 时填写） */
  rejectReason?: string;
  /** 池内状态：candidate=候选，applied=已转投递，closed=已关闭（过期/放弃） */
  status?: 'candidate' | 'applied' | 'closed';
  /** 投递截止日期（YYYY-MM-DD 或带时间字符串） */
  deadline?: string;
  /** 工作性质：全职 / 实习 / 兼职 / 校招 */
  jobType?: string;
  /** 福利待遇（原文） */
  benefits?: string;
  /** 公司规模（如「500-999人」） */
  companySize?: string;
  /** 优先级 1-5（5 最高） */
  priority?: number;
  /** 保存时算好的简历-JD 匹配分（0-100，未算为 null） */
  jdScore?: number | null;
  /** 关联投递记录 id（用户点了「投递」后回填） */
  applicationId?: string;
  createdAt?: number;
  updatedAt?: number;
}

// ============================================================
//  笔试中心（第一阶段只做客观题：单选 / 多选 / 判断 / 填空）
//  SQL 与编程题留到后续版本：需要独立 Worker + 资源限制 + 沙箱，
//  绝不能在 Electron 渲染进程里直接执行用户代码。
// ============================================================

export type ExamQuestionType = 'single' | 'multiple' | 'judge' | 'fill';

export interface ExamQuestion {
  id: string;
  type: ExamQuestionType;
  /** 方向：backend / frontend / algorithm / data / general … */
  domain: string;
  /** 知识点标签：java / spring / sql / network … 组卷与薄弱项分析都靠它 */
  tags: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** 题干 */
  stem: string;
  /** 选项（judge 固定为 ['正确','错误']；fill 无选项） */
  options?: string[];
  /** 答案：单选/判断为选项文本；多选为文本数组；填空为字符串或可接受答案数组 */
  answer: string | string[];
  /** 解析 */
  explanation: string;
  /** 题目来源（自编 / 公开题库摘录） */
  source?: string;
  /** 题目版本，改题时递增，便于统计口径 */
  version: number;
}

export interface ExamPaper {
  id: string;
  title: string;
  /** 关联岗位（从岗位池组卷时写入） */
  jobId?: string;
  /** 关联投递记录 */
  applicationId?: string;
  /** 题目 id 列表（顺序即试卷顺序） */
  questionIds: string[];
  /** 限时（秒） */
  durationSec: number;
  /** 及格分（百分制） */
  passScore: number;
  createdAt: number;
  /** 组卷时使用的方向与标签，便于复盘「这份卷子考了什么」 */
  domain?: string;
  tags?: string[];
  /** 组卷时的岗位快照：岗位被删除/改名后，历史成绩仍能显示当时投的是哪个岗 */
  jobCompany?: string;
  jobPosition?: string;
  /** 实际组卷构成（JD 知识点 / 方向基础 / 通用），前端按真实值展示比例 */
  composition?: { jd: number; domain: number; general: number };
  /** 题库版本：题库改动后，历史卷子的题目口径可追溯 */
  bankVersion?: number;
  /** 题目快照：questionId → 组卷当时的题干/选项/答案，题库改版不改变历史成绩的解释 */
  snapshots?: Record<string, {
    type: ExamQuestionType; stem: string; options?: string[];
    answer: string | string[]; explanation: string; tags: string[]; version: number;
  }>;
}

export interface ExamAttempt {
  id: string;
  paperId: string;
  /** 作答：questionId → 选中项文本 / 文本数组 / 填空字符串 */
  answers: Record<string, string | string[]>;
  /** 百分制得分 */
  score: number;
  correctCount: number;
  totalCount: number;
  /** 实际用时（秒） */
  durationSec: number;
  /** draft=作答中（草稿，可续答），submitted=已交卷，abandoned=放弃 */
  status: 'draft' | 'submitted' | 'abandoned';
  startedAt: number;
  submittedAt?: number;
  /** 交卷后按知识点统计的正确率：tag → { correct, total } */
  tagStats?: Record<string, { correct: number; total: number }>;
}

export interface WrongQuestion {
  questionId: string;
  errorCount: number;
  lastWrongAt: number;
  /** 用户标记已掌握（不再进入下一轮练习） */
  mastered: boolean;
  /** 下次复习时间（简单间隔重复：错 1 次 1 天，2 次 3 天，3 次以上 7 天） */
  nextReviewAt?: number;
}

export interface StudyPlan {
  id: string;
  jobId?: string;
  targetRole: string;
  weeklyQuestionGoal: number;
  completedCount: number;
  /** 薄弱知识点（按错题率排序） */
  weakTags: string[];
  createdAt: number;
  updatedAt: number;
}

// ============================================================
//  编程题（ACM 标准输入输出）
//  判题在独立子进程里跑：超时强杀、输出截断、进程树清理。
//  这是「防呆」而不是「防恶意」——本机单机应用，做题的是用户自己；
//  真要防恶意代码必须上 WASM 或容器，见 docs 讨论。
// ============================================================

export type ProgramLang = 'javascript' | 'python';

export interface CodeSample {
  input: string;
  output: string;
  explain?: string;
}

export interface CodeTestCase {
  input: string;
  output: string;
}

export interface CodeQuestion {
  id: string;
  title: string;
  domain: string;
  tags: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** 题面（支持换行） */
  statement: string;
  inputFormat: string;
  outputFormat: string;
  /** 公开样例：题面里展示，也可「运行样例」 */
  samples: CodeSample[];
  /** 隐藏用例：只用于判题，不下发给渲染层 */
  testCases: CodeTestCase[];
  timeLimitMs: number;
  memoryLimitMb: number;
  starterCode?: { javascript?: string; python?: string };
  hint?: string;
  version: number;
}

/** AC=通过 WA=答案错 TLE=超时 RE=运行错误 OLE=输出超限 MLE=内存超限 CE=编译/启动失败 */
export type CodeVerdict = 'AC' | 'WA' | 'TLE' | 'RE' | 'OLE' | 'MLE' | 'CE';

export interface CodeCaseResult {
  index: number;
  verdict: CodeVerdict;
  timeMs: number;
  isSample: boolean;
  /** 仅样例回传输入/期望/实际；隐藏用例只给 verdict 与耗时，避免泄题 */
  input?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
}

export interface CodeRunResult {
  verdict: CodeVerdict;
  passed: number;
  total: number;
  timeMs: number;
  cases: CodeCaseResult[];
  message?: string;
}
