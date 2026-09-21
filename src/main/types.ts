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
}
