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
    importResume: () => ipcRenderer.invoke('resume:importPdf')
  },
  applications: {
    list: (userId: string) => ipcRenderer.invoke('applications:list', userId),
    save: (userId: string, application: unknown) => ipcRenderer.invoke('applications:save', userId, application),
    remove: (userId: string, appId: string) => ipcRenderer.invoke('applications:delete', userId, appId)
  },
  snapshots: {
    save: (userId: string, label: string, profile: unknown) => ipcRenderer.invoke('snapshots:save', userId, label, profile),
    list: (userId: string) => ipcRenderer.invoke('snapshots:list', userId),
    get: (userId: string, snapshotId: string) => ipcRenderer.invoke('snapshots:get', userId, snapshotId),
    restore: (userId: string, snapshotId: string) => ipcRenderer.invoke('snapshots:restore', userId, snapshotId),
    remove: (userId: string, snapshotId: string) => ipcRenderer.invoke('snapshots:delete', userId, snapshotId)
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text)
  },
  agent: {
    status: () => ipcRenderer.invoke('agent:status'),
    run: (profile: unknown, jdText: string, opts: unknown) => ipcRenderer.invoke('agent:run', profile, jdText, opts),
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
