'use strict';

// preload：渲染层唯一桥（TypeScript 版）
// 编译产物仍是 CommonJS，contextBridge 用法与 JS 版完全一致。

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // 环境标记（渲染进程继承主进程 env）：GRF_EMBEDDED_SELFTEST=1 时渲染层跑内嵌链路自检
  env: {
    embeddedSelfTest: process.env.GRF_EMBEDDED_SELFTEST === '1'
  },
  auth: {
    register: (payload: unknown) => ipcRenderer.invoke('auth:register', payload),
    login: (payload: unknown) => ipcRenderer.invoke('auth:login', payload),
    session: (token: string) => ipcRenderer.invoke('auth:session', token),
    logout: (token: string) => ipcRenderer.invoke('auth:logout', token)
  },
  profile: {
    get: (userId: string) => ipcRenderer.invoke('profile:get', userId),
    save: (userId: string, profile: unknown) => ipcRenderer.invoke('profile:save', userId, profile)
  },
  resume: {
    generate: (profile: unknown, options: unknown) => ipcRenderer.invoke('resume:generate', profile, options),
    audit: (text: string) => ipcRenderer.invoke('resume:audit', text),
    exportPdf: (html: string, suggestedName: string) => ipcRenderer.invoke('resume:exportPdf', html, suggestedName),
    matchJd: (resume: unknown, jdText: string) => ipcRenderer.invoke('resume:matchJd', resume, jdText),
    // 把勾选的改写写回档案：切分与回填由主进程引擎负责（渲染层不再自己实现一套）
    applyRewrites: (profile: unknown, accepted: unknown) => ipcRenderer.invoke('resume:applyRewrites', profile, accepted),
    importResume: () => ipcRenderer.invoke('resume:importPdf')
  },
  applications: {
    list: (userId: string) => ipcRenderer.invoke('applications:list', userId),
    save: (userId: string, application: unknown) => ipcRenderer.invoke('applications:save', userId, application),
    remove: (userId: string, appId: string) => ipcRenderer.invoke('applications:delete', userId, appId),
    importAuthorized: (userId: string, payload: unknown) => ipcRenderer.invoke('applications:importAuthorized', userId, payload)
  },
  // 岗位池：统一管理「正在考虑投什么」，数据只落本机 db.json（本地优先，无云端）
  jobs: {
    list: (userId: string) => ipcRenderer.invoke('jobs:list', userId),
    get: (userId: string, jobId: string) => ipcRenderer.invoke('jobs:get', userId, jobId),
    save: (userId: string, input: unknown) => ipcRenderer.invoke('jobs:save', userId, input),
    mark: (userId: string, jobId: string, patch: unknown) => ipcRenderer.invoke('jobs:mark', userId, jobId, patch),
    remove: (userId: string, jobId: string) => ipcRenderer.invoke('jobs:delete', userId, jobId)
  },
  // 笔试中心：题库、组卷、作答、错题本、学习计划（全部本地，题目随应用分发）
  exam: {
    bank: () => ipcRenderer.invoke('exam:bank'),
    createPaper: (input: unknown) => ipcRenderer.invoke('exam:paper:create', input),
    listPapers: () => ipcRenderer.invoke('exam:paper:list'),
    getPaper: (paperId: string) => ipcRenderer.invoke('exam:paper:get', paperId),
    startAttempt: (paperId: string) => ipcRenderer.invoke('exam:attempt:start', paperId),
    saveDraft: (attemptId: string, answers: unknown) => ipcRenderer.invoke('exam:attempt:save', attemptId, answers),
    submit: (attemptId: string, answers: unknown) => ipcRenderer.invoke('exam:attempt:submit', attemptId, answers),
    listAttempts: (paperId?: string) => ipcRenderer.invoke('exam:attempt:list', paperId),
    wrongs: () => ipcRenderer.invoke('exam:wrong:list'),
    masterWrong: (questionId: string, mastered: boolean) => ipcRenderer.invoke('exam:wrong:master', questionId, mastered),
    createReview: (count?: number) => ipcRenderer.invoke('exam:review:create', count),
    getPlan: (jobId?: string) => ipcRenderer.invoke('exam:plan:get', jobId),
    listPlans: () => ipcRenderer.invoke('exam:plan:list'),
    savePlan: (input: unknown) => ipcRenderer.invoke('exam:plan:save', input)
  },
  // 招聘平台投递记录同步：只读旁路，不向平台写入任何数据
  // collect 第三个参数 auto=true：点「抓取」即自动开窗口、自动走到记录页抓取
  jobSync: {
    platforms: () => ipcRenderer.invoke('jobsync:platforms'),
    open: (platformId: string) => ipcRenderer.invoke('jobsync:open', platformId),
    collect: (platformId: string, kind: string, auto?: boolean) =>
      ipcRenderer.invoke('jobsync:collect', platformId, kind, auto === true),
    reset: (platformId: string) => ipcRenderer.invoke('jobsync:reset', platformId),
    close: (platformId: string) => ipcRenderer.invoke('jobsync:close', platformId),
    logout: (platformId: string) => ipcRenderer.invoke('jobsync:logout', platformId),
    // 抓取进度实时推送（自动抓取可能跑一两分钟，界面必须能显示卡在哪一步）
    onProgress: (cb: (payload: { platformId: string; note: string; captured: number; auto: boolean }) => void) => {
      const listener = (_e: unknown, payload: { platformId: string; note: string; captured: number; auto: boolean }): void => cb(payload);
      ipcRenderer.on('jobsync:progress', listener);
      return () => { ipcRenderer.removeListener('jobsync:progress', listener); };
    }
  },
  snapshots: {
    save: (userId: string, label: string, profile: unknown) => ipcRenderer.invoke('snapshots:save', userId, label, profile),
    list: (userId: string) => ipcRenderer.invoke('snapshots:list', userId),
    get: (userId: string, snapshotId: string) => ipcRenderer.invoke('snapshots:get', userId, snapshotId),
    restore: (userId: string, snapshotId: string) => ipcRenderer.invoke('snapshots:restore', userId, snapshotId),
    remove: (userId: string, snapshotId: string) => ipcRenderer.invoke('snapshots:delete', userId, snapshotId)
  },
  // 简历版本（多版本：一个岗位一版，长期保留的定制稿）
  versions: {
    list: (userId: string) => ipcRenderer.invoke('versions:list', userId),
    get: (userId: string, versionId: string) => ipcRenderer.invoke('versions:get', userId, versionId),
    save: (userId: string, input: unknown) => ipcRenderer.invoke('versions:save', userId, input),
    rename: (userId: string, versionId: string, name: string, note?: string) =>
      ipcRenderer.invoke('versions:rename', userId, versionId, name, note),
    remove: (userId: string, versionId: string) => ipcRenderer.invoke('versions:delete', userId, versionId)
  },
  // 数据备份：启动时自动轮转留档（保留最近 5 份），可一键恢复或打开备份目录
  backups: {
    list: () => ipcRenderer.invoke('backups:list'),
    // 恢复整库：主进程要求显式 confirm；界面上已有一层确认弹窗，这里把「用户已确认」传过去
    restore: (name: string, confirm?: boolean) => ipcRenderer.invoke('backups:restore', name, confirm === true),
    reveal: () => ipcRenderer.invoke('backups:reveal')
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text)
  },
  agent: {
    status: () => ipcRenderer.invoke('agent:status'),
    run: (profile: unknown, jdText: string, opts: unknown) => ipcRenderer.invoke('agent:run', profile, jdText, opts),
    // 运行控制与复盘（第二阶段）：取消 / 记录列表 / 单条明细 / 清理 / 回放
    cancel: (runId: string) => ipcRenderer.invoke('agent:cancel', runId),
    runs: (limit?: number) => ipcRenderer.invoke('agent:runs', limit),
    getRun: (runId: string) => ipcRenderer.invoke('agent:run:get', runId),
    clearRuns: () => ipcRenderer.invoke('agent:clearRuns'),
    // force=true 表示「明知输入与记录不是同一份，仍要强行回放」（界面会先确认）
    replay: (runId: string, profile: unknown, jdText: string, force?: boolean) =>
      ipcRenderer.invoke('agent:replay', runId, profile, jdText, force === true),
    // 探测本机已有的本地模型服务（只在 127.0.0.1 上短超时并发探测）
    detectLocal: () => ipcRenderer.invoke('agent:detectLocal'),
    onProgress: (cb: (step: unknown) => void) => {
      const handler = (_e: unknown, step: unknown) => cb(step);
      ipcRenderer.on('agent:progress', handler as never);
      return () => ipcRenderer.removeListener('agent:progress', handler as never);
    },
    onStream: (cb: (ev: unknown) => void) => {
      const handler = (_e: unknown, ev: unknown) => cb(ev);
      ipcRenderer.on('agent:stream', handler as never);
      return () => ipcRenderer.removeListener('agent:stream', handler as never);
    }
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    save: (key: string, value: unknown) => ipcRenderer.invoke('settings:save', key, value)
  },
  // 系统加密可用性：不可用时密钥会明文落盘，界面必须先告知用户
  secure: {
    status: () => ipcRenderer.invoke('secure:status')
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    setMirror: (mirror: string) => ipcRenderer.invoke('updater:setMirror', mirror),
    onEvent: (cb: (ev: unknown) => void) => {
      const handler = (_e: unknown, ev: unknown) => cb(ev);
      ipcRenderer.on('updater:event', handler as never);
      return () => ipcRenderer.removeListener('updater:event', handler as never);
    }
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
  },
  assistant: {
    ask: (query: string, domainHint?: string) => ipcRenderer.invoke('assistant:ask', query, domainHint),
    hot: () => ipcRenderer.invoke('assistant:hot')
  },
  interview: {
    // 面试准备（全本地、零模型）：自我介绍生成 + 方向化题库 + 开放题模板 + 反问清单
    prep: (profile: unknown, opts?: unknown) => ipcRenderer.invoke('interview:prep', profile, opts)
  },
  map: {
    // 可用瓦片源（内置 + 是否已配自定义）。模板里可能带用户自己的 key，所以主进程不回传模板
    sources: () => ipcRenderer.invoke('map:sources'),    // 取一块瓦片：主进程负责联网 + SSRF 校验 + 磁盘缓存，回传 data: URL（因此 CSP 无需放宽）
    tile: (sourceId: string, z: number, x: number, y: number) =>
      ipcRenderer.invoke('map:tile', sourceId, z, x, y),
    cacheStats: () => ipcRenderer.invoke('map:cacheStats'),
    clearCache: () => ipcRenderer.invoke('map:clearCache'),
    // 保存自定义瓦片源（https + 非内网）；传空 url 表示清除
    setCustomSource: (name: string, url: string, datum: string) =>
      ipcRenderer.invoke('map:setCustomSource', name, url, datum)
  },
  embedded: {
    // 渲染进程 → 主进程：报告 WebGPU/模型就绪状态（主进程据此决定 agent:status）
    reportStatus: (st: { webgpu: boolean; ready: boolean }) =>
      ipcRenderer.send('embedded:status', st),
    // 主进程 → 渲染进程：代理推理请求（Agent embedded 通道）
    onRequest: (cb: (req: { id: string; messages: Array<{ role: string; content: string }> }) => void) => {
      const handler = (_e: unknown, req: { id: string; messages: Array<{ role: string; content: string }> }) => cb(req);
      ipcRenderer.on('embedded:req', handler as never);
      return () => ipcRenderer.removeListener('embedded:req', handler as never);
    },
    // 渲染进程 → 主进程：回传推理结果
    respond: (id: string, result: { content?: string; error?: string }) =>
      ipcRenderer.send('embedded:res', { id, ...result })
  }
});
