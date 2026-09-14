'use strict';

// Probe: does an imported resume (description as string[]) survive the resume page and the Agent apply path?
//   engine treats string[] as bullets; the renderer re-splits with String(text).
// Run: node scripts/probe-array-description.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const importer = require(path.join(ROOT, 'dist/main/resume-importer'));
const agent = require(path.join(ROOT, 'dist/main/agent'));

const SAMPLE = [
  '张三',
  '手机：13800000000  邮箱：zs@example.com',
  '求职意向：后端开发工程师',
  '教育经历',
  '2019.09-2023.06  浙江大学  计算机科学与技术  本科',
  '实习经历',
  '2022.06-2022.09  某科技公司  后端开发实习生',
  '负责订单服务的接口开发；参与数据库表结构设计；把慢查询从 2s 优化到 200ms',
  '项目经历',
  '2021.03-2021.12  校园二手交易平台  后端负责人',
  '使用 Java 和 MySQL 开发；实现了商品搜索功能；支撑了 500 名用户'
].join('\n');

(async () => {
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grf-imp-')), 'resume.txt');
  fs.writeFileSync(tmpFile, SAMPLE, 'utf8');
  const { parsed } = await importer.importFromFile(tmpFile, path.join(ROOT, 'data'));

  console.log('=== 1) 真实导入器产出的 description 类型 ===');
  ['projects', 'internships'].forEach((k) => {
    (parsed[k] || []).forEach((it, i) => {
      const d = it.description;
      console.log('  ' + k + '[' + i + '] = ' + (Array.isArray(d) ? 'string[' + d.length + '] ' + JSON.stringify(d) : typeof d + ' ' + JSON.stringify(d)));
    });
  });

  const profile = {
    name: '张三', targetRole: '后端开发工程师', city: '杭州', phone: '13800000000', email: 'zs@example.com',
    skills: 'Java, MySQL', summary: '',
    education: parsed.education || [],
    internships: parsed.internships || [],
    projects: parsed.projects || []
  };

  const jd = '岗位职责：负责后端服务开发。任职要求：熟悉 Java、MySQL、Redis、Docker，了解消息队列。';
  const res = await agent.runAgent(profile, jd, { rulesOnly: true });
  console.log('=== 2) 引擎跑一轮（零配置通道）===');
  console.log('  accepted ids = ' + res.accepted.map((r) => r.id).join(', '));

  // === 3) 渲染层当前的应用逻辑（从 app.js 原样复制）===
  const splitDescNow = (d) => String(d || '')
    .split(/\r?\n|；|;|。(?!\d)/).map((s) => s.trim()).filter(Boolean);
  // === 4) 与引擎 splitLines 对齐后的逻辑 ===
  const splitDescFixed = (d) => (Array.isArray(d)
    ? d.map((s) => String(s).trim()).filter(Boolean)
    : String(d || '').split(/\r?\n|；|;|。(?!\d)/).map((s) => s.trim()).filter(Boolean));

  const applyWith = (splitDesc) => {
    const byItem = {};
    res.accepted.forEach((r) => {
      const m = r.id.match(/^(p\d+|i\d+|summary)(?:-b(\d+))?$/);
      if (!m) return;
      (byItem[m[1]] = byItem[m[1]] || []).push({ bullet: Number(m[2] || 0), text: r.text });
    });
    const p = JSON.parse(JSON.stringify(profile));
    ['projects', 'internships'].forEach((kind) => {
      (p[kind] || []).forEach((it, i) => {
        const key = (kind === 'projects' ? 'p' : 'i') + i;
        const patched = byItem[key];
        if (!patched) return;
        const lines = splitDesc(it.description);
        patched.forEach((x) => { if (lines[x.bullet] != null) lines[x.bullet] = x.text; });
        it.description = lines.join('\n');
      });
    });
    return p;
  };

  const orig = profile.projects[0].description;
  const now = applyWith(splitDescNow);
  const fixed = applyWith(splitDescFixed);

  console.log('=== 3) 渲染层当前逻辑的结果 ===');
  console.log('  原始 ' + orig.length + ' 条: ' + JSON.stringify(orig));
  console.log('  之后: ' + JSON.stringify(now.projects[0].description));
  console.log('=== 4) 对齐引擎语义后的结果 ===');
  console.log('  之后: ' + JSON.stringify(fixed.projects[0].description));

  // === 5) 引擎自己认为的结果（applyRewrites）===
  const map = agent.applyRewrites(profile, res.accepted);
  console.log('=== 5) 引擎 applyRewrites 的结果（复测分数就是按它算的）===');
  console.log('  p0 = ' + JSON.stringify(map.p0));
})();
