const fs = require('fs');
const path = require('path');

let dataDir = null;
let dbFile = null;

const db = {
  users: [],
  profiles: {},
  applications: {},
  sessions: {},
  settings: {}
};

function init(userDataPath) {
  dataDir = path.join(userDataPath, 'grad-resume-data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  dbFile = path.join(dataDir, 'db.json');
  load();
  sweepExpiredSessions();
}

// 批量清理过期会话：否则旧 token 只在恰好被访问时才清理，长期会无限累积
function sweepExpiredSessions() {
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

function load() {
  try {
    if (fs.existsSync(dbFile)) {
      const raw = fs.readFileSync(dbFile, 'utf-8');
      const parsed = JSON.parse(raw);
      db.users = parsed.users || [];
      db.profiles = parsed.profiles || {};
      db.applications = parsed.applications || {};
      db.sessions = parsed.sessions || {};
      db.settings = parsed.settings || {};
    }
  } catch (err) {
    // 数据损坏时不崩溃，退回空库并备份原文件
    try {
      if (fs.existsSync(dbFile)) {
        fs.renameSync(dbFile, dbFile + '.corrupt-' + Date.now());
      }
    } catch (_) {}
  }
}

function persist() {
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, dbFile);
}

function findUserByEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  return db.users.find((u) => u.email === key) || null;
}

function findUserById(id) {
  return db.users.find((u) => u.id === id) || null;
}

function addUser(user) {
  db.users.push(user);
  persist();
  return user;
}

function getProfile(userId) {
  return db.profiles[userId] || null;
}

function saveProfile(userId, profile) {
  if (!findUserById(userId)) throw new Error('用户不存在');
  const now = Date.now();
  const prev = db.profiles[userId] || {};
  db.profiles[userId] = {
    ...prev,
    ...profile,
    userId,
    updatedAt: now,
    createdAt: prev.createdAt || now
  };
  persist();
  return db.profiles[userId];
}

function listApplications(userId) {
  return db.applications[userId] || [];
}

function saveApplication(userId, application) {
  if (!db.applications[userId]) db.applications[userId] = [];
  const list = db.applications[userId];
  const now = Date.now();
  if (application.id) {
    const idx = list.findIndex((a) => a.id === application.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...application, updatedAt: now };
      persist();
      return list[idx];
    }
  }
  const created = {
    ...application,
    id: 'app_' + now + '_' + Math.random().toString(36).slice(2, 8),
    createdAt: now,
    updatedAt: now
  };
  list.unshift(created);
  persist();
  return created;
}

function deleteApplication(userId, appId) {
  const list = db.applications[userId] || [];
  db.applications[userId] = list.filter((a) => a.id !== appId);
  persist();
  return { removed: appId };
}

// ---------------- 会话（记住登录） ----------------
function createSession(token, userId, expiresAt) {
  db.sessions[token] = { userId, expiresAt, createdAt: Date.now() };
  persist();
  return token;
}

// 校验 token：有效则返回 userId，过期/无效则清理并返回 null
function getSessionUserId(token) {
  const s = db.sessions[token];
  if (!s) return null;
  if (s.expiresAt && s.expiresAt < Date.now()) {
    delete db.sessions[token];
    persist();
    return null;
  }
  return s.userId;
}

function clearSession(token) {
  if (db.sessions[token]) {
    delete db.sessions[token];
    persist();
  }
  return { removed: token };
}

// ---------------- 全局设置（跨用户，如 Agent 模型配置） ----------------
function getSetting(key) {
  return db.settings[key] != null ? db.settings[key] : null;
}

function setSetting(key, value) {
  db.settings[key] = value;
  persist();
  return value;
}

module.exports = {
  init,
  findUserByEmail,
  findUserById,
  addUser,
  getProfile,
  saveProfile,
  listApplications,
  saveApplication,
  deleteApplication,
  createSession,
  getSessionUserId,
  clearSession,
  getSetting,
  setSetting
};
