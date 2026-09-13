'use strict';

// ============================================================
//  本地 JSON 存储（TypeScript 版）：原子写 + 会话清扫 + Agent 快照
// ============================================================

import fs from 'fs';
import path from 'path';
import type {
  StoredUser, PublicUser, Profile, Application, AgentSnapshot, AgentSnapshotMeta,
  ResumeVersion, ResumeVersionMeta
} from './types';

interface DbShape {
  users: StoredUser[];
  profiles: Record<string, Profile & { userId?: string; updatedAt?: number; createdAt?: number }>;
  applications: Record<string, Application[]>;
  sessions: Record<string, { userId: string; expiresAt: number; createdAt: number }>;
  settings: Record<string, unknown>;
  agentSnapshots: Record<string, AgentSnapshot[]>;
  resumeVersions: Record<string, ResumeVersion[]>;
}

let dataDir: string | null = null;
let dbFile: string | null = null;

const db: DbShape = {
  users: [],
  profiles: {},
  applications: {},
  sessions: {},
  settings: {},
  agentSnapshots: {}, // userId → 快照数组（最多 5 份，最新在前）
  resumeVersions: {}  // userId → 简历版本数组（最多 30 份，最新在前）
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

    const name = 'db-' + stamp(new Date()) + '.json';
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
    fs.writeFileSync(path.join(dir, 'db-' + stamp(new Date()) + '.json'), raw, 'utf-8');
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

function load(): void {
  try {
    if (dbFile && fs.existsSync(dbFile)) {
      const raw = fs.readFileSync(dbFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DbShape>;
      db.users = parsed.users || [];
      db.profiles = parsed.profiles || {};
      db.applications = parsed.applications || {};
      db.sessions = parsed.sessions || {};
      db.settings = parsed.settings || {};
      db.agentSnapshots = parsed.agentSnapshots || {};
      // 老库没有 resumeVersions 字段：缺省为空，向前兼容
      db.resumeVersions = parsed.resumeVersions || {};
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
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
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
  const s = db.sessions[token];
  if (!s) return null;
  if (s.expiresAt && s.expiresAt < Date.now()) {
    delete db.sessions[token];
    persist();
    return null;
  }
  return s.userId;
}

export { getSessionUserId as _getSessionUserId };

function clearSession(token: string): { removed: string } {
  if (db.sessions[token]) {
    delete db.sessions[token];
    persist();
  }
  return { removed: token };
}

export { clearSession as _clearSession };

// ---------------- 全局设置（跨用户，如 Agent 模型配置） ----------------
export function getSetting<T = unknown>(key: string): T | null {
  const v = db.settings[key];
  return v != null ? (v as T) : null;
}

export function setSetting<T>(key: string, value: T): T {
  (db.settings as Record<string, unknown>)[key] = value;
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

// 测试专用：直接访问内部 db（仅测试断言用）
export function _dbForTest(): Readonly<DbShape> { return db; }
