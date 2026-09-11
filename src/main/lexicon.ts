// ============================================================
//  去 AI 味引擎词库（类型化）
//  思路：不用大模型生成套话，而是用「词库 + 改写规则 + 体检评分」
//  把用户真实经历，改写成动词开头、量化、简洁、无套话的强条目。
// ============================================================

import type { Domain } from './types';

// 1a) 硬套话：纯黑话 / 美德词——删掉一定不损失信息（改写时直接删）
export const AI_CLICHES: readonly string[] = [
  // 互联网黑话
  '赋能', '抓手', '组合拳', '颗粒度', '打法', '护城河', '顶层设计',
  '降本增效', '提质增效', '全链路', '强相关', '深度融合', '深度耦合', '高度契合',
  '多维度', '全方位', '立体化', '以终为始', '价值闭环', '协同增效',
  '方法论', '底层逻辑', '心智',
  // 翻译腔连接词 / 空转前缀
  '致力于', '旨在', '以期', '本人', '在此过程中', '通过本次实习', '通过这次实习',
  // 美德词（自我评价空话）
  '积极主动', '认真负责', '吃苦耐劳', '团队合作精神', '沟通能力强', '学习能力强',
  '抗压能力强', '责任心强', '综合素质高', '德才兼备', '锐意进取', '开拓创新',
  '与时俱进', '一丝不苟', '任劳任怨', '为人诚恳', '待人真诚', '性格开朗',
  '乐观向上', '勤奋好学', '脚踏实地', '兢兢业业', '恪尽职守', '勤勉尽责',
  // 空转搭配
  '熟练掌握并精通', '在……方面有深入的研究', '具备扎实的', '具备较强的',
  '拥有良好的', '有着丰富的', '获得了宝贵的', '积累了宝贵的',
  '高度的', '极高的', '较强的'
];

// 1b) 软套话：既可能是 AI 腔，也可能是真实术语（数据对齐 / 复盘会议 /
//     闭环控制 / 技术生态），自动删除会破坏语义——只在体检里标记，交给用户判断
export const AI_CLICHES_SOFT: readonly string[] = [
  '对齐', '沉淀', '复盘', '闭环', '生态'
];

// 2) 英文 AI 高频词（简历里出现即扣分，属于典型「GPT 腔」）
export const AI_EN_WORDS: readonly string[] = [
  'leverage', 'utilize', 'spearheaded', 'orchestrated', 'seamlessly',
  'robust', 'cutting-edge', 'state-of-the-art', 'synergy', 'holistic',
  'delve', 'furthermore', 'moreover', 'in today\'s fast-paced',
  'passionate about', 'dynamic', 'proven track record', 'game-changer',
  'seamless', 'pivotal', 'meticulous', 'underscore', 'showcase',
  'adept', 'tapestry', 'realm', 'testament to', 'navigate the',
  'results-driven', 'detail-oriented', 'think outside the box', 'go-to person'
];

// 3) 空洞形容词 / 副词 → 删除（但下接「有实义的中心词」时保留，见 EMPTY_ADJ_KEEP_HEADS）
export const EMPTY_ADJECTIVES: readonly string[] = [
  '优秀的', '出色的', '卓越的', '强大的', '高效的', '完善的', '丰富的',
  '深刻的', '广泛的', '全面的', '良好的', '扎实的',
  '优秀地', '出色地', '卓越地', '高效地', '完美地', '成功地', '顺利地',
  '深入地', '全面地', '良好地', '扎实地'
];

// 3b) 形容词保义中心词：这些名词前的形容词承载真实评价（客户关系好不好、
//     业绩高不高、经验多不多），删掉会让语义反而变弱——
//     例：「建立了良好的客户关系」不能变成「建立了客户关系」
export const EMPTY_ADJ_KEEP_HEADS: readonly string[] = [
  '客户关系', '合作关系', '客户', '关系', '口碑', '业绩', '成果', '效益', '收益',
  '信用', '记录', '经验', '履历', '作品', '案例', '渠道', '资源', '人脉',
  '反馈', '评价', '体验', '数据', '指标', '体系', '流程', '机制', '规范', '预案',
  '台账', '凭证', '底稿', '报表', '样品', '图集', '教案', '课件', '病历', '护理记录',
  '习惯', '态度', '氛围', '环境', '条件', '设备', '工具'
];

// 3c) 动词开头判定的兜底首字（词库未覆盖、但用户常在简历里写的动词）
export const EXTRA_VERB_START_CHARS = '独领攻带';

// 3d) JD 权重标记：判断一项技能是「硬性要求」还是「加分项」
export const JD_REQUIRED_MARKERS: readonly string[] = [
  '必须', '要求', '精通', '熟练', '熟悉', '掌握', '必备', '硬性', '至少', '优先考虑'
];
export const JD_NICE_MARKERS: readonly string[] = [
  '加分', '优先', '更佳', '了解', '可选', 'nice to have', 'plus', '有则更好'
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
  '处理': '解决',
  '用': '运用'
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
//    别名里刻意收录 JD 常见「换说法」表述（如「缓存中间件」「容器化」「数据管道」），
//    缓解纯字符串匹配漏判——但语义级判断仍需 LLM 通道，见 README「能力边界」。
export const ROLE_SKILLS: Readonly<Record<Domain, readonly string[]>> = {
  backend: [
    'java', 'go|golang', 'spring|spring boot|springboot|spring mvc|ssm', 'mysql|关系型数据库|数据库设计',
    'redis|缓存|缓存中间件', 'kafka|rabbitmq|消息队列|mq', '微服务|服务化|服务拆分|服务治理',
    '分布式|分布式系统|高可用|集群', 'docker|k8s|kubernetes|容器化|容器编排',
    'linux|shell|服务器运维', 'mybatis|orm', '并发|多线程|高并发|线程池', 'jvm|java 虚拟机|gc 调优',
    'rpc|grpc|dubbo|远程调用', 'nginx|反向代理|负载均衡', 'mongodb|nosql', '接口设计|restful|api 设计'
  ],
  frontend: [
    'javascript|js|es6', 'typescript|ts', 'react|react.js', 'vue|vue.js|vue3', 'css|scss|less|样式',
    'html|h5', 'webpack|vite|构建工具', 'node|node.js|nodejs', 'http|ajax|fetch|接口联调',
    '性能优化|页面性能|加载优化|首屏优化', '组件化|组件封装|组件库', 'redux|vuex|pinia|状态管理',
    'es6', '响应式|移动端适配|h5 适配|自适应', '小程序|uniapp|跨端'
  ],
  algorithm: [
    'python', 'pytorch', 'tensorflow', '机器学习|machine learning|sklearn|scikit-learn|传统模型',
    '深度学习|deep learning|神经网络', 'cnn|rnn|lstm|卷积', 'transformer|bert|注意力机制',
    'nlp|自然语言处理|文本分类|文本挖掘|文本处理', 'cv|计算机视觉|图像|opencv', '特征工程|特征提取|特征选择',
    '模型调优|调参|超参|模型优化', '数据结构|算法基础', 'sql', '论文|paper|顶会'
  ],
  data: [
    'sql|mysql|postgres|postgresql|sqlite', 'python', 'spark|离线计算', 'hadoop', 'hive',
    'etl|数据管道|数据同步|数据集成', '数据仓库|数仓|ods|dwd|分层建模',
    '数据可视化|可视化|报表开发|看板', 'pandas|numpy', 'flink|实时计算|流处理',
    'kafka', '数据分析|业务分析|指标分析', 'bi|报表|powerbi|tableau', '建模|数据建模|指标体系'
  ],
  // 大模型 / Agent 应用方向：2024-2026 校招热门岗
  llm: [
    'python', 'llm|大模型|大语言模型|基座模型', 'prompt|提示词|prompt engineering|指令设计',
    'agent|智能体|function calling|工具调用|多智能体',
    'rag|检索增强|知识库问答|检索增强生成', 'langchain|llamaindex|dify|coze|应用框架',
    '微调|fine-tuning|lora|sft|指令微调', 'transformer|bert|gpt|注意力',
    '向量数据库|embedding|向量检索|语义检索', 'api 集成|openai|ollama|模型接入',
    '评测|evals|模型评估|效果评估', '流式输出|streaming|逐字输出', '多模态|multimodal|图文',
    'huggingface', 'vllm|推理加速|量化|部署'
  ],
  // ---- 全专业方向 ----
  finance: [
    'excel|office|表格处理', '会计|会计核算|记账|账务处理', '财务报表|报表|三大报表|报表编制',
    '审计|审计底稿|抽凭', '税务|报税|纳税申报', '风控|风险控制|内控',
    'cpa|注册会计师|acca', '证券从业|基金从业|银行从业|从业资格', '财务分析|财务测算|成本分析',
    'erp|用友|金蝶|sap', '信贷|授信|贷后', '估值|建模|dcf', 'sql', 'python', '银行|柜面|对公业务'
  ],
  marketing: [
    '新媒体|公众号|抖音|小红书|视频号|社媒', '文案|内容创作|内容运营|选题',
    '活动策划|策划|活动执行|落地执行', '数据分析|excel|数据复盘|投放数据',
    'seo|sem|投放|信息流|竞价', '用户增长|增长|拉新|留存', '私域|社群|用户运营|会员',
    '电商运营|淘宝|天猫|店铺运营', '品牌|品牌传播|pr', '市场调研|调研|竞品分析',
    'crm|客户管理', '短视频|直播|达人合作', 'kpi|roi|gmv|转化率'
  ],
  design: [
    'photoshop|ps|修图|图像处理', 'illustrator|ai 绘图|矢量',
    'figma|sketch|xd|交互稿|设计稿', 'premiere|pr|ae|视频剪辑|剪映',
    'indesign|排版|版式', 'c4d|blender|3d|三维|建模渲染', '手绘|插画|原画',
    '品牌设计|vi|logo|视觉识别', 'ux|用户体验|交互|交互设计|可用性',
    '原型|原型设计|线框图', '网页设计|电商设计|详情页', '色彩|配色|字体', 'cad'
  ],
  eng: [
    'cad|autocad|二维制图', 'solidworks', 'ug|nx|creo|pro/e|proe', 'catia',
    '机械设计|机械制图|图纸|零件图', '工艺|工艺设计|工艺流程|工艺卡', '数控|cnc|加工中心',
    '模具|注塑|冲压', '公差|gd&t|形位公差', '有限元|ansys|仿真', '液压|气动|传动',
    'plc|电气|自动化控制', '质量管理|qc|质检|品控', '汽车|车身|整车', '设备|设备维护|点检'
  ],
  civil: [
    'cad|autocad|制图', 'bim|revit|建模', '造价|广联达|预算|决算',
    '施工组织|施工方案|施工技术', '测量|全站仪|测绘|放线', '监理|现场管理|旁站',
    'pkpm|结构设计|承载力', '混凝土|钢筋|钢结构', '道路|桥梁|路基|隧道',
    '市政|管网|给排水', '安全员|安全交底|安全管理', '概预算|工程预算|清单计价'
  ],
  education: [
    '教师资格证|教资', '教案|教学设计|备课|学案', '课件|ppt|多媒体课件',
    '班主任|班级管理|学生管理', '试讲|说课|公开课|授课', '普通话|二甲',
    '教育学|心理学|教育理论', '课程开发|课程设计|校本课程',
    '家校沟通|家长沟通|家访', '学科知识|学科|教学能力', 'mooc|慕课|在线教育|混合式教学', '教研|集体备课'
  ],
  medical: [
    '执业医师|医师资格', '护士执业|护资', '临床|规培|轮转',
    '护理|护基|基础护理|护理操作', '药学|药理|用药指导', '病历|病历书写|病程记录',
    '三基|三基考核', '院感|感染控制|消毒隔离', '急救|cpr|心肺复苏|抢救',
    '查房|值班|交接班', '医患沟通|护患沟通', 'gcp|cra|临床监查', '医疗器械'
  ],
  business: [
    '招聘|校招|社招|招聘渠道', '薪酬|绩效|绩效考核|薪酬核算', '六大模块|人力资源|hr',
    '员工关系|劳动关系|入离职', '培训|培训体系|员工培训', '行政|后勤|办公用品',
    'office|excel|ppt|办公软件', '公文写作|通知|会议纪要', '考勤|社保|公积金',
    'kpi|okr|目标管理', '劳动法|劳动合同|合规', '组织架构|企业文化|团建'
  ],
  // 通用兜底：跨行业可迁移能力（非计算机词表——任何专业的简历都能对上）
  general: [
    'office|excel|word|powerpoint|ppt|办公软件', '英语|cet|四级|六级|雅思|托福',
    '沟通|沟通能力|跨部门协作', '数据分析|数据整理',
    '项目管理|项目协调|进度管理', '写作|文案|公文写作|报告撰写',
    'photoshop|ps', '实习经验|实习', '领导力|学生干部|社团',
    '学习能力|快速学习', '执行力|执行|落地', '活动策划|组织协调|会务',
    '证书|职业资格|资格证'
  ]
};

export const __lex = {
  AI_CLICHES, AI_CLICHES_SOFT, AI_EN_WORDS, EMPTY_ADJECTIVES, EMPTY_ADJ_KEEP_HEADS,
  EXTRA_VERB_START_CHARS, JD_REQUIRED_MARKERS, JD_NICE_MARKERS,
  WEAK_TO_STRONG, STRONG_VERBS, ROLE_SKILLS
};
