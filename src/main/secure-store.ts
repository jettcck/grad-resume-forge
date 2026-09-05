'use strict';

// ============================================================
//  密钥安全存储：Electron safeStorage（Windows DPAPI / macOS Keychain）
//  密文落盘格式：'enc:v1:<base64>'；safeStorage 不可用时明文降级
//  （旧 Linux 无 keyring 环境），并向前兼容读旧明文配置。
// ============================================================

// 延迟 require：纯 Node 测试环境下 electron 模块无 safeStorage，
// 走类型收窄而非硬 import，避免加载期崩溃。
type SafeStorageLike = {
  isEncryptionAvailable?: () => boolean;
  encryptString?: (plain: string) => Buffer;
  decryptString?: (encrypted: Buffer) => string;
};

function getSafeStorage(): SafeStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { safeStorage?: SafeStorageLike };
    return electron.safeStorage || null;
  } catch (_) {
    return null;
  }
}

const PREFIX = 'enc:v1:';

// 是否可用（DPAPI/Keychain 正常）
export function isAvailable(): boolean {
  try {
    const ss = getSafeStorage();
    return !!(ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

// 加密：不可用或空值原样返回
export function encryptString(plain: unknown): string {
  const s = String(plain == null ? '' : plain);
  if (!s) return s;
  if (!isAvailable()) return s;
  const ss = getSafeStorage();
  if (!ss || !ss.encryptString) return s;
  try {
    return PREFIX + ss.encryptString(s).toString('base64');
  } catch (_) {
    return s; // 加密失败降级明文（不阻断保存）
  }
}

// 解密：识别 enc:v1: 前缀；旧明文直接透传（向前兼容）
export function decryptString(stored: unknown): string {
  const s = String(stored == null ? '' : stored);
  if (!s) return s;
  if (!s.startsWith(PREFIX)) return s; // 旧明文配置
  if (!isAvailable()) return ''; // 有密文但环境不可解密——返回空，UI 提示重填
  const ss = getSafeStorage();
  if (!ss || !ss.decryptString) return '';
  try {
    return ss.decryptString(Buffer.from(s.slice(PREFIX.length), 'base64'));
  } catch (_) {
    return '';
  }
}

export function isEncrypted(s: unknown): boolean {
  return String(s || '').startsWith(PREFIX);
}
