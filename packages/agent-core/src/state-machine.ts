'use strict';

// 状态机：把「一次 Agent 运行」的推进过程显式化。
// 以前流程藏在 for 循环里，无法回答「现在跑到哪一步、能不能取消、失败停在哪」。
// 这里用一张允许转移表约束状态，非法转移直接抛错（而不是悄悄走到奇怪的状态）。
import { RunStatus, TERMINAL_STATUSES, Budget } from './types';

const ALLOWED: Record<RunStatus, ReadonlyArray<RunStatus>> = {
  CREATED: ['ANALYZING_JD', 'PLANNING', 'FAILED', 'CANCELLED'],
  ANALYZING_JD: ['PLANNING', 'EXECUTING_TOOLS', 'FAILED', 'CANCELLED'],
  PLANNING: ['EXECUTING_TOOLS', 'FAILED', 'CANCELLED'],
  EXECUTING_TOOLS: ['EXECUTING_TOOLS', 'VALIDATING', 'CRITIC_REVIEW', 'WAITING_HUMAN_APPROVAL', 'FAILED', 'CANCELLED'],
  VALIDATING: ['EXECUTING_TOOLS', 'CRITIC_REVIEW', 'WAITING_HUMAN_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'],
  CRITIC_REVIEW: ['EXECUTING_TOOLS', 'WAITING_HUMAN_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING_HUMAN_APPROVAL: ['EXECUTING_TOOLS', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: []
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return (ALLOWED[from] || []).includes(to);
  return (ALLOWED[from] || []).includes(to);
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error('非法状态转移：' + from + ' → ' + to);
  }
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export class RunStateMachine {
  readonly runId: string;
  readonly taskId: string;
  readonly budget: Budget;
  status: RunStatus = 'CREATED';
  currentStep = 'created';
  private history: Array<{ at: number; from: RunStatus; to: RunStatus; note?: string }> = [];

  constructor(runId: string, taskId: string, budget: Budget) {
    this.runId = runId;
    this.taskId = taskId;
    this.budget = budget;
  }

  transition(to: RunStatus, note?: string, at?: number): void {
    assertTransition(this.status, to);
    this.history.push({ at: at == null ? Date.now() : at, from: this.status, to, note });
    this.status = to;
    this.currentStep = note || to.toLowerCase();
  }

  isTerminal(): boolean {
    return isTerminal(this.status);
  }

  /** 把状态推进到终态（已终态则不动，避免覆盖 CANCELLED/FAILED） */
  settle(to: RunStatus, note?: string, at?: number): void {
    if (this.isTerminal()) return;
    if (!canTransition(this.status, to)) {
      // 从任意非终态都能收尾：这里放宽为「直接落到终态」，但仍记录历史
      this.history.push({ at: at == null ? Date.now() : at, from: this.status, to, note });
      this.status = to;
      this.currentStep = note || to.toLowerCase();
      return;
    }
    this.transition(to, note, at);
  }

  transitions(): ReadonlyArray<{ at: number; from: RunStatus; to: RunStatus; note?: string }> {
    return this.history.slice();
  }
}
