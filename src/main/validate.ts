'use strict';

// 输入校验：IPC 参数只靠 TypeScript 类型是纸糊的（运行时没人检查），
// 异常大的文本会让数据文件膨胀、界面卡顿、模型请求超限。这里统一做「够用就好」的校验：
// 不追求严格 schema，只挡住明显不合理的东西，并把错误说清楚。
export const LIMITS = {
  profileJson: 200 * 1024,   // 整个档案（含多段经历）200KB 足够
  jdText: 20 * 1024,         // 职位描述 20KB（正常 JD 2-5KB）
  notes: 2 * 1024,           // 投递备注
  label: 200,                // 快照/版本名称
  settingJson: 200 * 1024,   // 设置项（含加密后的密钥）
  exportHtml: 5 * 1024 * 1024, // 导出用的 HTML（含内联样式）
  importFile: 20 * 1024 * 1024 // 导入的简历文件 20MB
};

export function sizeOf(value: unknown): number {
  try {
    if (value == null) return 0;
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch (_) {
    return Number.MAX_SAFE_INTEGER; // 序列化都失败的东西一律当作超大，直接拒绝
  }
}

export function assertSize(value: unknown, limit: number, label: string): void {
  const n = sizeOf(value);
  if (n > limit) {
    throw new Error(label + '过大（' + Math.round(n / 1024) + 'KB，上限 ' + Math.round(limit / 1024) + 'KB）——请精简后再试');
  }
}

// 只接受普通对象，避免数组/字符串冒充结构化数据导致后续读写异常
export function assertPlainObject(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + '格式不正确');
  }
}
