'use strict';
// 诊断：管线里的 IMPORT_SAMPLE 经真实导入器解析后，竞赛/奖项与各项计数是什么
const path = require('path');
const importer = require(path.join(__dirname, '..', 'dist', 'main', 'resume-importer.js'));
const ref = importer.loadRefData(path.join(__dirname, '..', 'data'));

const IMPORT_SAMPLE = [
  '王小明',
  '手机：13900000000  邮箱：wxm@example.com',
  '求职意向：数据分析师',
  '教育经历',
  '2020.09-2024.06  某大学  统计学  本科',
  '实习经历',
  '2023.06-2023.09  某公司  数据分析实习生',
  '负责用户增长数据分析；搭建留存看板；把周报产出时间从 2 天降到半天',
  '项目经历',
  '2023.10-2024.03  校园消费行为分析  负责人',
  '清洗 12 万条问卷数据；用 Python 做聚类分群；产出 3 份结论报告',
  '奖项与证书',
  '全国大学生数学建模竞赛 省级二等奖 2024',
  '校级三好学生 2023'
].join('\n');

const p = importer.parseResumeText(IMPORT_SAMPLE, ref);
console.log('name =', p.name);
console.log('awards =', JSON.stringify(p.awards));
console.log('education =', (p.education || []).length, '| internships =', (p.internships || []).length, '| projects =', (p.projects || []).length);
console.log('skills =', JSON.stringify(p.skills));
console.log('notes =', JSON.stringify(p.notes));
