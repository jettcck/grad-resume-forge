'use strict';

// 固定输入与独立标注。技能表达命中只检查目标 p0-b0，避免改写别的项目冒充任务完成。
module.exports = [
  {
    id: 'backend-redis-source-v1', expectedSkill: 'redis', expectedSource: 'p0-tech', forbiddenSkills: ['docker', '容器化'],
    profile: { skills: 'Java', projects: [
      { name: '订单缓存', tech: 'Java、Redis', description: '负责缓存模块开发，响应从 800ms 降至 120ms' }
    ], internships: [] },
    jd: 'Java 后端开发，要求具备 Redis 缓存项目经验，保持实际指标。'
  },
  {
    id: 'frontend-vue-source-v1', expectedSkill: 'vue', expectedSource: 'p0-tech', forbiddenSkills: ['react'],
    profile: { skills: 'JavaScript', projects: [
      { name: '商城前端', tech: 'Vue、JavaScript', description: '完成商城页面开发，交付 5 个页面' }
    ], internships: [] },
    jd: '前端开发实习，要求具备 Vue 页面开发经验，不要增加没有做过的功能。'
  },
  {
    id: 'finance-excel-source-v1', expectedSkill: 'excel', expectedSource: 'p0-tech', forbiddenSkills: ['python'],
    profile: { skills: '财务基础', projects: [
      { name: '月度报表', tech: 'Excel', description: '负责月度报表整理，处理 2000 行数据' }
    ], internships: [] },
    jd: '财务实习，要求具备 Excel 报表处理经验，保留原始数据规模。'
  },
  {
    id: 'cross-project-docker-negative-v1', expectedSkill: null, expectedSource: null, forbiddenSkills: ['docker', '容器化'],
    profile: { skills: 'Java、Docker', projects: [
      { name: '订单接口', tech: 'Java', description: '开发订单接口，支撑 100QPS' },
      { name: '独立部署练习', tech: 'Docker', description: '使用 Docker 部署学习项目' }
    ], internships: [] },
    jd: '后端开发，需要 Docker 实践。请优化订单接口经历；独立部署练习属于另一个项目，不能移植到订单接口。'
  }
];
