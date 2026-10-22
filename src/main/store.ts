'use strict';

// ============================================================
//  本地 JSON 存储（TypeScript 版）：原子写 + 会话清扫 + Agent 快照
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  StoredUser, PublicUser, Profile, Application, AgentSnapshot, AgentSnapshotMeta,
  ResumeVersion, ResumeVersionMeta, Job,
  ExamPaper, ExamAttempt, WrongQuestion, StudyPlan,
  CodeDraft, CodeSubmission
} from './types';

interface DbShape {
  users: StoredUser[];
  profiles: Record<string, Profile & { userId?: string; updatedAt?: number; createdAt?: number }>;
  applications: Record<string, Application[]>;
  sessions: Record<string, { userId: string; expiresAt: number; createdAt: number }>;
  settings: Record<string, unknown>;
  agentSnapshots: Record<string, AgentSnapshot[]>;
  resumeVersions: Record<string, ResumeVersion[]>;
  /** 岗位池：userId → 目标岗位列表（含完整 JD、优先级、收藏、淘汰标记） */
  jobs: Record<string, Job[]>;
  /** 笔试中心：试卷 / 作答 / 错题 / 学习计划（全部按用户隔离） */
  examPapers: Record<string, ExamPaper[]>;
  examAttempts: Record<string, ExamAttempt[]>;
  examWrongs: Record<string, WrongQuestion[]>;
  examPlans: Record<string, StudyPlan[]>;
  /** 编程题草稿：userId → `${questionId}::${lang}` → 草稿 */
  codeDrafts: Record<string, Record<string, CodeDraft>>;
  /** 编程题提交记录：userId → 最近提交（最新的在前） */
  codeSubmissions: Record<string, CodeSubmission[]>;
  /** 数据格式版本：将来改结构时据此迁移，缺省视为 1（老库） */
  schemaVersion?: number;
}

// 当前数据格式版本。改动 db 结构时 +1，并在 load() 里补迁移分支
export const SCHEMA_VERSION = 1;

let dataDir: string | null = null;
let dbFile: string | null = null;

const db: DbShape = {
  users: [],
  profiles: {},
  applications: {},
  sessions: {},
  settings: {},
  agentSnapshots: {}, // userId → 快照数组（最多 5 份，最新在前）
  resumeVersions: {}, // userId → 简历版本数组（最多 30 份，最新在前）
  jobs: {},           // userId → 岗位池数组（目标岗位统一管理）
  examPapers: {},     // userId → 笔试试卷（组卷结果）
  examAttempts: {},   // userId → 作答记录（草稿 + 已交卷）
  examWrongs: {},     // userId → 错题本
  examPlans: {},      // userId → 学习计划
  codeDrafts: {},     // userId → 题目+语言 → 代码草稿
  codeSubmissions: {} // userId → 编程题提交记录
};

// 快照上限：防止无限膨胀（每份档案通常 < 10KB）
const MAX_SNAPSHOTS = 5;
// 版本上限：一版一个岗位，30 份够用；每份含档案本体，容量需有界
const MAX_VERSIONS = 30;
// 自动备份保留份数
const BACKUP_KEEP = 5;
const BACKUP_DIR = 'backups';
// 名字带毫秒：同一秒内连续两次备份也不会互相覆盖，且字典序即时间序
const BACKUP_RE = /^db-\d{8}-\d{9}\.json$/;

export function init(userDataPath: string): void {
  dataDir = path.join(userDataPath, 'grad-resume-data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbFile = path.join(dataDir, 'db.json');
  rotateBackup(); // 先把上一轮结束时的库留一份（万一这轮跑出问题可回滚）
  load();
  sweepExpiredSessions();
}

// ---------------- 自动轮转备份 ----------------
// 动机：库是单文件 JSON，一次意外写入（例如旧实例用内存里的旧库覆盖）
// 就可能丢掉整个集合，且无从找回。启动时留一份上一轮状态的副本，
// 保留最近 BACKUP_KEEP 份，让这类意外永远可回滚。
// 只备份「能解析且非空」的文件；内容与最近一份相同则跳过（不堆重复副本）。
function backupDir(): string | null {
  return dataDir ? path.join(dataDir, BACKUP_DIR) : null;
}

function stamp(d: Date): string {
  const p = (n: number, w: number): string => String(n).padStart(w, '0');
  return p(d.getFullYear(), 4) + p(d.getMonth() + 1, 2) + p(d.getDate(), 2) + '-' +
    p(d.getHours(), 2) + p(d.getMinutes(), 2) + p(d.getSeconds(), 2) + p(d.getMilliseconds(), 3);
}

// 取一个还没被占用的备份名：毫秒级撞车时（快速文件系统上很常见）往后顺延毫秒，
// 而不是覆盖同名文件。顺延保证字典序仍然等于时间序，也保证文件名始终符合 BACKUP_RE。
function uniqueBackupName(dir: string): string | null {
  const base = Date.now();
  for (let i = 0; i < 5000; i++) {
    const name = 'db-' + stamp(new Date(base + i)) + '.json';
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return null; // 连顺延 5 秒都被占满：宁可这次不备份，也不写一个不符合命名规范/会覆盖别人的文件
}

export function rotateBackup(): { created: string | null; kept: number } {
  const dir = backupDir();
  try {
    if (!dbFile || !dir || !fs.existsSync(dbFile)) return { created: null, kept: 0 };
    const raw = fs.readFileSync(dbFile, 'utf-8');
    if (raw.trim().length < 20) return { created: null, kept: 0 }; // 空库/半截文件不备份
    try { JSON.parse(raw); } catch (_) { return { created: null, kept: 0 }; } // 坏文件不备份（load 会另存 .corrupt-）

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const list = (): string[] => fs.readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
    const existing = list();
    const last = existing[existing.length - 1];
    if (last) {
      try {
        if (fs.readFileSync(path.join(dir, last), 'utf-8') === raw) {
          return { created: null, kept: existing.length }; // 内容没变，不重复备份
        }
      } catch (_) { /* 读不了就当需要重新备份 */ }
    }

    const name = uniqueBackupName(dir);
    if (!name) return { created: null, kept: existing.length };
    fs.writeFileSync(path.join(dir, name), raw, 'utf-8');
    const all = list();
    all.slice(0, Math.max(0, all.length - BACKUP_KEEP)).forEach((f) => {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* 忽略 */ }
    });
    return { created: name, kept: Math.min(all.length, BACKUP_KEEP) };
  } catch (_) {
    return { created: null, kept: 0 }; // 备份失败绝不能影响启动
  }
}

export interface BackupMeta { name: string; size: number; createdAt: number }

export function listBackups(): BackupMeta[] {
  const dir = backupDir();
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => BACKUP_RE.test(f))
      .sort()
      .reverse() // 最新在前
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, size: st.size, createdAt: st.mtimeMs };
      });
  } catch (_) {
    return [];
  }
}

export function backupsPath(): string | null {
  return backupDir();
}

// 从备份恢复：只接受严格命名的文件（防路径穿越），且内容必须能解析
export function restoreBackup(name: string): { restored: string } {
  const dir = backupDir();
  if (!dir || !BACKUP_RE.test(String(name || ''))) throw new Error('备份文件名不合法');
  const src = path.join(dir, name);
  if (!fs.existsSync(src)) throw new Error('备份不存在');
  const raw = fs.readFileSync(src, 'utf-8');
  let parsed: Partial<DbShape>;
  try {
    parsed = JSON.parse(raw) as Partial<DbShape>;
  } catch (_) {
    throw new Error('该备份已损坏，无法恢复');
  }
  if (!parsed || !parsed.users) throw new Error('该备份内容不完整，拒绝恢复');
  if (!dbFile) throw new Error('存储未初始化');
  // 覆盖前先把「当前状态」也留一份，恢复本身也可回滚
  rotateBackupRaw();
  fs.writeFileSync(dbFile, raw, 'utf-8');
  load(); // 重新载入内存
  return { restored: name };
}

// 供 restoreBackup 使用：无条件按当前内容留一份（不受「内容相同则跳过」影响）
function rotateBackupRaw(): void {
  const dir = backupDir();
  try {
    if (!dbFile || !dir || !fs.existsSync(dbFile)) return;
    const raw = fs.readFileSync(dbFile, 'utf-8');
    if (raw.trim().length < 20) return;
    try { JSON.parse(raw); } catch (_) { return; }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const name = uniqueBackupName(dir);
    if (!name) return;
    fs.writeFileSync(path.join(dir, name), raw, 'utf-8');
  } catch (_) { /* 忽略 */ }
}

// 批量清理过期会话：否则旧 token 只在恰好被访问时才清理，长期会无限累积
function sweepExpiredSessions(): void {
  const now = Date.now();
  let dirty = false;
  Object.keys(db.sessions).forEach((token) => {
    const s = db.sessions[token];
    if (s && s.expiresAt && s.expiresAt < now) {
      delete db.sessions[token];
      dirty = true;
    }
  });
  if (dirty) persist();
}

// 结构校验：只认「形状对」的字段，类型不对就退回空值。
// 原来写的是 `parsed.users || []` —— 只要字段是 truthy 就照单全收，
// 于是 `users: {}` 这种「truthy 但类型错」的库会让后续 users.find() 直接抛异常，
// 整个应用起不来。现在按字段逐个校正，坏库最多丢那一个字段，不至于全盘崩。
function asRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, T> : {};
}
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}
/** 只保留形如 { userId, expiresAt, createdAt } 的会话项 */
function asSessions(value: unknown): DbShape['sessions'] {
  const raw = asRecord<unknown>(value);
  const out: DbShape['sessions'] = {};
  Object.keys(raw).forEach((k) => {
    const s = raw[k];
    if (s && typeof s === 'object' && typeof (s as { userId?: unknown }).userId === 'string') {
      const item = s as { userId: string; expiresAt?: unknown; createdAt?: unknown };
      out[k] = {
        userId: item.userId,
        expiresAt: typeof item.expiresAt === 'number' ? item.expiresAt : 0,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0
      };
    }
  });
  return out;
}
/** users 必须是数组，且每项至少有 id/email（缺 id 的条目留着只会让 find 返回坏对象） */
function asUsers(value: unknown): StoredUser[] {
  return asArray<StoredUser>(value).filter((u) =>
    !!u && typeof u === 'object' && typeof (u as { id?: unknown }).id === 'string'
  );
}

/** 自愈：同 userId 下同 id 的投递记录只留最后一条（历史 bug 双重插入的修复）。
 *  背景：importAuthorized 曾在 saveApplication 内部 unshift 之后又对同一数组
 *  引用 unshift 一次，导致同 id 记录成对出现——看板显示两张一样的卡，
 *  删除按 id 过滤一次删掉两条（用户实测踩过）。加载时静默去重即可，
 *  不需要迁移脚本；rotateBackup 已在改动前留了备份。 */
function dedupeApplications(): void {
  for (const uid of Object.keys(db.applications)) {
    const list = db.applications[uid];
    if (!Array.isArray(list) || list.length < 2) continue;
    const seen = new Set<string>();
    const kept: Application[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i]!;
      if (!a || typeof a !== 'object' || !a.id) { kept.unshift(a); continue; }
      if (seen.has(a.id)) continue; // 丢弃较早的重复项（数组头部是旧的）
      seen.add(a.id);
      kept.unshift(a);
    }
    if (kept.length !== list.length) db.applications[uid] = kept;
  }
}

function load(): void {
  try {
    if (dbFile && fs.existsSync(dbFile)) {
      const raw = fs.readFileSync(dbFile, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('库根节点不是对象');
      }
      db.users = asUsers(parsed.users);
      db.profiles = asRecord(parsed.profiles);
      db.applications = asRecord(parsed.applications);
      dedupeApplications(); // 历史双重插入自愈（见函数注释）
      db.sessions = asSessions(parsed.sessions);
      db.settings = asRecord(parsed.settings);
      db.agentSnapshots = asRecord(parsed.agentSnapshots);
      // 老库没有 resumeVersions 字段：缺省为空，向前兼容
      db.resumeVersions = asRecord(parsed.resumeVersions);
      // 老库没有 jobs 字段：缺省为空，向前兼容
      db.jobs = asRecord(parsed.jobs);
      // 笔试中心：老库缺省为空
      db.examPapers = asRecord(parsed.examPapers);
      db.examAttempts = asRecord(parsed.examAttempts);
      db.examWrongs = asRecord(parsed.examWrongs);
      db.examPlans = asRecord(parsed.examPlans);
      // 编程题草稿与提交记录：老库缺省为空
      db.codeDrafts = asRecord(parsed.codeDrafts);
      db.codeSubmissions = asRecord(parsed.codeSubmissions);
    }
  } catch (err) {
    // 数据损坏时不崩溃，退回空库并备份原文件
    try {
      if (dbFile && fs.existsSync(dbFile)) {
        fs.renameSync(dbFile, dbFile + '.corrupt-' + Date.now());
      }
    } catch (_) { /* 忽略 */ }
  }
}

function persist(): void {
  if (!dbFile) return;
  // 原子写：先写 .tmp 再 rename。直接覆写会在断电/崩溃时留下半截 JSON（整库读不出来）。
  const tmp = dbFile + '.tmp';
  const out = Object.assign({}, db, { schemaVersion: SCHEMA_VERSION });
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
  fs.renameSync(tmp, dbFile);
}

export function findUserByEmail(email: string): StoredUser | null {
  const key = String(email || '').trim().toLowerCase();
  return db.users.find((u) => u.email === key) || null;
}

export function findUserById(id: string): StoredUser | null {
  return db.users.find((u) => u.id === id) || null;
}

function addUser(user: StoredUser): StoredUser {
  db.users.push(user);
  persist();
  return user;
}

export { addUser as _addUser };

export function getProfile(userId: string): (Profile & { userId?: string; updatedAt?: number; createdAt?: number }) | null {
  return db.profiles[userId] || null;
}

export function saveProfile(userId: string, profile: Partial<Profile>): Profile & { userId?: string; updatedAt?: number; createdAt?: number } {
  if (!findUserById(userId)) throw new Error('用户不存在');
  const now = Date.now();
  const prev = db.profiles[userId] || {};
  db.profiles[userId] = { ...prev, ...profile, userId, updatedAt: now, createdAt: prev.createdAt || now };
  persist();
  return db.profiles[userId];
}

export function listApplications(userId: string): Application[] {
  return db.applications[userId] || [];
}

export function saveApplication(userId: string, application: Application): Application {
  if (!db.applications[userId]) db.applications[userId] = [];
  const list = db.applications[userId]!;
  const now = Date.now();
  if (application.id) {
    const idx = list.findIndex((a) => a.id === application.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx]!, ...application, updatedAt: now };
      persist();
      return list[idx]!;
    }
  }
  const created: Application = {
    ...application,
    id: 'app_' + now + '_' + Math.random().toString(36).slice(2, 8),
    createdAt: now,
    updatedAt: now
  };
  list.unshift(created);
  persist();
  return created;
}

export function deleteApplication(userId: string, appId: string): { removed: string } {
  const list = db.applications[userId] || [];
  db.applications[userId] = list.filter((a) => a.id !== appId);
  persist();
  return { removed: appId };
}

// ---------------- 会话（记住登录） ----------------
function createSession(token: string, userId: string, expiresAt: number): string {
  db.sessions[token] = { userId, expiresAt, createdAt: Date.now() };
  persist();
  return token;
}

export { createSession as _createSession };

// 校验 token：有效则返回 userId，过期/无效则清理并返回 null
function getSessionUserId(token: string): string | null {
  // 调用方传入的始终是 bearer token。它本身也是 64 位十六进制字符串，
  // 不能用“长度/字符集”判断它已经是 digest，否则新会话永远恢复不了。
  // 先按新格式计算 digest，再兼容旧库里直接把明文 token 当键的记录。
  const raw = String(token || '');
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  let key = digest;
  let s = db.sessions[key];
  if (!s && raw) {
    const legacy = db.sessions[raw];
    if (legacy) {
      key = digest;
      s = legacy;
      db.sessions[key] = legacy;
      delete db.sessions[raw];
      persist();
    }
  }
  if (!s) return null;
  if (s.expiresAt && s.expiresAt < Date.now()) {
    // key 是实际命中的数据库键；token 可能是 bearer 原文，不能拿它删除 digest 键。
    delete db.sessions[key];
    persist();
    return null;
  }
  return s.userId;
}

export { getSessionUserId as _getSessionUserId };

function clearSession(token: string): { removed: string } {
  // 与 getSessionUserId 保持一致：bearer token 即使恰好是 64 位十六进制，也必须先 hash。
  const raw = String(token || '');
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  if (db.sessions[digest]) {
    delete db.sessions[digest];
    persist();
  } else if (db.sessions[raw]) {
    // 兼容老库的明文键
    delete db.sessions[raw];
    persist();
  }
  return { removed: token };
}

export { clearSession as _clearSession };

// ---------------- 设置 ----------------
// 分两类：设备级（镜像等，跟具体账号无关）与用户级（Agent 模型配置，含云端 API Key）。
// 用户级必须按 userId 隔离：settings 曾经是全局对象，等于多账号共用一个配置和密钥。
const USER_SCOPED_SETTINGS = new Set(['agent', 'map']);

export function getSetting<T = unknown>(key: string, userId?: string): T | null {
  const scoped = userId && USER_SCOPED_SETTINGS.has(key) ? userId + ':' + key : key;
  const v = db.settings[scoped];
  if (v != null) return v as T;
  // 向前兼容：老库里的全局键在「只有一个账号」时被继承过来，并顺手搬走，
  // 否则其它账号仍能通过回退读到同一份密钥，隔离就是假的。
  if (scoped !== key) {
    const legacy = db.settings[key];
    if (legacy != null && Object.keys(db.users || {}).length <= 1) {
      (db.settings as Record<string, unknown>)[scoped] = legacy;
      delete (db.settings as Record<string, unknown>)[key];
      persist();
      return legacy as T;
    }
  }
  return null;
}

export function setSetting<T>(key: string, value: T, userId?: string): T {
  const scoped = userId && USER_SCOPED_SETTINGS.has(key) ? userId + ':' + key : key;
  (db.settings as Record<string, unknown>)[scoped] = value;
  persist();
  return value;
}

// ---------------- Agent 快照（改写应用前的后悔药） ----------------
export function saveAgentSnapshot(userId: string, label: string, profile: Partial<Profile>): AgentSnapshot {
  if (!db.agentSnapshots[userId]) db.agentSnapshots[userId] = [];
  const list = db.agentSnapshots[userId]!;
  list.unshift({
    id: 'snap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    label: String(label || 'Agent 改写前').slice(0, 60),
    profile: JSON.parse(JSON.stringify(profile || {})) as Profile, // 深拷贝，与后续修改隔离
    createdAt: Date.now()
  });
  if (list.length > MAX_SNAPSHOTS) list.length = MAX_SNAPSHOTS;
  persist();
  return list[0]!;
}

export function listAgentSnapshots(userId: string): AgentSnapshotMeta[] {
  return (db.agentSnapshots[userId] || []).map((s) => ({
    id: s.id, label: s.label, createdAt: s.createdAt // 不带 profile，列表轻量
  }));
}

export function getAgentSnapshot(userId: string, snapshotId: string): Profile | null {
  const s = (db.agentSnapshots[userId] || []).find((x) => x.id === snapshotId);
  return s ? JSON.parse(JSON.stringify(s.profile)) as Profile : null;
}

export function deleteAgentSnapshot(userId: string, snapshotId: string): { removed: string } {
  const list = db.agentSnapshots[userId] || [];
  db.agentSnapshots[userId] = list.filter((x) => x.id !== snapshotId);
  persist();
  return { removed: snapshotId };
}

// ---------------- 简历版本（多版本：一个岗位一版） ----------------
// 与「回炉快照」的区别：快照是自动产生的后悔药（最多 5 份、只有标签）；
// 版本是用户主动命名并长期保留的定制稿，带它针对的 JD 与保存时的评分，
// 便于横向比较「哪一版更贴这个岗位」，也便于下次同一岗位直接载入。

function toVersionMeta(v: ResumeVersion): ResumeVersionMeta {
  return {
    id: v.id, name: v.name, note: v.note, targetRole: v.targetRole,
    hasJd: !!(v.jdText && v.jdText.trim()),
    template: v.template,
    auditScore: v.auditScore, jdScore: v.jdScore, jdHit: v.jdHit, jdTotal: v.jdTotal,
    createdAt: v.createdAt, updatedAt: v.updatedAt
    // 刻意不带 profile / jdText：列表轻量，需要时再 getVersion
  };
}

export function listVersions(userId: string): ResumeVersionMeta[] {
  return (db.resumeVersions[userId] || []).map(toVersionMeta);
}

export function getVersion(userId: string, versionId: string): ResumeVersion | null {
  const v = (db.resumeVersions[userId] || []).find((x) => x.id === versionId);
  return v ? (JSON.parse(JSON.stringify(v)) as ResumeVersion) : null;
}

export interface SaveVersionInput {
  id?: string;
  name?: string;
  note?: string;
  profile: Partial<Profile>;
  jdText?: string;
  targetRole?: string;
  template?: string;
  auditScore?: number | null;
  jdScore?: number | null;
  jdHit?: number;
  jdTotal?: number;
}

export function saveVersion(userId: string, input: SaveVersionInput): ResumeVersionMeta {
  if (!findUserById(userId)) throw new Error('用户不存在');
  const now = Date.now();
  if (!db.resumeVersions[userId]) db.resumeVersions[userId] = [];
  const list = db.resumeVersions[userId]!;

  const name = String(input.name || '').trim().slice(0, 40) || '未命名版本';
  const base = {
    name,
    note: String(input.note || '').trim().slice(0, 120),
    profile: JSON.parse(JSON.stringify(input.profile || {})) as Profile, // 深拷贝，与后续修改隔离
    jdText: String(input.jdText || '').slice(0, 8000),
    targetRole: String(input.targetRole || '').slice(0, 60),
    template: String(input.template || 'classic'),
    auditScore: typeof input.auditScore === 'number' ? input.auditScore : null,
    jdScore: typeof input.jdScore === 'number' ? input.jdScore : null,
    jdHit: Number(input.jdHit) || 0,
    jdTotal: Number(input.jdTotal) || 0,
    updatedAt: now
  };

  // 带 id → 覆盖该版本（改名/更新内容）；否则新建
  if (input.id) {
    const idx = list.findIndex((x) => x.id === input.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx]!, ...base };
      persist();
      return toVersionMeta(list[idx]!);
    }
  }
  const created: ResumeVersion = { id: 'ver_' + now + '_' + Math.random().toString(36).slice(2, 8), createdAt: now, ...base };
  list.unshift(created);
  if (list.length > MAX_VERSIONS) list.length = MAX_VERSIONS; // 超出丢弃最旧的
  persist();
  return toVersionMeta(created);
}

// 只改名字/备注（不动档案本体）
export function renameVersion(userId: string, versionId: string, name: string, note?: string): ResumeVersionMeta {
  const list = db.resumeVersions[userId] || [];
  const v = list.find((x) => x.id === versionId);
  if (!v) throw new Error('版本不存在或已删除');
  const next = String(name || '').trim().slice(0, 40);
  if (next) v.name = next;
  if (typeof note === 'string') v.note = note.trim().slice(0, 120);
  v.updatedAt = Date.now();
  persist();
  return toVersionMeta(v);
}

export function deleteVersion(userId: string, versionId: string): { removed: string } {
  const list = db.resumeVersions[userId] || [];
  db.resumeVersions[userId] = list.filter((x) => x.id !== versionId);
  persist();
  return { removed: versionId };
}

// ---------------- 岗位池（统一管理目标岗位） ----------------
// 与「投递记录」的区别：投递记录是「我已经投了什么」，岗位池是「我正在考虑投什么」。
// 岗位先入池（可收藏、排优先级、算匹配分），决定投了才落到投递记录，并回填 applicationId。
const MAX_JOBS = 200; // 岗位池上限：防止无限膨胀，200 条足够覆盖整个求职季

export function listJobs(userId: string): Job[] {
  return db.jobs[userId] || [];
}

export function getJob(userId: string, jobId: string): Job | null {
  const j = (db.jobs[userId] || []).find((x) => x.id === jobId);
  return j ? (JSON.parse(JSON.stringify(j)) as Job) : null;
}

// 字段长度上限：字符串字段统一在这里声明，cleanJobInput 与去重逻辑共用。
const JOB_STR_FIELDS: Array<[keyof Job, number]> = [
  ['company', 120], ['position', 120], ['jdText', 8000], ['salary', 60],
  ['city', 120], ['education', 60], ['experience', 60], ['skills', 500],
  ['source', 40], ['url', 1000], ['rejectReason', 200], ['applicationId', 80],
  ['deadline', 40], ['jobType', 40], ['benefits', 500], ['companySize', 40]
];
const JOB_STATUSES = ['candidate', 'applied', 'closed'] as const;

/**
 * 清洗岗位输入。
 * 关键语义：**只返回调用方显式传入的字段**。
 * 以前这里对每个字段都给默认值（''/false/3），更新时 `{...old, ...clean}` 会把
 * 没传的字段全部覆盖成空 —— 比如「转投递」只传 id+company+applicationId，
 * 就会把用户的 JD、薪资、学历全部清掉。未传 = 不动。
 */
function cleanJobInput(input: Partial<Job>): Partial<Job> {
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, max] of JOB_STR_FIELDS) {
    if (src[key] === undefined) continue;
    const k = key as string;
    // JD 原文保留换行与首尾空白外的内容；其余字段 trim
    const raw = String(src[key] == null ? '' : src[key]);
    const val = k === 'jdText' ? raw.slice(0, max) : raw.trim().slice(0, max);
    if (k === 'applicationId' && !val) { out[k] = undefined; continue; }
    out[k] = val;
  }
  if (src.starred !== undefined) out.starred = !!src.starred;
  if (src.rejected !== undefined) out.rejected = !!src.rejected;
  if (src.priority !== undefined) {
    out.priority = Math.min(5, Math.max(1, Math.round(Number(src.priority) || 3)));
  }
  if (src.jdScore !== undefined) {
    out.jdScore = typeof src.jdScore === 'number' && isFinite(src.jdScore) ? src.jdScore : null;
  }
  if (src.status !== undefined) {
    const s = String(src.status);
    out.status = (JOB_STATUSES as readonly string[]).includes(s) ? s : 'candidate';
  }
  return out as Partial<Job>;
}

export function saveJob(userId: string, input: Partial<Job>): Job {
  if (!findUserById(userId)) throw new Error('用户不存在');
  const clean = cleanJobInput(input);
  if (!db.jobs[userId]) db.jobs[userId] = [];
  const list = db.jobs[userId]!;
  const now = Date.now();

  // ---- 更新：只覆盖显式传入的字段（未传的保持原值）----
  if (input.id) {
    const idx = list.findIndex((x) => x.id === input.id);
    if (idx >= 0) {
      if (clean.company !== undefined && !String(clean.company).trim()) {
        throw new Error('公司名称不能为空');
      }
      list[idx] = { ...list[idx]!, ...clean, id: input.id, updatedAt: now };
      persist();
      return list[idx]!;
    }
    // id 指向的条目已不存在：退化为新增，避免静默丢弃用户输入
  }

  const company = String(clean.company || '').trim();
  if (!company) throw new Error('公司名称不能为空');
  const position = String(clean.position || '').trim();
  const url = String(clean.url || '').trim();

  // ---- 统一去重：同公司+同岗位，或同一链接，视为同一条岗位 ----
  // 放在后端做，渲染层就不用各自实现一套；命中时合并更新并返回原 id。
  const dup = list.find((j) => {
    if (url && j.url && j.url === url) return true;
    if (!position) return false; // 没写岗位名时不做公司级判重，避免误合并
    return (j.company || '') === company && (j.position || '') === position;
  });
  if (dup) {
    const merged: Job = {
      ...dup,
      ...clean,
      company,
      position,
      id: dup.id!,
      createdAt: dup.createdAt,
      updatedAt: now
    };
    const i = list.findIndex((x) => x.id === dup.id);
    list[i] = merged;
    persist();
    return merged;
  }

  const created: Job = {
    ...clean,
    company,
    position,
    id: 'job_' + now + '_' + Math.random().toString(36).slice(2, 8),
    status: (clean.status as Job['status']) || 'candidate',
    priority: typeof clean.priority === 'number' ? clean.priority : 3,
    createdAt: now,
    updatedAt: now
  } as Job;
  list.unshift(created);
  if (list.length > MAX_JOBS) list.length = MAX_JOBS;
  persist();
  return created;
}

/** 只更新标记类字段（收藏 / 淘汰 / 优先级），不改其它内容 */
export function markJob(
  userId: string,
  jobId: string,
  patch: { starred?: boolean; rejected?: boolean; rejectReason?: string; priority?: number }
): Job {
  const list = db.jobs[userId] || [];
  const j = list.find((x) => x.id === jobId);
  if (!j) throw new Error('岗位不存在或已删除');
  if (typeof patch.starred === 'boolean') j.starred = patch.starred;
  if (typeof patch.rejected === 'boolean') {
    j.rejected = patch.rejected;
    // 淘汰即关闭；取消淘汰时按是否已转投递回到对应状态
    j.status = patch.rejected ? 'closed' : (j.applicationId ? 'applied' : 'candidate');
  }
  if (typeof patch.rejectReason === 'string') j.rejectReason = patch.rejectReason.trim().slice(0, 200);
  if (typeof patch.priority === 'number') j.priority = Math.min(5, Math.max(1, Math.round(patch.priority)));
  j.updatedAt = Date.now();
  persist();
  return j;
}

export function deleteJob(userId: string, jobId: string): { removed: string } {
  const list = db.jobs[userId] || [];
  db.jobs[userId] = list.filter((x) => x.id !== jobId);
  persist();
  return { removed: jobId };
}

// ============================================================
//  笔试中心：试卷 / 作答 / 错题 / 学习计划
// ============================================================

const MAX_EXAM_PAPERS = 100;
const MAX_EXAM_ATTEMPTS = 200;
const MAX_EXAM_WRONGS = 500;

export function listExamPapers(userId: string): ExamPaper[] {
  return db.examPapers[userId] || [];
}

export function getExamPaper(userId: string, paperId: string): ExamPaper | null {
  const p = (db.examPapers[userId] || []).find((x) => x.id === paperId);
  return p ? (JSON.parse(JSON.stringify(p)) as ExamPaper) : null;
}

export function saveExamPaper(userId: string, input: Partial<ExamPaper>): ExamPaper {
  if (!findUserById(userId)) throw new Error('用户不存在');
  const qids = Array.isArray(input.questionIds)
    ? input.questionIds.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 100)
    : [];
  if (!qids.length) throw new Error('试卷至少需要一道题');
  if (!db.examPapers[userId]) db.examPapers[userId] = [];
  const list = db.examPapers[userId]!;
  const now = Date.now();
  const paper: ExamPaper = {
    id: input.id ? String(input.id) : 'paper_' + now + '_' + Math.random().toString(36).slice(2, 8),
    title: String(input.title || '模拟笔试').trim().slice(0, 120),
    jobId: input.jobId ? String(input.jobId).slice(0, 80) : undefined,
    applicationId: input.applicationId ? String(input.applicationId).slice(0, 80) : undefined,
    questionIds: qids,
    durationSec: Math.min(7200, Math.max(60, Math.round(Number(input.durationSec) || 1800))),
    passScore: Math.min(100, Math.max(0, Math.round(Number(input.passScore) || 60))),
    createdAt: now,
    domain: input.domain ? String(input.domain).slice(0, 40) : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 40)).slice(0, 30) : undefined,
    jobCompany: input.jobCompany ? String(input.jobCompany).slice(0, 120) : undefined,
    jobPosition: input.jobPosition ? String(input.jobPosition).slice(0, 120) : undefined,
    bankVersion: typeof input.bankVersion === 'number' ? input.bankVersion : undefined,
    composition: input.composition && typeof input.composition === 'object'
      ? {
          jd: Math.max(0, Math.round(Number(input.composition.jd) || 0)),
          domain: Math.max(0, Math.round(Number(input.composition.domain) || 0)),
          general: Math.max(0, Math.round(Number(input.composition.general) || 0))
        }
      : undefined,
    // 题目快照：题库改版后，历史成绩仍按当时的题干/答案解释
    snapshots: input.snapshots && typeof input.snapshots === 'object'
      ? (JSON.parse(JSON.stringify(input.snapshots)) as ExamPaper['snapshots'])
      : undefined
  };
  const idx = list.findIndex((x) => x.id === paper.id);
  if (idx >= 0) list[idx] = paper; else list.unshift(paper);
  if (list.length > MAX_EXAM_PAPERS) list.length = MAX_EXAM_PAPERS;
  persist();
  return paper;
}

export function listExamAttempts(userId: string, paperId?: string): ExamAttempt[] {
  const list = db.examAttempts[userId] || [];
  return paperId ? list.filter((a) => a.paperId === paperId) : list;
}

export function getExamAttempt(userId: string, attemptId: string): ExamAttempt | null {
  const a = (db.examAttempts[userId] || []).find((x) => x.id === attemptId);
  return a ? (JSON.parse(JSON.stringify(a)) as ExamAttempt) : null;
}

/** 保存作答：草稿保存与交卷共用；只覆盖传入的字段。 */
export function saveExamAttempt(userId: string, input: Partial<ExamAttempt>): ExamAttempt {
  if (!findUserById(userId)) throw new Error('用户不存在');
  if (!db.examAttempts[userId]) db.examAttempts[userId] = [];
  const list = db.examAttempts[userId]!;
  const now = Date.now();

  let att: ExamAttempt | undefined;
  if (input.id) {
    att = list.find((x) => x.id === input.id);
    // 带 id 却找不到：拒绝，避免把拼错/过期的 id 悄悄写成一条孤立草稿
    if (!att) throw new Error('作答记录不存在或已删除');
    // 终态不可回退：已交卷/已放弃的记录不再接受任何写入。
    // 重复交卷按幂等处理（原样返回第一次结果），其余写操作直接拒绝。
    if (att.status === 'submitted' || att.status === 'abandoned') {
      if (input.status === 'submitted' && att.status === 'submitted') return att;
      throw new Error(att.status === 'submitted' ? '已交卷的作答不能再修改' : '已放弃的作答不能再修改');
    }
  } else {
    att = {
      id: 'att_' + now + '_' + Math.random().toString(36).slice(2, 8),
      paperId: String(input.paperId || ''),
      answers: {},
      score: 0,
      correctCount: 0,
      totalCount: 0,
      durationSec: 0,
      status: 'draft',
      startedAt: now
    };
    list.unshift(att);
  }

  if (input.answers && typeof input.answers === 'object') {
    att.answers = JSON.parse(JSON.stringify(input.answers));
  }
  if (typeof input.score === 'number') att.score = input.score;
  if (typeof input.correctCount === 'number') att.correctCount = input.correctCount;
  if (typeof input.totalCount === 'number') att.totalCount = input.totalCount;
  if (typeof input.durationSec === 'number') att.durationSec = Math.max(0, Math.round(input.durationSec));
  if (input.status === 'draft' || input.status === 'submitted' || input.status === 'abandoned') {
    att.status = input.status;
    if (input.status === 'submitted' || input.status === 'abandoned') {
      att.submittedAt = input.submittedAt || now;
    }
  }
  if (input.tagStats && typeof input.tagStats === 'object') {
    att.tagStats = JSON.parse(JSON.stringify(input.tagStats));
  }
  if (list.length > MAX_EXAM_ATTEMPTS) list.length = MAX_EXAM_ATTEMPTS;
  persist();
  return att;
}

export function deleteExamAttempt(userId: string, attemptId: string): { removed: string } {
  const list = db.examAttempts[userId] || [];
  db.examAttempts[userId] = list.filter((x) => x.id !== attemptId);
  persist();
  return { removed: attemptId };
}

export function listWrongQuestions(userId: string): WrongQuestion[] {
  return (db.examWrongs[userId] || []).slice();
}

/** 简单间隔重复：错 1 次 1 天、2 次 3 天、3 次以上 7 天后复习 */
function reviewIntervalDays(errorCount: number): number {
  if (errorCount <= 1) return 1;
  if (errorCount === 2) return 3;
  return 7;
}

/** 交卷时合并错题：累加错误次数、重置掌握标记、安排下次复习 */
export function mergeWrongQuestions(
  userId: string,
  items: Array<{ questionId: string; errorCount?: number }>
): WrongQuestion[] {
  if (!findUserById(userId)) throw new Error('用户不存在');
  if (!db.examWrongs[userId]) db.examWrongs[userId] = [];
  const list = db.examWrongs[userId]!;
  const now = Date.now();
  for (const it of items || []) {
    const qid = String((it && it.questionId) || '').trim();
    if (!qid) continue;
    const inc = Math.max(1, Math.round(Number(it.errorCount) || 1));
    const hit = list.find((x) => x.questionId === qid);
    if (hit) {
      hit.errorCount += inc;
      hit.lastWrongAt = now;
      hit.mastered = false;
      hit.nextReviewAt = now + reviewIntervalDays(hit.errorCount) * 86400000;
    } else {
      list.unshift({
        questionId: qid,
        errorCount: inc,
        lastWrongAt: now,
        mastered: false,
        nextReviewAt: now + reviewIntervalDays(inc) * 86400000
      });
    }
  }
  // 真正的错题不应该无限增长：超出上限时优先丢弃已掌握的旧记录
  if (list.length > MAX_EXAM_WRONGS) {
    list.sort((a, b) => Number(a.mastered) - Number(b.mastered) || b.lastWrongAt - a.lastWrongAt);
    list.length = MAX_EXAM_WRONGS;
  }
  persist();
  return list;
}

export function setWrongMastered(userId: string, questionId: string, mastered: boolean): WrongQuestion {
  const list = db.examWrongs[userId] || [];
  const hit = list.find((x) => x.questionId === questionId);
  if (!hit) throw new Error('错题不存在');
  hit.mastered = !!mastered;
  if (hit.mastered) hit.nextReviewAt = undefined;
  else hit.nextReviewAt = Date.now() + reviewIntervalDays(hit.errorCount) * 86400000;
  persist();
  return hit;
}

/** 学习计划的归属键：有岗位按岗位，没有则归到通用计划 */
function planKey(jobId?: string): string {
  return String(jobId || '').slice(0, 80);
}

export function listStudyPlans(userId: string): StudyPlan[] {
  return (db.examPlans[userId] || []).slice();
}

export function getStudyPlan(userId: string, jobId?: string): StudyPlan | null {
  const key = planKey(jobId);
  const hit = (db.examPlans[userId] || []).find((p) => planKey(p.jobId) === key);
  return hit ? (JSON.parse(JSON.stringify(hit)) as StudyPlan) : null;
}

/**
 * 学习计划按 jobId 拆分（每个岗位一份，另有一份通用计划）。
 * 以前每个用户只有一份，考第二个岗位时会覆盖前一个岗位的进度与薄弱项。
 */
export function saveStudyPlan(userId: string, input: Partial<StudyPlan>): StudyPlan {
  if (!findUserById(userId)) throw new Error('用户不存在');
  if (!db.examPlans[userId]) db.examPlans[userId] = [];
  const list = db.examPlans[userId]!;
  const now = Date.now();
  const key = planKey(input.jobId);
  const idx = list.findIndex((p) => planKey(p.jobId) === key);

  const base: StudyPlan = idx >= 0 ? list[idx]! : {
    id: 'plan_' + now + '_' + Math.random().toString(36).slice(2, 8),
    jobId: key || undefined,
    targetRole: '',
    weeklyQuestionGoal: 30,
    completedCount: 0,
    weakTags: [],
    createdAt: now,
    updatedAt: now
  };

  const next: StudyPlan = {
    ...base,
    jobId: key || undefined,
    targetRole: input.targetRole !== undefined ? String(input.targetRole).slice(0, 80) : base.targetRole,
    weeklyQuestionGoal: typeof input.weeklyQuestionGoal === 'number'
      ? Math.min(500, Math.max(1, Math.round(input.weeklyQuestionGoal)))
      : base.weeklyQuestionGoal,
    // 允许显式传 0（重置进度）
    completedCount: typeof input.completedCount === 'number'
      ? Math.max(0, Math.round(input.completedCount))
      : base.completedCount,
    weakTags: Array.isArray(input.weakTags)
      ? input.weakTags.map((t) => String(t).slice(0, 40)).slice(0, 30)
      : base.weakTags,
    updatedAt: now
  };

  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  persist();
  return next;
}

// ============================================================
//  编程题：代码草稿与提交记录
// ============================================================

const MAX_CODE_SUBMISSIONS = 300;
const MAX_CODE_LENGTH = 200000;

function codeDraftKey(questionId: string, lang: string): string {
  return String(questionId).slice(0, 80) + '::' + String(lang).slice(0, 20);
}

/** 保存代码草稿：按「题目 + 语言」各存一份，切题/重启都不丢 */
export function saveCodeDraft(userId: string, questionId: string, lang: string, code: string): CodeDraft {
  if (!findUserById(userId)) throw new Error('用户不存在');
  if (!db.codeDrafts[userId]) db.codeDrafts[userId] = {};
  const draft: CodeDraft = {
    questionId: String(questionId || '').slice(0, 80),
    lang: (lang as CodeDraft['lang']) || 'javascript',
    code: String(code == null ? '' : code).slice(0, MAX_CODE_LENGTH),
    updatedAt: Date.now()
  };
  db.codeDrafts[userId]![codeDraftKey(draft.questionId, draft.lang)] = draft;
  persist();
  return draft;
}

export function getCodeDraft(userId: string, questionId: string, lang: string): CodeDraft | null {
  const box = db.codeDrafts[userId];
  if (!box) return null;
  const hit = box[codeDraftKey(questionId, lang)];
  return hit ? (JSON.parse(JSON.stringify(hit)) as CodeDraft) : null;
}

export function listCodeSubmissions(userId: string, questionId?: string): CodeSubmission[] {
  const list = db.codeSubmissions[userId] || [];
  return (questionId ? list.filter((s) => s.questionId === questionId) : list).slice();
}

/** 记一次提交（只有「提交判题」会调用，运行样例不记） */
export function addCodeSubmission(userId: string, input: Partial<CodeSubmission>): CodeSubmission {
  if (!findUserById(userId)) throw new Error('用户不存在');
  if (!db.codeSubmissions[userId]) db.codeSubmissions[userId] = [];
  const list = db.codeSubmissions[userId]!;
  const now = Date.now();
  const sub: CodeSubmission = {
    id: 'sub_' + now + '_' + Math.random().toString(36).slice(2, 8),
    questionId: String(input.questionId || '').slice(0, 80),
    lang: (input.lang as CodeSubmission['lang']) || 'javascript',
    verdict: String(input.verdict || 'CE').slice(0, 8),
    passed: Math.max(0, Math.round(Number(input.passed) || 0)),
    total: Math.max(0, Math.round(Number(input.total) || 0)),
    timeMs: Math.max(0, Math.round(Number(input.timeMs) || 0)),
    createdAt: now
  };
  list.unshift(sub);
  if (list.length > MAX_CODE_SUBMISSIONS) list.length = MAX_CODE_SUBMISSIONS;
  persist();
  return sub;
}

// 测试专用：直接访问内部 db（仅测试断言用）
export function _dbForTest(): Readonly<DbShape> { return db; }
