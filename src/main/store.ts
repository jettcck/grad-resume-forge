'use strict';

// ============================================================
//  本地 JSON 存储（TypeScript 版）：原子写 + 会话清扫 + Agent 快照
// ============================================================

import fs from 'fs';
import path from 'path';
import type { StoredUser, PublicUser, Profile, Application, AgentSnapshot, AgentSnapshotMeta } from './types';

interface DbShape {
  users: StoredUser[];
  profiles: Record<string, Profile & { userId?: string; updatedAt?: number; createdAt?: number }>;
  applications: Record<string, Application[]>;
  sessions: Record<string, { userId: string; expiresAt: number; createdAt: number }>;
  settings: Record<string, unknown>;
  agentSnapshots: Record<string, AgentSnapshot[]>;
}

let dataDir: string | null = null;
let dbFile: string | null = null;

const db: DbShape = {
  users: [],
  profiles: {},
  applications: {},
  sessions: {},
  settings: {},
  agentSnapshots: {} // userId → 快照数组（最多 5 份，最新在前）
};

// 快照上限：防止无限膨胀（每份档案通常 < 10KB）
const MAX_SNAPSHOTS = 5;

export function init(userDataPath: string): void {
  dataDir = path.join(userDataPath, 'grad-resume-data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbFile = path.join(dataDir, 'db.json');
  load();
  sweepExpiredSessions();
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

// 测试专用：直接访问内部 db（仅测试断言用）
export function _dbForTest(): Readonly<DbShape> { return db; }
