'use strict';

// ============================================================
//  密钥安全存储：Electron safeStorage（Windows DPAPI / macOS Keychain）
//  密文落盘格式：'enc:v1:<base64>'；safeStorage 不可用时明文降级
//  （旧 Linux 无 keyring 环境），并向前兼容读旧明文配置。
// ============================================================

const { safeStorage } = require('electron');

const PREFIX = 'enc:v1:';

// 是否可用（DPAPI/Keychain 正常）
function isAvailable() {
  try {
    return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function'
      ? safeStorage.isEncryptionAvailable()
      : false;
  } catch (_) {
    return false;
  }
}

// 加密：不可用或空值原样返回
function encryptString(plain) {
  const s = String(plain == null ? '' : plain);
  if (!s) return s;
  if (!isAvailable()) return s;
  try {
    return PREFIX + safeStorage.encryptString(s).toString('base64');
  } catch (_) {
    return s; // 加密失败降级明文（不阻断保存）
  }
}

// 解密：识别 enc:v1: 前缀；旧明文直接透传（向前兼容）
function decryptString(stored) {
  const s = String(stored == null ? '' : stored);
  if (!s) return s;
  if (!s.startsWith(PREFIX)) return s; // 旧明文配置
  if (!isAvailable()) return ''; // 有密文但环境不可解密——返回空，UI 提示重填
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(PREFIX.length), 'base64'));
  } catch (_) {
    return '';
  }
}

function isEncrypted(s) {
  return String(s || '').startsWith(PREFIX);
}

module.exports = { isAvailable, encryptString, decryptString, isEncrypted };
