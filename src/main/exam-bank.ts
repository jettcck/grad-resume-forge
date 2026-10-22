// ============================================================
//  笔试题库（第一阶段：单选 / 多选 / 判断 / 填空）
//
//  设计约束：
//  - 全部题目写死在代码里，随应用分发，不联网、不下载；
//  - 每题必须带 tags（知识点）与 explanation（解析）——
//    错题本、薄弱项分析、下一轮组卷都依赖这两个字段；
//  - answer 统一用「选项文本」而不是索引：选项顺序调整不会让历史作答失效；
//  - version 从 1 开始，改题时递增，便于统计口径变化。
//
//  SQL / 编程题不在此列：需要独立 Worker + 资源限制 + 沙箱，
//  绝不能在渲染进程里直接执行用户代码。
// ============================================================
import type { ExamQuestion, ExamQuestionType } from './types';

const q = (
  id: string,
  type: ExamQuestionType,
  domain: string,
  tags: string[],
  difficulty: 1 | 2 | 3 | 4 | 5,
  stem: string,
  options: string[] | undefined,
  answer: string | string[],
  explanation: string
): ExamQuestion => ({ id, type, domain, tags, difficulty, stem, options, answer, explanation, version: 1 });

const JUDGE = ['正确', '错误'];

export const EXAM_BANK: ExamQuestion[] = [
  // ==========================================================
  //  后端 / Java 基础
  // ==========================================================
  q('be-java-01', 'single', 'backend', ['java', 'jvm'], 2,
    'Java 中 String 一旦创建内容不可变，根本原因是？',
    ['String 类被 final 修饰', '内部字符数组被 final 修饰且不对外暴露', 'JVM 禁止修改堆内存', '字符串只能来自常量池'],
    '内部字符数组被 final 修饰且不对外暴露',
    'String 内部持有 final 的 byte[]/char[] 且不提供修改入口，任何「修改」都是新建对象。类被 final 只表示不能被继承。'),
  q('be-java-02', 'single', 'backend', ['java', '集合'], 2,
    'ArrayList 与 LinkedList 相比，随机访问 get(i) 的时间复杂度分别是？',
    ['O(1) 与 O(n)', 'O(n) 与 O(1)', '都是 O(1)', '都是 O(n)'],
    'O(1) 与 O(n)',
    'ArrayList 底层是数组，按下标直接定位；LinkedList 是双向链表，必须从头/尾遍历到第 i 个节点。'),
  q('be-java-03', 'multiple', 'backend', ['java', '集合'], 3,
    '关于 HashMap，下列说法正确的有？',
    ['JDK8 中链表长度超过阈值会转为红黑树', '默认初始容量是 16', 'HashMap 是线程安全的', '允许一个 null 键'],
    ['JDK8 中链表长度超过阈值会转为红黑树', '默认初始容量是 16', '允许一个 null 键'],
    'HashMap 非线程安全（并发场景应用 ConcurrentHashMap）；JDK8 起链表长度 ≥8 且容量 ≥64 时树化；默认容量 16，允许一个 null 键。'),
  q('be-java-04', 'single', 'backend', ['java', '并发'], 3,
    'volatile 关键字能保证的是？',
    ['原子性', '可见性与禁止指令重排', '互斥性', '事务性'],
    '可见性与禁止指令重排',
    'volatile 保证写入立即对其他线程可见并通过内存屏障禁止重排，但不保证复合操作的原子性（如 i++）。'),
  q('be-java-05', 'judge', 'backend', ['java', '并发'], 2,
    'synchronized 修饰实例方法时，锁对象是当前实例（this）。',
    JUDGE, '正确',
    '实例方法锁的是 this；静态方法锁的是 Class 对象；同步代码块锁的是括号里的对象。'),
  q('be-java-06', 'single', 'backend', ['java', '异常'], 2,
    '下列哪个异常属于受检异常（checked exception）？',
    ['NullPointerException', 'IOException', 'ArrayIndexOutOfBoundsException', 'ClassCastException'],
    'IOException',
    '受检异常必须在方法签名声明或捕获；NPE、数组越界、类型转换都属于 RuntimeException（非受检）。'),
  q('be-java-07', 'fill', 'backend', ['java', 'jvm'], 3,
    'JVM 中负责存放对象实例、线程共享的内存区域称为______。',
    undefined, ['堆', 'Java堆', 'heap', 'Heap'],
    '堆（Heap）是线程共享的运行时数据区，几乎所有对象实例都在此分配；虚拟机栈是线程私有的。'),
  q('be-java-08', 'multiple', 'backend', ['java', 'jvm'], 3,
    '下列哪些属于 JVM 垃圾回收的根对象（GC Roots）？',
    ['虚拟机栈中引用的对象', '方法区中静态属性引用的对象', '局部变量表中的引用', '任意堆中的对象'],
    ['虚拟机栈中引用的对象', '方法区中静态属性引用的对象', '局部变量表中的引用'],
    'GC Roots 包含栈帧引用、静态变量、常量引用、JNI 引用等；堆内普通对象正是被判定是否可达的对象，不能作为根。'),
  q('be-java-09', 'single', 'backend', ['java', '泛型'], 3,
    'Java 泛型在编译后会被擦除，这意味着？',
    ['运行时可以获取泛型实参类型', '运行时 List<String> 与 List<Integer> 是同一个类', '泛型不能用于集合', '泛型只支持基本类型'],
    '运行时 List<String> 与 List<Integer> 是同一个类',
    '类型擦除让泛型信息只存在于编译期，运行时统一为原始类型，因此不能 new T()、不能对泛型数组直接创建。'),
  q('be-java-10', 'judge', 'backend', ['java', '基础'], 1,
    'Java 中 int 是基本类型，Integer 是引用类型，二者可以自动装箱与拆箱。',
    JUDGE, '正确',
    '自动装箱调用 Integer.valueOf，拆箱调用 intValue；注意 Integer 缓存 -128~127，超出范围用 == 比较会得到 false。'),

  // ==========================================================
  //  Spring / 框架
  // ==========================================================
  q('be-spring-01', 'single', 'backend', ['spring', 'ioc'], 2,
    'Spring 中 Bean 默认的作用域是？',
    ['prototype', 'singleton', 'request', 'session'],
    'singleton',
    '默认单例：容器内同一 Bean 只创建一个实例；prototype 每次获取都新建。'),
  q('be-spring-02', 'multiple', 'backend', ['spring', 'aop'], 3,
    '关于 Spring AOP 代理，正确的有？',
    ['JDK 动态代理要求目标类实现接口', 'CGLIB 通过继承生成子类实现代理', 'AOP 只能作用于 public 方法', '代理对象与目标对象必然是同一个实例'],
    ['JDK 动态代理要求目标类实现接口', 'CGLIB 通过继承生成子类实现代理', 'AOP 只能作用于 public 方法'],
    'Spring AOP 基于代理：JDK 代理需接口，CGLIB 生成子类（因此不能代理 final 类/方法）；代理对象不是原实例，故同类内部调用不走切面。'),
  q('be-spring-03', 'single', 'backend', ['spring', '事务'], 3,
    '@Transactional 默认在什么异常下回滚？',
    ['所有异常', 'RuntimeException 及其子类', '仅 IOException', '不会自动回滚'],
    'RuntimeException 及其子类',
    '默认只对 RuntimeException/Error 回滚；受检异常需显式配置 rollbackFor。'),
  q('be-spring-04', 'judge', 'backend', ['spring', '事务'], 4,
    '同一个类中，无事务的方法直接调用本类带 @Transactional 的方法，事务会生效。',
    JUDGE, '错误',
    'Spring 事务基于代理，自调用不经过代理对象，注解不生效。应拆分到另一个 Bean 或注入自身代理。'),
  q('be-spring-05', 'single', 'backend', ['spring', 'mvc'], 2,
    'Spring MVC 中，用于把请求参数绑定到方法入参的注解是？',
    ['@RequestParam', '@Autowired', '@Component', '@Bean'],
    '@RequestParam',
    '@RequestParam 绑定查询参数/表单字段；@PathVariable 取路径变量；@RequestBody 解析 JSON 请求体。'),

  // ==========================================================
  //  MySQL / SQL
  // ==========================================================
  q('db-mysql-01', 'single', 'backend', ['mysql', 'sql', '索引'], 2,
    'InnoDB 的聚簇索引中，叶子节点存放的是？',
    ['主键值与行指针', '完整行数据', '仅索引列', '页号列表'],
    '完整行数据',
    'InnoDB 主键索引即聚簇索引，叶子节点就是数据页本身；二级索引叶子存主键值，需回表。'),
  q('db-mysql-02', 'multiple', 'backend', ['mysql', '索引'], 4,
    '下列哪些情况会导致索引失效？',
    ['在索引列上使用函数', '前导模糊查询 LIKE \'%abc\'', '隐式类型转换（字符串列传数字）', '等值查询命中最左前缀'],
    ['在索引列上使用函数', '前导模糊查询 LIKE \'%abc\'', '隐式类型转换（字符串列传数字）'],
    '函数、前导 %、隐式转换都会让 B+ 树无法按序定位；最左前缀等值查询正是索引最擅长的场景。'),
  q('db-mysql-03', 'single', 'backend', ['mysql', '事务'], 3,
    'MySQL 默认可重复读（RR）隔离级别下，InnoDB 主要靠什么解决幻读？',
    ['表级锁', '间隙锁 + MVCC 快照读', '悲观锁全表扫描', '不做处理'],
    '间隙锁 + MVCC 快照读',
    '快照读靠 MVCC 一致性视图，当前读靠 Next-Key Lock（记录锁+间隙锁）阻止其他事务插入。'),
  q('db-mysql-04', 'fill', 'backend', ['sql'], 2,
    'SQL 中用于对分组结果进行过滤的关键字是______（区别于 WHERE 过滤行）。',
    undefined, ['HAVING', 'having'],
    'WHERE 在分组前过滤行，HAVING 在 GROUP BY 之后过滤分组，可使用聚合函数。'),
  q('db-mysql-05', 'judge', 'backend', ['mysql', '索引'], 3,
    '联合索引 (a, b, c) 可以支持仅以 b 为条件的查询走索引。',
    JUDGE, '错误',
    '必须满足最左前缀：跳过 a 直接用 b 无法定位；但 (a,b) 或 (a,c) 等前缀组合可用。'),
  q('db-mysql-06', 'single', 'backend', ['mysql'], 3,
    'EXPLAIN 输出中 type 为 ALL 表示？',
    ['使用了唯一索引', '全表扫描', '使用了覆盖索引', '索引合并'],
    '全表扫描',
    'type=ALL 是最差情况的全表扫描；理想值是 const/eq_ref/ref，range 次之；index 表示扫整个索引树。'),
  q('db-mysql-07', 'single', 'backend', ['mysql', 'sql'], 3,
    '以下哪条语句可以查出每个部门薪资最高的员工姓名？',
    ['SELECT name FROM emp GROUP BY dept HAVING MAX(salary)', 'SELECT name FROM emp e WHERE salary = (SELECT MAX(salary) FROM emp WHERE dept = e.dept)', 'SELECT MAX(name) FROM emp', 'SELECT name, MAX(salary) FROM emp'],
    'SELECT name FROM emp e WHERE salary = (SELECT MAX(salary) FROM emp WHERE dept = e.dept)',
    '关联子查询按部门取最大薪资再匹配；GROUP BY 直接取 name 在非聚合模式下结果不确定。'),

  // ==========================================================
  //  Redis
  // ==========================================================
  q('be-redis-01', 'single', 'backend', ['redis'], 2,
    'Redis 中查看某个 key 剩余过期时间的命令是？',
    ['TTL', 'EXPIRE', 'PERSIST', 'TYPE'],
    'TTL',
    'TTL 返回剩余秒数（-1 无过期，-2 不存在）；EXPIRE 是设置过期时间。'),
  q('be-redis-02', 'multiple', 'backend', ['redis'], 3,
    '关于 Redis 持久化，正确的有？',
    ['RDB 是某一时刻的数据快照', 'AOF 记录写命令，可配置每秒同步', 'RDB 文件通常比 AOF 小', '开启 AOF 后不可能丢数据'],
    ['RDB 是某一时刻的数据快照', 'AOF 记录写命令，可配置每秒同步', 'RDB 文件通常比 AOF 小'],
    'AOF 默认 everysec，极端情况下仍可能丢约 1 秒数据；appendfsync always 才接近不丢但性能差。'),
  q('be-redis-03', 'single', 'backend', ['redis', '缓存'], 3,
    '缓存穿透最常用的防护手段是？',
    ['对空结果也缓存并设置较短过期时间', '加大缓存容量', '使用主从复制', '开启 RDB'],
    '对空结果也缓存并设置较短过期时间',
    '穿透指查询不存在的数据，缓存永不命中。空值缓存、布隆过滤器、参数校验是常见方案。'),

  // ==========================================================
  //  计算机网络 / 操作系统
  // ==========================================================
  q('be-net-01', 'single', 'backend', ['network', 'tcp'], 2,
    'TCP 三次握手的第二次握手，服务端发送的报文标志位是？',
    ['SYN', 'SYN + ACK', 'ACK', 'FIN'],
    'SYN + ACK',
    '第一次 SYN，第二次 SYN+ACK，第三次 ACK；四次挥手则是 FIN/ACK/FIN/ACK。'),
  q('be-net-02', 'judge', 'backend', ['network', 'http'], 2,
    'HTTP/1.1 默认开启长连接（keep-alive），多个请求可复用同一 TCP 连接。',
    JUDGE, '正确',
    'HTTP/1.1 默认 Connection: keep-alive；HTTP/2 进一步支持同一连接上的多路复用。'),
  q('be-net-03', 'multiple', 'backend', ['network', 'http'], 3,
    '下列哪些属于 HTTP 缓存相关响应头？',
    ['Cache-Control', 'ETag', 'Last-Modified', 'Content-Length'],
    ['Cache-Control', 'ETag', 'Last-Modified'],
    'Content-Length 描述报文长度，与缓存协商无关；ETag/Last-Modified 用于协商缓存，Cache-Control 控制强缓存。'),
  q('be-net-04', 'single', 'backend', ['network'], 3,
    'HTTPS 相比 HTTP，主要增加了哪一层？',
    ['传输层 TCP', 'TLS/SSL 安全层', '应用层 HTTP/2', '网络层 IPsec'],
    'TLS/SSL 安全层',
    'HTTPS = HTTP over TLS，提供加密、完整性校验与身份认证；默认端口 443。'),
  q('be-net-05', 'fill', 'backend', ['network'], 2,
    'DNS 查询中，把域名解析为 IP 地址的默认端口号是______。',
    undefined, ['53'],
    'DNS 使用 UDP 53（区域传送等场景用 TCP 53）。'),
  q('be-os-01', 'single', 'backend', ['os'], 2,
    '进程与线程的主要区别是？',
    ['线程有独立地址空间，进程没有', '进程是资源分配单位，线程是 CPU 调度单位', '线程不能并发', '进程切换比线程更轻量'],
    '进程是资源分配单位，线程是 CPU 调度单位',
    '同一进程内的线程共享地址空间，切换开销更小；进程拥有独立地址空间。'),
  q('be-os-02', 'judge', 'backend', ['os'], 3,
    '死锁的四个必要条件包括互斥、占有并等待、不可剥夺和循环等待。',
    JUDGE, '正确',
    '四条件同时满足才可能死锁；破坏任一条件即可预防（如资源有序分配破坏循环等待）。'),
  q('be-os-03', 'single', 'backend', ['os'], 3,
    '虚拟内存的主要作用是？',
    ['提高 CPU 主频', '让进程拥有独立且可大于物理内存的地址空间', '减少磁盘容量占用', '替代缓存'],
    '让进程拥有独立且可大于物理内存的地址空间',
    '通过页表把虚拟地址映射到物理页或磁盘，实现隔离、按需调页与内存超额分配。'),

  // ==========================================================
  //  前端
  // ==========================================================
  q('fe-js-01', 'single', 'frontend', ['javascript', '原型'], 3,
    'JavaScript 中，函数声明的 prototype 属性指向？',
    ['函数的父类', '一个包含 constructor 指向该函数的对象', '函数本身', 'undefined'],
    '一个包含 constructor 指向该函数的对象',
    '每个函数都有 prototype 对象，默认带 constructor 指回函数；实例通过 __proto__ 指向它。'),
  q('fe-js-02', 'multiple', 'frontend', ['javascript'], 3,
    '下列哪些属于 JavaScript 的原始类型（primitive）？',
    ['string', 'number', 'object', 'symbol'],
    ['string', 'number', 'symbol'],
    '原始类型含 string/number/boolean/null/undefined/symbol/bigint；object 是引用类型。'),
  q('fe-js-03', 'single', 'frontend', ['javascript', '异步'], 3,
    '事件循环中，微任务（microtask）的典型例子是？',
    ['setTimeout 回调', 'Promise.then 回调', 'requestAnimationFrame', 'setInterval 回调'],
    'Promise.then 回调',
    '微任务在当前宏任务结束后立即清空（Promise、queueMicrotask、MutationObserver）；定时器属于宏任务。'),
  q('fe-js-04', 'judge', 'frontend', ['javascript'], 2,
    'typeof null 的结果是 "object"。',
    JUDGE, '正确',
    '这是历史遗留 bug：null 的类型标签为 0，与 object 相同。判断 null 应用 === null。'),
  q('fe-js-05', 'single', 'frontend', ['javascript', '闭包'], 3,
    '闭包的本质是？',
    ['函数内部定义的变量', '函数与其词法作用域的组合', '立即执行函数', '箭头函数'],
    '函数与其词法作用域的组合',
    '函数在定义时捕获外层作用域，即使外层已返回仍可访问其中的变量，因此可用于封装私有状态。'),
  q('fe-js-06', 'fill', 'frontend', ['javascript'], 2,
    'JavaScript 中用于判断数组的内置方法是 Array.______()。',
    undefined, ['isArray', 'isarray'],
    'Array.isArray 可跨 iframe 正确判断；typeof [] 返回 "object" 不可靠。'),
  q('fe-css-01', 'single', 'frontend', ['css', '布局'], 3,
    'Flex 布局中，让子元素在主轴方向居中的属性是？',
    ['align-items: center', 'justify-content: center', 'text-align: center', 'margin: auto 0'],
    'justify-content: center',
    'justify-content 控制主轴对齐，align-items 控制交叉轴；flex-direction: column 时主轴变为纵向。'),
  q('fe-css-02', 'multiple', 'frontend', ['css'], 3,
    '下列哪些会让元素脱离文档流？',
    ['position: absolute', 'position: fixed', 'float: left', 'display: inline-block'],
    ['position: absolute', 'position: fixed', 'float: left'],
    '绝对/固定定位与浮动都会脱离普通流；inline-block 仍在流内。'),
  q('fe-css-03', 'single', 'frontend', ['css', '选择器'], 2,
    '选择器 .a .b 与 .a > .b 的区别是？',
    ['没有区别', '前者匹配任意后代，后者只匹配直接子元素', '后者优先级更低', '前者只匹配兄弟元素'],
    '前者匹配任意后代，后者只匹配直接子元素',
    '空格是后代选择器，> 是子代选择器；两者优先级相同，取决于具体组合。'),
  q('fe-browser-01', 'single', 'frontend', ['browser', '性能'], 3,
    '浏览器渲染流程的正确顺序是？',
    ['DOM → CSSOM → 布局 → 绘制 → 合成', 'CSSOM → DOM → 绘制 → 布局', '布局 → DOM → CSSOM → 合成', 'DOM → 布局 → CSSOM → 绘制'],
    'DOM → CSSOM → 布局 → 绘制 → 合成',
    '解析 HTML 构建 DOM，解析 CSS 构建 CSSOM，合并计算布局（reflow），再绘制（repaint）与图层合成。'),
  q('fe-browser-02', 'judge', 'frontend', ['browser'], 2,
    'localStorage 中存储的数据会随 HTTP 请求自动发送到服务器。',
    JUDGE, '错误',
    'localStorage 仅存于客户端，不参与请求；会自动随请求发送的是 Cookie。'),
  q('fe-browser-03', 'single', 'frontend', ['browser', '安全'], 4,
    '防御 XSS 最根本的做法是？',
    ['对用户输入做输出编码/转义', '禁用 JavaScript', '使用 HTTPS', '限制请求频率'],
    '对用户输入做输出编码/转义',
    'XSS 本质是把用户输入当代码执行；按上下文做 HTML/属性/URL/JS 编码是根本手段，CSP 是纵深防御。'),

  // ==========================================================
  //  算法 / 数据结构
  // ==========================================================
  q('algo-ds-01', 'single', 'algorithm', ['数据结构', '栈'], 2,
    '下列哪种场景最适合使用栈？',
    ['按优先级取最小元素', '括号匹配与表达式求值', '广度优先遍历', '范围查询'],
    '括号匹配与表达式求值',
    '栈的后进先出特性天然适配嵌套结构；BFS 用队列，范围查询用树/跳表。'),
  q('algo-ds-02', 'single', 'algorithm', ['数据结构', '哈希'], 2,
    '哈希表平均情况下的查找时间复杂度是？',
    ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
    'O(1)',
    '理想哈希函数下均摊 O(1)；冲突严重退化为 O(n)，因此需要扩容与好的散列函数。'),
  q('algo-ds-03', 'multiple', 'algorithm', ['数据结构', '树'], 3,
    '关于二叉搜索树（BST），正确的有？',
    ['中序遍历结果有序', '查找平均 O(log n)', '退化成链表时查找为 O(n)', '任意 BST 高度都是 log n'],
    ['中序遍历结果有序', '查找平均 O(log n)', '退化成链表时查找为 O(n)'],
    'BST 有序性依赖中序；插入有序数据会退化成链，因此才有 AVL/红黑树等平衡结构。'),
  q('algo-ds-04', 'fill', 'algorithm', ['算法', '复杂度'], 2,
    '快速排序的平均时间复杂度是 O(______)。',
    undefined, ['nlogn', 'n log n', 'O(nlogn)', 'n*logn'],
    '快排平均 O(n log n)，最坏（已排序且取端点为基准）O(n²)；堆排与归并稳定在 O(n log n)。'),
  q('algo-ds-05', 'single', 'algorithm', ['算法'], 3,
    '要在无权图中求最短路径，应使用？',
    ['Dijkstra', 'BFS', 'DFS', '拓扑排序'],
    'BFS',
    '无权图边权相等，BFS 按层扩展即最短；Dijkstra 用于带权非负图。'),
  q('algo-ds-06', 'judge', 'algorithm', ['算法', '动态规划'], 3,
    '动态规划适用的问题必须同时具备最优子结构与重叠子问题。',
    JUDGE, '正确',
    '缺最优子结构无法由子问题推全局最优；缺重叠子问题则退化为普通分治，无需记忆化。'),
  q('algo-ds-07', 'single', 'algorithm', ['算法', '双指针'], 3,
    '有序数组中求两数之和等于目标值，最优做法是？',
    ['双重循环', '左右双指针向中间收缩', '哈希表', '二分查找每个元素'],
    '左右双指针向中间收缩',
    '有序性让指针可根据当前和大小单向移动，O(n) 时间 O(1) 空间；哈希表虽 O(n) 但需额外空间。'),

  // ==========================================================
  //  数据方向
  // ==========================================================
  q('data-sql-01', 'single', 'data', ['sql', '窗口函数'], 4,
    '窗口函数 ROW_NUMBER() 与 RANK() 的关键区别是？',
    ['没有区别', '并列时 ROW_NUMBER 仍连续编号，RANK 会跳号', 'RANK 不能排序', 'ROW_NUMBER 只能用于分组'],
    '并列时 ROW_NUMBER 仍连续编号，RANK 会跳号',
    'ROW_NUMBER 强制唯一序号；RANK 并列同名次后跳号（1,1,3）；DENSE_RANK 并列后不跳号（1,1,2）。'),
  q('data-sql-02', 'multiple', 'data', ['sql'], 3,
    '关于 SQL 中的 NULL，正确的有？',
    ['NULL = NULL 结果为 UNKNOWN', 'COUNT(列) 会忽略 NULL', 'NULL 参与算术运算结果为 NULL', 'ORDER BY 中 NULL 一定排在最前'],
    ['NULL = NULL 结果为 UNKNOWN', 'COUNT(列) 会忽略 NULL', 'NULL 参与算术运算结果为 NULL'],
    'NULL 表示未知，需用 IS NULL 判断；排序位置取决于数据库实现（MySQL 升序 NULL 在前）。'),
  q('data-sql-03', 'single', 'data', ['sql'], 3,
    '以下哪个操作可能让结果集行数变多？',
    ['INNER JOIN', 'LEFT JOIN', '一对多关联的 JOIN', 'DISTINCT'],
    '一对多关联的 JOIN',
    '一对多关联会把左表一行展开成多行；DISTINCT 只会减少或保持行数。'),
  q('data-dw-01', 'single', 'data', ['数仓'], 3,
    '数据仓库分层中，ODS 层通常存放？',
    ['面向主题的汇总数据', '贴源原始数据', '应用层指标', '维度表'],
    '贴源原始数据',
    'ODS 贴源接入、几乎不做加工；DWD 做清洗明细，DWS 做主题汇总，ADS 面向应用。'),
  q('data-stat-01', 'single', 'data', ['统计'], 3,
    '一组数据中存在极端离群值时，最能代表集中趋势的指标是？',
    ['平均数', '中位数', '众数', '方差'],
    '中位数',
    '中位数对极端值不敏感（稳健统计量）；平均数会被离群值显著拉偏。'),
  q('data-stat-02', 'judge', 'data', ['统计', 'ab测试'], 3,
    'A/B 实验中，只要实验组指标高于对照组就可以判定策略有效。',
    JUDGE, '错误',
    '还需统计显著性检验（如 t 检验）、样本量与置信区间，排除随机波动；否则可能是假阳性。'),

  // ==========================================================
  //  通用职业能力
  // ==========================================================
  q('gen-01', 'single', 'general', ['逻辑'], 3,
    '所有 A 都是 B，有些 B 是 C。下列必然成立的是？',
    ['有些 A 是 C', '所有 A 都是 C', '有些 C 是 B', '没有 A 是 C'],
    '有些 C 是 B',
    '「有些 B 是 C」可对称推出「有些 C 是 B」；A 与 C 的关系无法确定。'),
  q('gen-02', 'single', 'general', ['沟通'], 2,
    '向面试官描述项目时，最能体现个人贡献的表达结构是？',
    ['按时间顺序讲所有细节', '背景-任务-行动-结果（STAR）', '只讲技术栈', '只讲团队成绩'],
    '背景-任务-行动-结果（STAR）',
    'STAR 让听者快速抓住情境、你的职责、具体动作与可量化结果，避免流水账。'),
  q('gen-03', 'multiple', 'general', ['职业素养'], 3,
    '收到面试邀请后，下列哪些做法是恰当的？',
    ['24 小时内回复确认', '提前了解岗位与公司业务', '临时有事直接不参加', '准备好 2-3 个反问'],
    ['24 小时内回复确认', '提前了解岗位与公司业务', '准备好 2-3 个反问'],
    '及时确认、做功课、准备反问是基本职业礼仪；无故缺席会进入企业黑名单。'),
  q('gen-04', 'judge', 'general', ['职业素养'], 2,
    '简历上可以把参与过的项目写成「主导」，只要面试时能自圆其说。',
    JUDGE, '错误',
    '夸大职责在追问细节时极易暴露，且背景调查会核实；应如实描述个人贡献边界。'),
  q('gen-05', 'single', 'general', ['逻辑', '数据分析'], 4,
    '某产品日活上升 20%，但人均使用时长下降 15%，最可能的解释是？',
    ['产品体验变差', '新增用户多但使用较浅，拉低人均值', '统计口径错误', '服务器故障'],
    '新增用户多但使用较浅，拉低人均值',
    '总量上升、人均下降常见于大量轻度新用户涌入（辛普森悖论的情形），需分群看新老用户。'),
  q('gen-06', 'fill', 'general', ['表达'], 2,
    '面试结尾反问环节，通常建议准备______个问题（填数字）。',
    undefined, ['2', '两', '2-3', '2~3'],
    '2-3 个为宜：太少显得没兴趣，太多会拖长面试并显得挑剔。'),

  // ==========================================================
  //  补充：后端工程实践
  // ==========================================================
  q('be-prac-01', 'single', 'backend', ['工程实践', '接口'], 3,
    'RESTful 风格中，删除某个资源的正确方法是？',
    ['GET /resource/delete?id=1', 'DELETE /resource/1', 'POST /resource/delete', 'PUT /resource/1/delete'],
    'DELETE /resource/1',
    '用 HTTP 方法表达动作，URL 表示资源；GET 不应产生副作用。'),
  q('be-prac-02', 'multiple', 'backend', ['工程实践', '幂等'], 3,
    '下列哪些 HTTP 方法在语义上应当是幂等的？',
    ['GET', 'PUT', 'DELETE', 'POST'],
    ['GET', 'PUT', 'DELETE'],
    'POST 通常用于创建，重复提交会产生多条记录；幂等可通过唯一请求号 + 去重表实现。'),
  q('be-prac-03', 'judge', 'backend', ['工程实践', '日志'], 2,
    '生产环境打印日志时，不应把用户的密码、身份证号等敏感信息原样写进日志。',
    JUDGE, '正确',
    '日志常被集中采集与长期留存，敏感信息应脱敏或哈希，避免合规风险与泄露面扩大。'),
  q('be-prac-04', 'single', 'backend', ['工程实践', '分布式'], 4,
    '分布式系统中，防止缓存击穿（热点 key 失效瞬间大量请求打到数据库）的常用手段是？',
    ['随机过期时间', '互斥锁/逻辑过期重建', '增加从库', '关闭缓存'],
    '互斥锁/逻辑过期重建',
    '缓存击穿针对单个热点 key：用互斥锁保证只有一个线程回源，或逻辑过期后台异步重建。'),

  // ==========================================================
  //  补充：前端工程
  // ==========================================================
  q('fe-eng-01', 'single', 'frontend', ['工程化', '构建'], 3,
    '前端构建工具中，Tree Shaking 依赖的前提是？',
    ['代码使用 CommonJS', '使用 ES Module 静态导入导出', '开启 sourcemap', '压缩代码'],
    '使用 ES Module 静态导入导出',
    'ESM 的静态结构让打包器能分析未使用的导出并在产物中移除；CommonJS 动态 require 难以静态分析。'),
  q('fe-eng-02', 'judge', 'frontend', ['工程化', '安全'], 3,
    '前端把接口密钥写进打包产物是安全的，因为代码经过了压缩混淆。',
    JUDGE, '错误',
    '压缩混淆不改变可读性本质，密钥仍可从产物中提取；敏感调用应放在服务端代理。'),
  q('fe-eng-03', 'single', 'frontend', ['性能'], 3,
    '首屏加载优化中，下列哪项最直接减少关键渲染路径阻塞？',
    ['把 CSS 内联关键样式并异步加载其余样式', '增加图片数量', '使用更多字体', '把所有 JS 放 head 同步加载'],
    '把 CSS 内联关键样式并异步加载其余样式',
    '关键 CSS 内联避免额外往返，非关键样式异步；同步 JS 会阻塞解析，应 defer/async 或置底。')
];

/** 按 id 建索引，评分与错题回看都要用 */
export const QUESTION_MAP: Map<string, ExamQuestion> = new Map(EXAM_BANK.map((item) => [item.id, item]));

export function getQuestion(id: string): ExamQuestion | null {
  return QUESTION_MAP.get(id) || null;
}

export function allTags(): string[] {
  const set = new Set<string>();
  EXAM_BANK.forEach((item) => item.tags.forEach((t) => set.add(t)));
  return [...set].sort();
}

export function allDomains(): string[] {
  return [...new Set(EXAM_BANK.map((item) => item.domain))].sort();
}

/** 题库版本：题目内容变更时递增。试卷保存该值，便于追溯「这份卷子是哪版题库出的」 */
export const BANK_VERSION = 1;
