'use strict';

// agent-core：可控 Agent Runtime
//   - 状态机（run 生命周期显式化）
//   - 工具注册层（运行时校验 / 超时 / 幂等重试 / 权限 / 预算）
//   - 运行记录与 trace（脱敏、可清理、可回放）
//   - 预算（步数 / 工具调用 / 时长 / token）
// 这一层不依赖 Electron，也不认识简历业务：业务由 RuntimeAdapter 注入。
export * from './types';
export * from './state-machine';
export * from './tools';
export * from './run-store';
export * from './runtime';
