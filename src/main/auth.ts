'use strict';

// ============================================================
//  认证（TypeScript 版）：scrypt 加盐哈希 + 会话
// ============================================================

import crypto from 'crypto';
import * as store from './store';
import type { PublicUser, SessionInfo } from './types';

function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash: derived };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function publicUser(user: { id: string; email: string; name: string; createdAt: number }): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt
  };
}

// 会话有效期：30 天
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

// 生成会话 token 并落库
function issueSession(userId: string): SessionInfo {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL;
  store._createSession(token, userId, expiresAt);
  return { token, expiresAt };
}

export interface RegisterPayload { email?: string; password?: string; name?: string }
export interface LoginPayload { email?: string; password?: string }

export function register({ email, password, name }: RegisterPayload): PublicUser & SessionInfo {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!validateEmail(cleanEmail)) throw new Error('邮箱格式不正确');
  if (!password || password.length < 6) throw new Error('密码至少 6 位');
  if (store.findUserByEmail(cleanEmail)) throw new Error('该邮箱已注册，请直接登录');

  const { salt, hash } = hashPassword(password);
  const user = {
    id: 'user_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
    email: cleanEmail,
    name: (name && name.trim()) || cleanEmail.split('@')[0]!,
    salt,
    hash,
    createdAt: Date.now()
  };
  store._addUser(user);
  const session = issueSession(user.id);
  return { ...publicUser(user), ...session };
}

export function login({ email, password }: LoginPayload): PublicUser & SessionInfo {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = store.findUserByEmail(cleanEmail);
  if (!user) throw new Error('账号不存在，请先注册');
  if (!verifyPassword(password || '', user.salt, user.hash)) {
    throw new Error('密码错误');
  }
  const session = issueSession(user.id);
  return { ...publicUser(user), ...session };
}

// 用本地保存的 token 恢复登录态，无效返回 null
export function resumeSession(token: string | null | undefined): PublicUser | null {
  if (!token) return null;
  const userId = store._getSessionUserId(token);
  if (!userId) return null;
  const user = store.findUserById(userId);
  if (!user) {
    store._clearSession(token);
    return null;
  }
  return publicUser(user);
}

export function logout(token: string | null | undefined): { ok: true } {
  if (token) store._clearSession(token);
  return { ok: true };
}
