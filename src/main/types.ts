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
  score: number;
  level: string;
  tips: string[];
  hit: Array<SkillHit & { domain: Domain }>;
  missing: Array<SkillHit & { domain: Domain }>;
  extra: Array<SkillHit & { domain: Domain }>;
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
  mode: 'agentic';
  error: string | null;
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
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: RawToolCall[];
  name?: string;
  tool_call_id?: string;
}

export interface RawToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments: unknown };
}

export interface NormalizedToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: RawToolCall;
}

export interface ToolCallReply {
  content: string;
  toolCalls: NormalizedToolCall[];
  rawToolCalls: RawToolCall[];
}

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

export type LlmClient = {
  readonly provider: 'ollama' | 'cloud';
  readonly config: LlmConfig;
  status(): Promise<LlmStatus>;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string | ToolCallReply>;
};

export interface LlmConfig {
  provider?: 'cloud';
  endpoint: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  timeout?: number;
  jsonMode?: boolean;
}

export interface LlmStatus {
  available: boolean;
  models: string[];
  error?: string;
}

export interface ChatOptions {
  onChunk?: (piece: string) => void;
  tools?: Array<Record<string, unknown>>;
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
