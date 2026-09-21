'use strict';

// ============================================================
//  真实主进程 IPC 冒烟：加载 dist/main/main.js（真的 startElectron 那一套），
//  在渲染层里调真实的 window.api.*，验证：
//    1) 会话授权：拿别人的 userId 读不到别人的档案（主进程只认会话）
//    2) 未登录时数据接口一律拒绝
//    3) 密钥不回显：settings.get('agent') 只给 hasKey，没有 apiKey 明文
//    4) 主进程能正常启动、注册接口、加载窗口（改动 main.ts 后的兜底）
//  userData 指向临时目录，绝不碰真实数据。
//  运行：npx electron scripts/smoke-real-ipc.js --no-sandbox --disable-gpu
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-smoke-'));
app.setPath('userData', tmp);
app.commandLine.appendSwitch('no-sandbox');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, failCnt = 0;
const t = (cond, msg) => {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
};

// 加载真实主进程（它会自己 registerIpc + 建窗口）
require(path.join(__dirname, '..', 'dist', 'main', 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0] || null; if (!win) await sleep(250); }
  if (!win) { t(false, '主进程创建了窗口'); console.log('冒烟结束'); app.exit(1); return; }
  t(true, '主进程创建了窗口（main.ts 能正常启动）');
  try { await new Promise((r) => { if (!win.webContents.isLoading()) r(); else win.webContents.once('did-finish-load', r); }); } catch (_) { /* 忽略 */ }
  await sleep(2500);

  const before = await win.webContents.executeJavaScript(`(async () => {
    // 未登录：数据接口必须拒绝，而不是返回空数据装作正常
    const p = await window.api.profile.get('user_whatever');
    const s = await window.api.settings.get('agent');
    return { profileOk: p.ok, profileErr: p.error, settingsOk: s.ok, settingsErr: s.error };
  })()`);
  t(before.profileOk === false && /未登录|会话/.test(before.profileErr || ''), '未登录时档案接口被拒（' + before.profileErr + '）');
  t(before.settingsOk === false, '未登录时设置接口被拒（' + before.settingsErr + '）');

  const out = await win.webContents.executeJavaScript(`(async () => {
    const reg = await window.api.auth.register({ email: 'smoke@test.local', password: 'pass123456', name: '冒烟' });
    if (!reg.ok) return { error: reg.error };
    const me = reg.data;
    await window.api.profile.save(me.id, { name: '冒烟用户', targetRole: '后端', skills: 'Java' });
    // 关键：拿一个别的 id 去读，主进程必须只按会话返回「我自己的」档案
    const spoof = await window.api.profile.get('user_someone_else_999');
    // 保存一条带密钥的配置，再看读回来有没有明文
    const saved = await window.api.settings.save('agent', { provider: 'cloud', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-smoke-secret-123' });
    const back = await window.api.settings.get('agent');
    return {
      myId: me.id,
      spoofOk: spoof.ok,
      spoofName: spoof.data && spoof.data.name,
      savedHasKey: saved.data && saved.data.hasKey,
      savedApiKey: saved.data && saved.data.apiKey,
      backHasKey: back.data && back.data.hasKey,
      backApiKey: back.data && back.data.apiKey,
      backModel: back.data && back.data.model
    };
  })()`);

  if (out.error) {
    t(false, '注册冒烟账号失败：' + out.error);
  } else {
    t(out.spoofOk === true && out.spoofName === '冒烟用户',
      '用别人的 userId 读到的仍是自己的档案（防越权，实得：' + out.spoofName + '）');
    t(out.savedHasKey === true, '保存后返回 hasKey=true');
    t(!out.savedApiKey, '保存后不回显密钥明文（实得：' + JSON.stringify(out.savedApiKey) + '）');
    t(out.backHasKey === true && !out.backApiKey, '读取时不回显密钥明文，只给 hasKey');
    t(out.backModel === 'deepseek-chat', '非密钥字段照常回传（模型名）');

    // 落盘文件里不能出现明文密钥
    const dbFile = path.join(tmp, 'grad-resume-data', 'db.json');
    const raw = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf8') : '';
    t(raw.length > 0 && !raw.includes('sk-smoke-secret-123'), '密钥没有以明文写进数据文件');
    t(/enc:v1:|sk-smoke/.test(raw) === true, '数据文件里存的是（加密或至少非明文的）配置项');

    // ---------- 仅本次会话使用密钥（P3）----------
    // 勾了「不写入本机」时，密钥只留在主进程内存：数据文件里既没有明文、也没有对应密文。
    const sess = await win.webContents.executeJavaScript(`(async () => {
      const saved = await window.api.settings.save('agent', {
        provider: 'cloud', endpoint: 'http://127.0.0.1:9/v1', model: 'session-only-model',
        apiKey: 'sk-session-only-abc', apiKeySessionOnly: true
      });
      const back = await window.api.settings.get('agent');
      return {
        savedHasKey: saved.ok && saved.data ? saved.data.hasKey : null,
        savedSessionOnly: saved.ok && saved.data ? saved.data.sessionOnly : null,
        savedApiKey: saved.ok && saved.data ? saved.data.apiKey : 'ERR',
        backHasKey: back.ok && back.data ? back.data.hasKey : null,
        backSessionOnly: back.ok && back.data ? back.data.sessionOnly : null,
        backModel: back.ok && back.data ? back.data.model : null
      };
    })()`);
    t(sess.savedHasKey === true && sess.backHasKey === true, '会话密钥保存后 hasKey=true（可正常使用）');
    t(sess.savedSessionOnly === true && sess.backSessionOnly === true, '界面能看出这是「仅本次会话」的密钥');
    t(!sess.savedApiKey, '会话密钥同样不回显给渲染层');
    t(sess.backModel === 'session-only-model', '非密钥字段照常保存与回读');

    const dbFile2 = path.join(tmp, 'grad-resume-data', 'db.json');
    const raw2 = fs.existsSync(dbFile2) ? fs.readFileSync(dbFile2, 'utf8') : '';
    t(!raw2.includes('sk-session-only-abc'), '会话密钥没有明文写进数据文件');
    t(!/session-only-model[\s\S]{0,200}enc:v1:/.test(raw2), '切到「仅本次会话」后，磁盘上不再保留这条配置的密钥密文');
    t(/session-only-model/.test(raw2), '（对照）非密钥字段仍然落盘，便于下次打开弹窗');

    // 切回「保存到本机」：恢复持久化，会话里的临时密钥应被清掉
    const persist = await win.webContents.executeJavaScript(`(async () => {
      const saved = await window.api.settings.save('agent', {
        provider: 'cloud', endpoint: 'http://127.0.0.1:9/v1', model: 'persisted-model',
        apiKey: 'sk-persist-xyz', apiKeySessionOnly: false
      });
      return { hasKey: saved.ok && saved.data ? saved.data.hasKey : null, sessionOnly: saved.ok && saved.data ? saved.data.sessionOnly : null };
    })()`);
    t(persist.hasKey === true && persist.sessionOnly === false, '关闭该选项后回到「保存到本机」（sessionOnly=false）');
    const raw3 = fs.readFileSync(dbFile2, 'utf8');
    t(/enc:v1:/.test(raw3) && !raw3.includes('sk-persist-xyz'), '持久化模式下存的是密文，仍然没有明文');

    // ---------- 密钥边界与权限（评审 P1：1 / 2 / 3）----------
    // 1) agent:status 不能再把解密后的密钥带出来（此前直接回 client.config）
    const statusLeak = await win.webContents.executeJavaScript(`(async () => {
      const st = await window.api.agent.status();
      const cfg = st.ok && st.data ? st.data.config : null;
      const text = JSON.stringify(st);
      return {
        apiKey: cfg ? cfg.apiKey : 'NO_CFG',
        hasKey: cfg ? cfg.hasKey : null,
        hasPlain: text.includes('sk-A-secret') || text.includes('sk-persist-xyz')
      };
    })()`);
    t(statusLeak.apiKey === undefined, 'agent:status 的 config 里没有 apiKey 字段（实得：' + JSON.stringify(statusLeak.apiKey) + '）');
    t(statusLeak.hasPlain === false, 'agent:status 的整个返回里不含任何密钥明文');
    t(statusLeak.hasKey === true, '改为回传 hasKey=true，界面仍能显示「已保存」');

    // 2) 设置接口只接受白名单键
    const settingGuard = await win.webContents.executeJavaScript(`(async () => {
      const scoped = await window.api.settings.get('user_1787501007207_ca989c39:agent');
      const bad = await window.api.settings.get('__proto__');
      const badSave = await window.api.settings.save('evil-key', { x: 1 });
      const okGet = await window.api.settings.get('agent');
      const okSave = await window.api.settings.save('ghProxy', 'https://gh-proxy.com');
      return { scopedOk: scoped.ok, badOk: bad.ok, badSaveOk: badSave.ok, okGetOk: okGet.ok, okSaveOk: okSave.ok };
    })()`);
    t(settingGuard.scopedOk === false, '用 `userId:agent` 这类键读设置被拒（否则可绕过脱敏拿到未处理的值）');
    t(settingGuard.badOk === false && settingGuard.badSaveOk === false, '非白名单键的读写都被拒');
    t(settingGuard.okGetOk === true && settingGuard.okSaveOk === true, '白名单内的键（agent / ghProxy）照常可用');

    // 3) 全库备份接口需要登录（restore 会替换所有账号与会话）
    const backupGuard = await win.webContents.executeJavaScript(`(async () => {
      const before = await window.api.backups.list();
      await window.api.auth.logout(state.token);
      const listOut = await window.api.backups.list();
      const restoreOut = await window.api.backups.restore('db-20200101-000000000.json', true);
      const revealOut = await window.api.backups.reveal();
      const relogin = await window.api.auth.login({ email: 'smoke@test.local', password: 'pass123456' });
      return { beforeOk: before.ok, listOut: listOut.ok, restoreOut: restoreOut.ok, revealOut: revealOut.ok, reloginOk: relogin.ok };
    })()`);
    t(backupGuard.beforeOk === true, '登录状态下备份列表可用');
    t(backupGuard.listOut === false, '退出登录后备份列表被拒');
    t(backupGuard.restoreOut === false, '退出登录后「恢复整个库」被拒');
    t(backupGuard.revealOut === false, '退出登录后「打开备份目录」被拒');
    t(backupGuard.reloginOk === true, '重新登录成功（后续断言继续）');

    const restoreConfirm = await win.webContents.executeJavaScript(`(async () => {
      const r = await window.api.backups.restore('db-20200101-000000000.json');
      return { ok: r.ok, err: r.error };
    })()`);
    t(restoreConfirm.ok === false && /确认/.test(String(restoreConfirm.err)), '恢复备份必须显式确认（实得：' + restoreConfirm.err + '）');

    // ---------- 跨账号隔离（评审要求补的测试）----------
    // 1) 模型配置按账号读：A 存了自定义模型后，agent:status 必须回显 A 的配置。
    //    修复前这里读的是全局键，会回落到默认 Ollama —— 用户配了云端也用不上。
    const cfgA = await win.webContents.executeJavaScript(`(async () => {
      await window.api.settings.save('agent', { provider: 'cloud', endpoint: 'http://127.0.0.1:9/v1', model: 'account-A-model', apiKey: 'sk-A-secret', timeout: 300 });
      const st = await window.api.agent.status();
      return { model: st.ok && st.data && st.data.config ? st.data.config.model : null };
    })()`);
    t(cfgA.model === 'account-A-model',
      'agent:status 回显的是当前账号保存的模型配置（实得：' + JSON.stringify(cfgA.model) + '）');

    // 2) 运行记录按账号隔离：给 A 造一条记录，B 不该看到、也不该能取到或清掉
    const runsFileA = path.join(tmp, 'grad-resume-data', 'agent-runs-' + out.myId + '.jsonl');
    const fakeRec = {
      runId: 'run_ownerA', taskId: 'resume-optimize', status: 'COMPLETED', currentStep: 'completed',
      createdAt: Date.now(), startedAt: Date.now(), finishedAt: Date.now(), error: null, cancelReason: null,
      inputSnapshot: { itemCount: 1, sections: { projects: 1 }, jdLength: 10, jdDigest: 'aaaa1111:10', profileDigest: 'bbbb2222:20' },
      budget: { maxSteps: 10, maxToolCalls: 40, maxDurationMs: 180000, maxTokens: 120000 },
      usage: { steps: 1, toolCalls: 1, retries: 0, ms: 5, tokens: 0 }, trace: [], result: null
    };
    fs.mkdirSync(path.dirname(runsFileA), { recursive: true });
    fs.writeFileSync(runsFileA, JSON.stringify(fakeRec) + '\n', 'utf8');

    const iso = await win.webContents.executeJavaScript(`(async () => {
      const aRuns = await window.api.agent.runs(10);
      const b = await window.api.auth.register({ email: 'smoke-b@test.local', password: 'pass123456', name: '冒烟乙' });
      if (!b.ok) return { error: b.error };
      const bRuns = await window.api.agent.runs(10);
      const bGet = await window.api.agent.getRun('run_ownerA');
      const bCancel = await window.api.agent.cancel('run_ownerA');
      const bClear = await window.api.agent.clearRuns();
      const bStatus = await window.api.agent.status();
      // 回到 A：记录必须还在（B 的清理不能影响 A）
      const reloginA = await window.api.auth.login({ email: 'smoke@test.local', password: 'pass123456' });
      const aRunsAfter = await window.api.agent.runs(10);
      return {
        bId: b.data && b.data.id,
        aCount: aRuns.ok ? aRuns.data.length : -1,
        bCount: bRuns.ok ? bRuns.data.length : -1,
        bGetOk: bGet.ok,
        bCancelOk: bCancel.ok,
        bCleared: bClear.ok ? bClear.data.cleared : -1,
        bModel: bStatus.ok && bStatus.data && bStatus.data.config ? bStatus.data.config.model : null,
        aCountAfter: aRunsAfter.ok ? aRunsAfter.data.length : -1
      };
    })()`);

    if (iso.error) {
      t(false, '跨账号隔离测试失败：' + iso.error);
    } else {
      t(iso.aCount === 1, 'A 能看到自己的运行记录（' + iso.aCount + ' 条）');
      t(iso.bCount === 0, 'B 看不到 A 的运行记录（实得 ' + iso.bCount + ' 条）');
      t(iso.bGetOk === false, 'B 取不到 A 的运行详情（按 runId 直接取也不行）');
      t(iso.bCancelOk === false, 'B 不能取消 A 的运行');
      t(iso.bCleared === 0, 'B 的「清理运行记录」清不到 A 的记录（清除 ' + iso.bCleared + ' 条）');
      t(iso.aCountAfter === 1, 'B 清理后 A 的记录仍在（' + iso.aCountAfter + ' 条）');
      t(iso.bModel !== 'account-A-model', 'B 读不到 A 的模型配置（实得：' + JSON.stringify(iso.bModel) + '）');
    }
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  console.log('\n真实 IPC 冒烟完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
  app.exit(process.exitCode || 0);
}).catch((e) => {
  console.error('冒烟异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});
