const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  auth: {
    register: (payload) => ipcRenderer.invoke('auth:register', payload),
    login: (payload) => ipcRenderer.invoke('auth:login', payload),
    session: (token) => ipcRenderer.invoke('auth:session', token),
    logout: (token) => ipcRenderer.invoke('auth:logout', token)
  },
  profile: {
    get: (userId) => ipcRenderer.invoke('profile:get', userId),
    save: (userId, profile) => ipcRenderer.invoke('profile:save', userId, profile)
  },
  resume: {
    generate: (profile, options) => ipcRenderer.invoke('resume:generate', profile, options),
    audit: (text) => ipcRenderer.invoke('resume:audit', text),
    exportPdf: (html, suggestedName) => ipcRenderer.invoke('resume:exportPdf', html, suggestedName),
    matchJd: (resume, jdText) => ipcRenderer.invoke('resume:matchJd', resume, jdText),
    importResume: () => ipcRenderer.invoke('resume:importPdf')
  },
  applications: {
    list: (userId) => ipcRenderer.invoke('applications:list', userId),
    save: (userId, application) => ipcRenderer.invoke('applications:save', userId, application),
    remove: (userId, appId) => ipcRenderer.invoke('applications:delete', userId, appId)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text)
  },
  agent: {
    status: () => ipcRenderer.invoke('agent:status'),
    run: (profile, jdText, opts) => ipcRenderer.invoke('agent:run', profile, jdText, opts),
    // 订阅运行步骤进度；返回取消订阅函数
    onProgress: (cb) => {
      const handler = (_e, step) => cb(step);
      ipcRenderer.on('agent:progress', handler);
      return () => ipcRenderer.removeListener('agent:progress', handler);
    },
    // 订阅 LLM 流式分片（打字机效果）；返回取消订阅函数
    onStream: (cb) => {
      const handler = (_e, ev) => cb(ev);
      ipcRenderer.on('agent:stream', handler);
      return () => ipcRenderer.removeListener('agent:stream', handler);
    }
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    save: (key, value) => ipcRenderer.invoke('settings:save', key, value)
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    setMirror: (mirror) => ipcRenderer.invoke('updater:setMirror', mirror),
    // 订阅更新事件（checking/available/progress/downloaded/error）；返回取消订阅函数
    onEvent: (cb) => {
      const handler = (_e, ev) => cb(ev);
      ipcRenderer.on('updater:event', handler);
      return () => ipcRenderer.removeListener('updater:event', handler);
    }
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  }
});
