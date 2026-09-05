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

// 5) 计算机方向的强动词库（用于生成条目开头）
export const STRONG_VERBS: Readonly<Record<Domain, readonly string[]>> = {
  backend: ['设计', '实现', '优化', '重构', '搭建', '封装', '排查'],
  frontend: ['开发', '封装', '优化', '重构', '实现', '还原'],
  algorithm: ['设计', '实现', '优化', '训练', '调优', '验证'],
  data: ['构建', '清洗', '分析', '建模', '可视化', '挖掘'],
  llm: ['构建', '设计', '实现', '集成', '调优', '评测'],
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
  general: [
    '数据结构', '算法', 'git', 'linux', '操作系统', '计算机网络|网络',
    '数据库|database', '面向对象|oop', '设计模式', 'sql', 'python|java|c++'
  ]
};

export const __lex = { AI_CLICHES, AI_EN_WORDS, EMPTY_ADJECTIVES, WEAK_TO_STRONG, STRONG_VERBS, ROLE_SKILLS };
