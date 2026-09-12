// ============================================================
//  小助手知识库（结构化，纯本地）
//  设计：
//   - 每条知识 = 若干关键词（含同义词）+ 方向（通用或 13 方向）+ 答案 + 可选操作
//   - 检索：词边界匹配计分（复用 aliasMatcher 思路），方向上下文加权
//   - 答不上的问题给「操作型兜底」：直接引导用户去用对应功能
//   面向非计算机应届生：语言直白，每个答案 ≤ 4 句，落到「具体怎么做」
// ============================================================

import type { Domain } from './types';

export interface KnowledgeEntry {
  id: string;
  keywords: string[];          // 命中任一即得分；英文走词边界
  domains: Array<Domain | 'all'>; // 限定方向；'all' 全局
  question: string;            // 展示用：这条知识回答什么
  answer: string;              // 直白、行动导向
  action?: { label: string; route: string }; // 可选：引导用户去执行的操作
}

export const KNOWLEDGE: KnowledgeEntry[] = [
  // ---------- 通用：简历怎么写 ----------
  {
    id: 'quantify',
    keywords: ['量化', '数字', '百分比', '数据支撑', '怎么写成果', '写多少', '成果怎么写', '说服力', '写出说服力', '有说服力'],
    domains: ['all'],
    question: '怎么把经历写出说服力（量化）',
    answer: '每条经历尽量带一个数字：做了多少（200 份问卷 / 300 行代码）、效果多好（满意度 96% / 提速 3 倍）、规模多大（覆盖 2000 人）。没有数字就想「时间、数量、金额、比例、排名」五个角度。写不出来就写规模或频率，比如「每周 3 次、持续 4 个月」。',
    action: { label: '体检我的量化占比', route: 'resume' }
  },
  {
    id: 'star',
    keywords: ['star', '法则', '结构', '怎么组织', '怎么描述', '经历怎么写', '写经历'],
    domains: ['all'],
    question: '写经历有没有通用结构（STAR）',
    answer: '情境-任务-行动-结果。简历里重点写 A 和 R：你做了什么动作 + 结果如何。例：不是「负责社团招新」，而是「策划 3 场招新宣讲，报名人数比去年多 40%」。',
    action: { label: '去写我的经历', route: 'profile' }
  },
  {
    id: 'one-page',
    keywords: ['几页', '一页', '页数', '篇幅', '太长', '删', '精简'],
    domains: ['all'],
    question: '简历应该写几页',
    answer: '应届生一页最好，最多不超过两页。优先级：实习/项目 > 技能 > 教育 > 校园经历。删的时候先删「参加了什么」，保留「做成了什么」。',
    action: { label: '预览我的页数', route: 'resume' }
  },
  {
    id: 'no-cliche',
    keywords: ['套话', '空话', '形容词', '认真负责', '吃苦耐劳', '自我评价怎么写', '个人简介怎么写'],
    domains: ['all'],
    question: '自我评价 / 简介怎么写不空洞',
    answer: '删掉「认真负责、吃苦耐劳、学习能力强」这类谁都能写的话，换成事实：「4 个月独立完成 2 个项目」「六级 580」。「去 AI 味体检」会自动标出这些词，照着删就行。',
    action: { label: '跑一次体检', route: 'resume' }
  },
  {
    id: 'photo',
    keywords: ['照片', '证件照', '要不要放照片', '形象照'],
    domains: ['all'],
    question: '要不要放照片',
    answer: '看行业：国企、银行、行政、销售、教师岗建议放正装照；互联网技术岗一般不放。放就放干净的证件照，不要生活照、自拍。',
    action: { label: '导出 PDF 看排版', route: 'resume' }
  },
  {
    id: 'gpa',
    keywords: ['gpa', '绩点', '成绩', '排名', '挂科'],
    domains: ['all'],
    question: 'GPA 低 / 有挂科要不要写',
    answer: 'GPA 3.5 以上或专业前 20% 就写；不到就不写 GPA，改写单科高分（与岗位相关的课）或奖学金。挂科不用写，没人查你挂没挂，只看你拿得出手的。',
    action: { label: '去改教育经历', route: 'profile' }
  },
  {
    id: 'no-internship',
    keywords: ['没有实习', '没实习', '实习经历', '没经验', '应届没经验', '白纸'],
    domains: ['all'],
    question: '没有实习经历怎么办',
    answer: '用这三样替代：① 课程设计/毕业设计（按项目写）；② 竞赛/比赛（数学建模、挑战杯、专业竞赛）；③ 高质量的校园经历（组织过什么活动、做出什么结果）。核心是「有产出」，不纠结「是不是实习」。',
    action: { label: '去写项目经历', route: 'profile' }
  },
  {
    id: 'campus',
    keywords: ['社团', '学生会', '校园经历', '班干部', '志愿者', '活动'],
    domains: ['all'],
    question: '社团/学生会经历怎么写才有用',
    answer: '写「你负责的部分 + 结果数字」，不写头衔。反例：担任宣传部部长。正例：运营公众号 8 个月，产出推文 40 篇，平均阅读 1200，涨粉 800。招生官不关心职位，关心你做成过什么。',
    action: { label: '去写这段经历', route: 'profile' }
  },
  {
    id: 'skill-order',
    keywords: ['技能怎么写', '技能顺序', '技能清单', '会什么写什么'],
    domains: ['all'],
    question: '技能清单怎么排序',
    answer: '把目标岗位 JD 里出现的技能放前面。先看目标岗位的招聘要求，把你确实会的、JD 也提的排最前，相关的次之，无关的不写。',
    action: { label: '贴 JD 看技能缺口', route: 'resume' }
  },
  {
    id: 'file-format',
    keywords: ['pdf', 'word', '格式', '文件名', '投递格式'],
    domains: ['all'],
    question: '投简历用什么格式',
    answer: '一律 PDF，文件名「姓名-岗位-学校」。Word 在对方电脑上排版会乱；有些招聘系统还会机器解析，PDF 最稳。这个应用导出的就是 PDF。',
    action: { label: '导出 PDF', route: 'resume' }
  },
  {
    id: 'tailor',
    keywords: ['一份简历投所有', '针对性', '定制', '不同岗位', '改简历', '通用简历'],
    domains: ['all'],
    question: '要不要每个岗位改一版简历',
    answer: '投不同方向的岗位（比如既投运营又投销售）至少准备两版，改的是：技能顺序、项目详略、自我介绍方向。同一方向内的岗位，用「JD 匹配」功能贴一下招聘要求，命中低的技能补进简历再投。',
    action: { label: '试试 JD 匹配', route: 'resume' }
  },
  // ---------- 通用：求职流程 ----------
  {
    id: 'when-apply',
    keywords: ['什么时候投', '秋招', '春招', '时间线', '网申', '招聘季'],
    domains: ['all'],
    question: '校招时间线（什么时候做什么）',
    answer: '秋招：大三暑假 7-8 月开始（提前批），9-11 月正式批，岗位最多。春招：次年 2-4 月，补招为主、岗位少。黄金法则是提前一年准备：大三上学期攒实习，下学期投提前批。',
    action: { label: '记录我的投递', route: 'apps' }
  },
  {
    id: 'track',
    keywords: ['投递记录', '跟踪', '投了多少', '管理投递', '忘了投没投'],
    domains: ['all'],
    question: '投了一堆记不住怎么办',
    answer: '用「投递管理」页：每个公司记一条，状态从想投→已投→面试→Offer 一路点过去。点「官网」按钮直达对方招聘页，投完顺手改状态。',
    action: { label: '打开投递管理', route: 'apps' }
  },
  {
    id: 'salary',
    keywords: ['薪资', '工资', '谈薪', 'offer 谈判', '期望薪资', '待遇'],
    domains: ['all'],
    question: '期望薪资怎么答',
    answer: '先查同城同岗应届价（招聘网站搜岗位看区间），答区间不答单点：「了解到这个岗位应届大概 X 到 Y，我期望在这个区间偏上，具体看重成长空间」。没到谈薪阶段别主动提钱。',
    action: { label: '先去搜岗位行情', route: 'apps' }
  },
  {
    id: 'interview-prep',
    keywords: ['面试准备', '面试问什么', '自我介绍', '面试技巧', '怎么面试'],
    domains: ['all'],
    question: '面试怎么准备（通用）',
    answer: '① 1 分钟自我介绍背熟：我是谁+最相关的一段经历+为什么匹配这个岗；② 把简历上每条经历按 STAR 展开讲 2 分钟的版本；③ 准备 2 个反问（培养机制、日常工作）；④ 提前查公司主营业务。简历上写了的就必须能讲清楚。',
    action: { label: '先过一遍简历', route: 'resume' }
  },
  // ---------- 方向专属 ----------
  {
    id: 'tech-project',
    keywords: ['项目', 'github', '代码', '开源', '作品', 'demo'],
    domains: ['backend', 'frontend', 'algorithm', 'data', 'llm'],
    question: '技术岗没有好项目怎么办',
    answer: '质量 > 数量：一个有 README、能跑起来、有说明截图的项目胜过五个半成品。没有实习就做 1-2 个完整项目（带数据、带性能数字），放 GitHub 链接到简历。面试官真的会点开看。',
    action: { label: '完善我的项目经历', route: 'profile' }
  },
  {
    id: 'tech-skill-list',
    keywords: ['技术栈', '技术怎么写', '会哪些技术', '框架'],
    domains: ['backend', 'frontend', 'algorithm', 'data', 'llm'],
    question: '技术技能怎么写不踩坑',
    answer: '写「熟练/熟悉/了解」要诚实：写「精通」必被追问到底。没有项目支撑的技术别写——写了 Spark 没跑过 Spark 集群，两句话就露馅。宁可少写三条，每条都能聊 5 分钟。',
    action: { label: '检查技能清单', route: 'profile' }
  },
  {
    id: 'fin-cert',
    keywords: ['证书', 'cpa', '会计证', '证券从业', '银行从业', '初级会计'],
    domains: ['finance'],
    question: '财务金融方向哪些证书值得写',
    answer: '硬通货：CPA（过了几科写几科）、初级会计、证券/基金/银行从业资格。加分项：英语六级高分、Excel 熟练度（数据透视/函数要真能说出口）。奖学金和年级排名一定写。',
    action: { label: '补进技能清单', route: 'profile' }
  },
  {
    id: 'fin-intern',
    keywords: ['事务所', '审计', '银行实习', '券商', '四大'],
    domains: ['finance'],
    question: '财务第一份实习选哪',
    answer: '事务所年审（寒假最缺人、门槛相对低、学底稿最快）> 银行大堂/信贷 > 企业财务部。有事务所经历再冲券商/四大会顺很多。学校就业网、事务所官网校招页、实习僧都有入口。',
    action: { label: '找事务所投递入口', route: 'apps' }
  },
  {
    id: 'mkt-works',
    keywords: ['作品集', '新媒体', '运营作品', '公众号', '爆款', '案例'],
    domains: ['marketing'],
    question: '运营/新媒体没有作品怎么办',
    answer: '现做：注册一个账号运营 1-2 个月，产出 10 篇内容，把数据（阅读/涨粉/完播）写进简历——这本身就是最强作品。或者整理你做过的任何活动：海报、文案、活动复盘，截图整理成作品集链接放简历。',
    action: { label: '把这个账号写进项目', route: 'profile' }
  },
  {
    id: 'edu-cert',
    keywords: ['教资', '教师资格', '教师编', '试讲', '普通话'],
    domains: ['education'],
    question: '当老师需要准备什么',
    answer: '① 教师资格证（笔试+面试，大三大四考）；② 普通话二甲（语文要二甲，其他二乙）；③ 试讲：准备 1 篇拿手的 10 分钟微课反复练；④ 简历突出家教/支教/助教经历。教师编关注当地教育局公告，每年 3-4 月和 9-10 月招。',
    action: { label: '把家教经历写进简历', route: 'profile' }
  },
  {
    id: 'med-norm',
    keywords: ['规培', '执业医师', '护士', '三甲', '医院招聘'],
    domains: ['medical'],
    question: '医学生求职要点',
    answer: '临床岗：执业医师资格 + 规培是硬门槛，招聘看学校、实习医院层级。简历重点写：轮转科室、独立操作过的项目（腰穿/换药次数）、病历书写量。护理岗：护资 + 三甲实习经历优先，简历附操作清单。',
    action: { label: '整理轮转经历', route: 'profile' }
  },
  {
    id: 'eng-cad',
    keywords: ['cad', 'solidworks', '图纸', '工艺', '工厂', '制造业'],
    domains: ['eng', 'civil'],
    question: '工科简历的核心竞争力',
    answer: '软件能力（CAD/SolidWorks/广联达 写明熟练度）+ 图纸/作品（课程设计的大图、BIM 模型拍照放作品集）+ 实习里摸过的真东西（加工工艺、施工工序）。工科 HR 很认「下过车间/下过工地」的经历。',
    action: { label: '写软件与实习细节', route: 'profile' }
  },
  {
    id: 'design-portfolio',
    keywords: ['设计作品', '作品集链接', 'portfolio', '作品集'],
    domains: ['design'],
    question: '设计岗作品集怎么做',
    answer: '8-15 个作品精挑，宁缺毋滥；每个作品配「需求-思路-成品」三行说明；PDF 或在线链接（放在简历「作品集」一栏）。临摹的要标注临摹，混入原创。面试官 30 秒翻完，前 3 页决定印象。',
    action: { label: '把作品集链接填进简历', route: 'profile' }
  },
  {
    id: 'hr-basic',
    keywords: ['hr', '人力资源', '招聘专员', '行政', '人事'],
    domains: ['business'],
    question: '人力行政方向怎么突围',
    answer: '考人力资源管理师（三级/四级）；经历里突出「组织协调」的数字（组织过几场活动、对接多少人）；Excel 熟练度（vlookup、数据透视）单独写。这两个方向看细心和沟通，简历本身干净工整就是加分。',
    action: { label: '检查完成度', route: 'profile' }
  },
  // ---------- App 使用 ----------
  {
    id: 'app-import',
    keywords: ['导入', '旧简历', 'pdf 导入', '上传简历', '导入旧简历'],
    domains: ['all'],
    question: '我有旧简历，怎么搬进来',
    answer: '信息录入页点「导入旧简历」，选 PDF 或 TXT 文件，应用会自动识别学校、实习、项目、技能并填表（识别结果先给你确认，选「合并」或「替换」）。扫描件图片识别不了，那种就手动填。',
    action: { label: '去导入', route: 'profile' }
  },
  {
    id: 'app-agent',
    keywords: ['agent', '深度优化', '自动改写', 'ai 优化', 'ai 改简历', '智能优化'],
    domains: ['all'],
    question: 'AI 深度优化怎么用',
    answer: '简历预览页右侧「Agent 深度优化」：先贴目标岗位的 JD（招聘要求原文），选「流水线」或「自主 Agent」模式跑一轮。AI 会按 JD 改写你的条目，每条改写你勾选确认才生效，改错了随时「回炉快照」恢复。',
    action: { label: '去跑一轮优化', route: 'resume' }
  },
  {
    id: 'app-audit',
    keywords: ['体检', '评分', '分数', 'ai 味', '去 ai', '检查简历'],
    domains: ['all'],
    question: '体检分数是什么意思',
    answer: '0-100 分，越高越像「真人手写的简历」。扣分项：套话（赋能/认真负责）、空洞形容词（扎实的/丰富的）、缺数字、句子太长。分数不用追求 100，85+ 就很干净了；标出的问题照着改，每改一处分数会涨。',
    action: { label: '看我的体检分', route: 'resume' }
  },
  {
    id: 'app-jd',
    keywords: ['jd', '匹配度', '岗位匹配', '命中率', '贴 jd'],
    domains: ['all'],
    question: 'JD 匹配是干嘛的',
    answer: '把目标岗位的招聘要求（JD）原文贴进去，应用会逐条对比：JD 要求的技能里你简历有哪几个、缺哪几个。命中率高就放心投；缺的技能如果你确实会，赶紧补进简历再投，通过率会高很多。',
    action: { label: '贴一份 JD 试试', route: 'resume' }
  },
  {
    id: 'app-embedded',
    keywords: ['内置模型', '应用内模型', '免安装', 'webgpu', '下载模型', '不装 ollama', '不想装 ollama', '不装模型', '不用 api', '不想填 api', '免配置', '没有显卡能用 ai 吗', '下载要多久', '镜像', '下载不动'],
    domains: ['all'],
    question: '不想装 Ollama / 不想填 API，还能用 AI 吗',
    answer: '能，而且有三条路都不用你装 Ollama：\n① 「零配置（规则）」——什么都不用下、不用填、不联网，即时完成（删套话 / 强化动词 / 保量化 / 按 JD 对齐表述）；\n② 「应用内模型」——点一次下载约 281MB（国内镜像直连、不需要科学上网，之后断网可用）；\n③ 如果你本机已装过 LM Studio / llama.cpp / vLLM 之类，配置页会自动探测到并让你一键使用。\n只有想要「按 JD 语义重组句子」这种更强效果时才需要 ②——① 做不到这一点。',
    action: { label: '去配置页看看', route: 'resume' }
  },
  {
    id: 'app-interview',
    keywords: ['面试准备', '面试怎么准备', '自我介绍', '面试问题', '面试会问什么', '面试紧张', '反问', '开放题', '网申问题', '职业规划怎么写', '优缺点怎么写'],
    domains: ['all'],
    question: '面试怎么准备 / 自我介绍怎么说',
    answer: '左侧「面试准备」页全部是本地生成的，不需要任何模型：\n① 自我介绍按你的档案自动拼稿（30 秒 / 60 秒两档，只说你写过的内容，不会编数字），可一键复制；\n② 66 道高频题按你的目标方向筛过，每题给考察点、回答框架、常见坑，讲经历类的问题还会指出用你简历里的哪一条来答；\n③ 网申开放题（职业规划 / 优缺点 / 为什么选我们…）有填空式模板；\n④ 面试最后的反问清单。',
    action: { label: '去面试准备页', route: 'interview' }
  },
  {
    id: 'app-demo',
    keywords: ['示例', '不会填', '不知道怎么开始', '第一次用', '上手'],
    domains: ['all'],
    question: '第一次用不知道从哪开始',
    answer: '信息录入页顶部有「示例档案」按钮（后端工程师 / 财务专员两个版本），一键载入完整示例，去简历预览页看看体检、JD 匹配、AI 优化长什么样，玩明白了再换成自己的内容。',
    action: { label: '回信息录入页', route: 'profile' }
  }
];

// 「答不上来」时的操作型兜底（按场景给动作，不硬编答案）
export const FALLBACK_ACTIONS: KnowledgeEntry[] = [
  {
    id: 'fb-resume',
    keywords: [],
    domains: ['all'],
    question: '关于简历本身的问题',
    answer: '这个我没背下来，但可以直接帮你检查：体检看套话和数字、JD 匹配看技能缺口、完成度看漏填项。跑一遍比问更直接。',
    action: { label: '去体检我的简历', route: 'resume' }
  },
  {
    id: 'fb-job',
    keywords: [],
    domains: ['all'],
    question: '关于求职流程的问题',
    answer: '流程类问题建议直接去「投递管理」页：里面有各大公司官方招聘入口和按岗位搜索的平台直达，边看边记状态最实际。',
    action: { label: '打开投递管理', route: 'apps' }
  }
];
