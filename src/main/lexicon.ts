// ============================================================
//  去 AI 味引擎词库（类型化）
//  思路：不用大模型生成套话，而是用「词库 + 改写规则 + 体检评分」
//  把用户真实经历，改写成动词开头、量化、简洁、无套话的强条目。
// ============================================================

import type { Domain } from './types';

// 1) AI 味 / 套话黑名单（中文空话、互联网黑话、翻译腔）
export const AI_CLICHES: readonly string[] = [
  '赋能', '抓手', '闭环', '打法', '组合拳', '颗粒度', '方法论', '底层逻辑',
  '顶层设计', '生态', '沉淀', '对齐', '拉通', '复盘', '心智', '护城河',
  '降本增效', '提质增效', '全链路', '强相关', '深度耦合', '高度契合',
  '致力于', '本人', '熟练掌握并精通', '积极主动', '认真负责', '吃苦耐劳',
  '团队合作精神', '沟通能力强', '学习能力强', '抗压能力强', '责任心强',
  '在……方面有深入的研究', '具备扎实的', '综合素质高', '德才兼备',
  '锐意进取', '开拓创新', '与时俱进', '一丝不苟', '任劳任怨'
];

// 2) 英文 AI 高频词（简历里出现即扣分，属于典型「GPT 腔」）
export const AI_EN_WORDS: readonly string[] = [
  'leverage', 'utilize', 'spearheaded', 'orchestrated', 'seamlessly',
  'robust', 'cutting-edge', 'state-of-the-art', 'synergy', 'holistic',
  'delve', 'furthermore', 'moreover', 'in today\'s fast-paced',
  'passionate about', 'dynamic', 'proven track record', 'game-changer'
];

// 3) 空洞形容词 / 副词 → 建议删除或用事实替代
export const EMPTY_ADJECTIVES: readonly string[] = [
  '优秀的', '出色的', '卓越的', '强大的', '高效的', '完善的', '丰富的',
  '深刻的', '广泛的', '全面的', '良好的', '扎实的',
  '优秀地', '出色地', '卓越地', '高效地', '完美地', '成功地', '顺利地',
  '深入地', '全面地', '良好地', '扎实地'
];

// 4) 弱动词 → 强动词映射（让条目更有行动力）
export const WEAK_TO_STRONG: Readonly<Record<string, string>> = {
  '负责': '主导',
  '参与': '承担',
  '做了': '完成',
  '进行了': '实施',
  '帮助': '推动',
  '用到了': '运用',
  '使用': '运用',
  '完成了一些': '交付',
  '处理': '解决'
};

// 5) 各方向强动词库（用于生成条目开头）
export const STRONG_VERBS: Readonly<Record<Domain, readonly string[]>> = {
  backend: ['设计', '实现', '优化', '重构', '搭建', '封装', '排查'],
  frontend: ['开发', '封装', '优化', '重构', '实现', '还原'],
  algorithm: ['设计', '实现', '优化', '训练', '调优', '验证'],
  data: ['构建', '清洗', '分析', '建模', '可视化', '挖掘'],
  llm: ['构建', '设计', '实现', '集成', '调优', '评测'],
  finance: ['编制', '核算', '梳理', '分析', '优化', '搭建', '完成', '审计'],
  marketing: ['策划', '运营', '产出', '搭建', '增长', '优化', '分析', '打造'],
  design: ['设计', '绘制', '制作', '打磨', '输出', '优化', '完成', '产出'],
  eng: ['设计', '调试', '加工', '编制', '排查', '优化', '验证', '测绘'],
  civil: ['编制', '测量', '施工', '完成', '复盘', '排查', '管理', '优化'],
  education: ['设计', '讲授', '开发', '组织', '辅导', '打磨', '总结', '批改'],
  medical: ['规范', '执行', '整理', '核查', '优化', '记录', '随访', '培训'],
  business: ['搭建', '梳理', '制定', '组织', '跟进', '维护', '优化', '推进'],
  general: ['设计', '实现', '优化', '主导', '搭建', '完成']
};

// 6) 岗位核心技能词库（按方向组织，用于「岗位匹配度」分析）
//    每一项是一个技能，多个别名用 | 分隔（命中任一即算掌握），展示时取第一个。
export const ROLE_SKILLS: Readonly<Record<Domain, readonly string[]>> = {
  backend: [
    'java', 'go|golang', 'spring|spring boot|springboot', 'mysql', 'redis',
    'kafka|rabbitmq|消息队列', '微服务', '分布式', 'docker|k8s|kubernetes',
    'linux', 'mybatis', '并发|多线程', 'jvm', 'rpc|grpc|dubbo', 'nginx', 'mongodb'
  ],
  frontend: [
    'javascript|js', 'typescript|ts', 'react', 'vue', 'css|scss|less',
    'html', 'webpack|vite', 'node|node.js|nodejs', 'http|ajax|fetch',
    '性能优化', '组件化|组件封装', 'redux|vuex|pinia|状态管理', 'es6', '响应式|移动端适配'
  ],
  algorithm: [
    'python', 'pytorch', 'tensorflow', '机器学习|machine learning|sklearn|scikit-learn',
    '深度学习|deep learning', 'cnn|rnn|lstm', 'transformer|bert',
    'nlp|自然语言处理', 'cv|计算机视觉|图像|opencv', '特征工程', '模型调优|调参',
    '数据结构', 'sql', '论文|paper'
  ],
  data: [
    'sql|mysql|postgres|postgresql|sqlite', 'python', 'spark', 'hadoop', 'hive', 'etl', '数据仓库|数仓',
    '数据可视化|可视化', 'pandas|numpy', 'flink', 'kafka', '数据分析',
    'bi|报表', '建模|数据建模'
  ],
  // 大模型 / Agent 应用方向：2024-2026 校招热门岗
  llm: [
    'python', 'llm|大模型|大语言模型', 'prompt|提示词|prompt engineering',
    'agent|智能体|function calling|工具调用',
    'rag|检索增强|知识库', 'langchain|llamaindex|dify|coze',
    '微调|fine-tuning|lora|sft', 'transformer|bert|gpt',
    '向量数据库|embedding|向量检索', 'api 集成|openai|ollama',
    '评测|evals', '流式输出|streaming', '多模态|multimodal',
    'huggingface', 'vllm|推理加速|量化'
  ],
  // ---- 全专业方向 ----
  finance: [
    'excel|office', '会计|会计核算', '财务报表|报表', '审计', '税务', '风控',
    'cpa|注册会计师|acca', '证券从业|基金从业|银行从业', '财务分析',
    'erp|用友|金蝶', '信贷', '估值|建模', 'sql|python', '银行'
  ],
  marketing: [
    '新媒体|公众号|抖音|小红书|视频号', '文案|内容创作', '活动策划|策划',
    '数据分析|excel', 'seo|sem|投放', '用户增长|增长', '私域|社群',
    '电商运营|淘宝|天猫', '品牌', '市场调研|调研', 'crm|用户运营',
    '短视频|直播', '竞品分析', 'kpi|roi|gmv'
  ],
  design: [
    'photoshop|ps', 'illustrator', 'figma|sketch|xd',
    'premiere|pr|ae|视频剪辑|剪映', 'indesign|排版',
    'c4d|blender|3d|三维', '手绘|插画', '品牌设计|vi|logo',
    'ux|用户体验|交互', '原型|原型设计', '网页设计|电商设计', '色彩|版式', 'cad'
  ],
  eng: [
    'cad|autocad', 'solidworks', 'ug|nx|creo|pro/e|proe', 'catia',
    '机械设计|机械制图', '工艺|工艺设计', '数控|cnc', '模具',
    '公差|gd&t', '有限元|ansys', '液压|气动', 'plc|电气', '自动化',
    '质量管理|qc', '汽车|车身', '设备|设备维护'
  ],
  civil: [
    'cad|autocad', 'bim|revit', '造价|广联达', '施工组织|施工方案',
    '测量|全站仪|测绘', '监理', 'pkpm|结构设计', '混凝土|钢筋|钢结构',
    '道路|桥梁|路基', '市政|管网', '安全员|安全交底', '概预算|工程预算'
  ],
  education: [
    '教师资格证|教资', '教案|教学设计', '课件|ppt', '班主任|班级管理',
    '试讲|说课|公开课', '普通话', '教育学|心理学', '课程开发|课程设计',
    '家校沟通|家长沟通', '学科知识|学科', 'mooc|慕课|在线教育', '教研'
  ],
  medical: [
    '执业医师|医师资格', '护士执业|护资', '临床|规培',
    '护理|护基', '药学|药理', '病历|病历书写', '三基', '院感',
    '急救|cpr|心肺复苏', '查房|值班', '医患沟通', 'gcp|cra|临床监查', '医疗器械'
  ],
  business: [
    '招聘|校招|社招', '薪酬|绩效', '六大模块|人力资源', '员工关系',
    '培训|培训体系', '行政|后勤', 'office|excel|ppt', '公文写作',
    '考勤|社保|公积金', 'kpi|okr', '劳动法|劳动合同', '组织架构|企业文化'
  ],
  // 通用兜底：跨行业可迁移能力（非计算机词表——任何专业的简历都能对上）
  general: [
    'office|excel|word|powerpoint|ppt', '英语|cet|四级|六级|雅思|托福',
    '沟通|沟通能力', '数据分析', '项目管理|项目协调', '写作|文案|公文写作',
    'photoshop|ps', '实习经验|实习', '领导力|学生干部', '学习能力',
    '执行力|执行', '活动策划|组织协调', '证书|职业资格'
  ]
};

export const __lex = { AI_CLICHES, AI_EN_WORDS, EMPTY_ADJECTIVES, WEAK_TO_STRONG, STRONG_VERBS, ROLE_SKILLS };
