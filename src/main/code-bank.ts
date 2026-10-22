// ============================================================
//  编程题库（ACM 标准输入输出）
//
//  约定：
//  - 用户程序从 stdin 读、往 stdout 写，判题按「逐行去尾空白 + 忽略末尾空行」比较；
//  - samples 是题面公开样例，可以「运行样例」看结果；
//  - testCases 是隐藏用例，只下发 verdict，不回传输入输出（避免泄题）；
//  - 每题都带参考解法在 test-code.js 里跑通全部用例，防止题面与用例不一致。
// ============================================================
import type { CodeQuestion } from './types';
import { EXTRA_CODE_BANK } from './code-bank-extra';

export const CODE_BANK: CodeQuestion[] = [
  {
    id: 'code-a-plus-b',
    title: 'A + B',
    domain: 'backend',
    tags: ['入门', '输入输出'],
    difficulty: 1,
    statement: '读入两个整数 A 和 B，输出它们的和。\n\n这道题用来熟悉平台的输入输出格式：所有输入从标准输入读，结果写到标准输出，不要打印任何额外提示文字。',
    inputFormat: '一行两个整数 A、B，用空格分隔（-10^9 ≤ A, B ≤ 10^9）。',
    outputFormat: '一行一个整数，表示 A + B。',
    samples: [
      { input: '1 2', output: '3' },
      { input: '-5 8', output: '3' }
    ],
    testCases: [
      { input: '1 2', output: '3' },
      { input: '-5 8', output: '3' },
      { input: '0 0', output: '0' },
      { input: '-1000000000 1000000000', output: '0' },
      { input: '123456789 987654321', output: '1111111110' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\nconst a = Number(data[0]);\nconst b = Number(data[1]);\nconsole.log(a + b);\n",
      python: 'a, b = map(int, input().split())\nprint(a + b)\n',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    long long a, b;\n    if (!(cin >> a >> b)) return 0;\n    cout << a + b << endl;\n    return 0;\n}\n'
    },
    hint: '注意：不要输出「请输入」之类的提示语，判题只看标准输出。',
    version: 1
  },
  {
    id: 'code-two-sum',
    title: '两数之和（下标）',
    domain: 'algorithm',
    tags: ['数组', '哈希'],
    difficulty: 2,
    statement: '给定一个整数数组和一个目标值 target，请找出数组中和为 target 的两个数，输出它们的下标（从 0 开始，按从小到大输出）。\n\n数据保证有且仅有一组解，同一个元素不能使用两次。',
    inputFormat: '第一行两个整数 n 和 target（2 ≤ n ≤ 10^5）。\n第二行 n 个整数，用空格分隔。',
    outputFormat: '一行两个整数 i j（i < j），表示两个数的下标。',
    samples: [
      { input: '4 9\n2 7 11 15', output: '0 1', explain: 'nums[0] + nums[1] = 2 + 7 = 9' }
    ],
    testCases: [
      { input: '4 9\n2 7 11 15', output: '0 1' },
      { input: '3 6\n3 2 4', output: '1 2' },
      { input: '2 6\n3 3', output: '0 1' },
      { input: '5 0\n-3 4 3 90 -4', output: '0 2' },
      { input: '3 100\n20 50 80', output: '0 2' }
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [n, target] = lines[0].trim().split(/\\s+/).map(Number);\nconst nums = lines[1].trim().split(/\\s+/).map(Number);\n// TODO: 用哈希表记录「值 -> 下标」，边遍历边查 target - nums[i]\n",
      python: 'n, target = map(int, input().split())\nnums = list(map(int, input().split()))\n# TODO: 用字典记录「值 -> 下标」，边遍历边查 target - nums[i]\n'
    },
    hint: '暴力两重循环是 O(n²)，n=10^5 会超时；用哈希表做到 O(n)。',
    version: 1
  },
  {
    id: 'code-reverse-string',
    title: '反转字符串',
    domain: 'algorithm',
    tags: ['字符串', '双指针'],
    difficulty: 1,
    statement: '读入一行字符串，将其反转后输出。\n\n字符串可能包含空格与标点，长度不超过 10^5。',
    inputFormat: '一行字符串（不含换行）。',
    outputFormat: '一行，反转后的字符串。',
    samples: [
      { input: 'hello', output: 'olleh' },
      { input: 'a b c', output: 'c b a' }
    ],
    testCases: [
      { input: 'hello', output: 'olleh' },
      { input: 'a b c', output: 'c b a' },
      { input: '12345', output: '54321' },
      { input: 'AbC dEf', output: 'fEd CbA' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const s = require('fs').readFileSync(0, 'utf8').replace(/\\n$/, '');\nconsole.log(s.split('').reverse().join(''));\n",
      python: "s = input()\nprint(s[::-1])\n"
    },
    hint: '注意读入时不要丢掉行内的空格。',
    version: 1
  },
  {
    id: 'code-fib',
    title: '斐波那契数列',
    domain: 'algorithm',
    tags: ['动态规划', '递推'],
    difficulty: 2,
    statement: '斐波那契数列定义为：F(0) = 0，F(1) = 1，F(n) = F(n-1) + F(n-2)（n ≥ 2）。\n\n给定 n，输出 F(n)。结果对 1000000007 取模。',
    inputFormat: '一行一个整数 n（0 ≤ n ≤ 10^6）。',
    outputFormat: '一行一个整数，表示 F(n) mod 1000000007。',
    samples: [
      { input: '10', output: '55' },
      { input: '0', output: '0' }
    ],
    testCases: [
      { input: '10', output: '55' },
      { input: '0', output: '0' },
      { input: '1', output: '1' },
      { input: '20', output: '6765' },
      { input: '50', output: '586268941' }
    ],
    timeLimitMs: 1500,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const MOD = 1000000007n;\nconst n = Number(require('fs').readFileSync(0, 'utf8').trim());\n// TODO: 用两个变量滚动递推，避免递归爆栈\n",
      python: 'MOD = 1000000007\nn = int(input())\n# TODO: 用两个变量滚动递推，避免递归爆栈\n'
    },
    hint: 'n 可达 10^6，递归会栈溢出；用滚动变量 O(n) 递推，注意取模。',
    version: 1
  },
  {
    id: 'code-max-subarray',
    title: '最大子数组和',
    domain: 'algorithm',
    tags: ['数组', '动态规划'],
    difficulty: 3,
    statement: '给定一个长度为 n 的整数数组，请找出一个连续子数组，使其元素之和最大，输出这个最大和。\n\n子数组至少包含一个元素。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个整数，用空格分隔。',
    outputFormat: '一行一个整数，表示最大子数组和。',
    samples: [
      { input: '9\n-2 1 -3 4 -1 2 1 -5 4', output: '6', explain: '子数组 [4, -1, 2, 1] 的和为 6' }
    ],
    testCases: [
      { input: '9\n-2 1 -3 4 -1 2 1 -5 4', output: '6' },
      { input: '1\n-1', output: '-1' },
      { input: '5\n1 2 3 4 5', output: '15' },
      { input: '5\n-1 -2 -3 -4 -5', output: '-1' },
      { input: '6\n0 -1 0 -1 0 -1', output: '0' }
    ],
    timeLimitMs: 1500,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(lines[0]);\nconst nums = lines[1].trim().split(/\\s+/).map(Number);\n// TODO: Kadane 算法：cur = max(x, cur + x)\n",
      python: 'n = int(input())\nnums = list(map(int, input().split()))\n# TODO: Kadane 算法：cur = max(x, cur + x)\n'
    },
    hint: '全负数时答案不是 0，而是最大的那个负数；初值别写成 0。',
    version: 1
  },
  {
    id: 'code-brackets',
    title: '括号匹配',
    domain: 'algorithm',
    tags: ['栈', '字符串'],
    difficulty: 2,
    statement: '给定一个只包含 ( ) [ ] { } 的字符串，判断括号是否合法。\n\n合法的定义：每个左括号都有同类型的右括号与之匹配，且嵌套顺序正确。',
    inputFormat: '一行字符串（长度不超过 10^5）。',
    outputFormat: '合法输出 YES，否则输出 NO。',
    samples: [
      { input: '()[]{}', output: 'YES' },
      { input: '(]', output: 'NO' }
    ],
    testCases: [
      { input: '()[]{}', output: 'YES' },
      { input: '(]', output: 'NO' },
      { input: '{[()]}', output: 'YES' },
      { input: '([)]', output: 'NO' },
      { input: '(', output: 'NO' },
      { input: '()', output: 'YES' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const s = require('fs').readFileSync(0, 'utf8').trim();\n// TODO: 用栈，左括号入栈，右括号出栈比对\n",
      python: 's = input().strip()\n# TODO: 用栈，左括号入栈，右括号出栈比对\n'
    },
    hint: '别忘了最后检查栈是否为空。',
    version: 1
  },
  {
    id: 'code-dedupe',
    title: '数组去重（保序）',
    domain: 'algorithm',
    tags: ['数组', '哈希'],
    difficulty: 2,
    statement: '给定 n 个整数，去掉重复的元素，按每个元素首次出现的顺序输出。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个整数。',
    outputFormat: '一行若干个整数，用单个空格分隔，表示去重后的数组。',
    samples: [
      { input: '6\n1 2 1 3 2 4', output: '1 2 3 4' }
    ],
    testCases: [
      { input: '6\n1 2 1 3 2 4', output: '1 2 3 4' },
      { input: '3\n5 5 5', output: '5' },
      { input: '5\n-1 0 -1 0 2', output: '-1 0 2' },
      { input: '1\n7', output: '7' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(lines[0]);\nconst nums = lines[1].trim().split(/\\s+/).map(Number);\n// TODO: 用 Set 记录出现过的值，保持首次出现顺序\n",
      python: 'n = int(input())\nnums = list(map(int, input().split()))\n# TODO: 用 set 记录出现过的值，保持首次出现顺序\n'
    },
    hint: '输出末尾不要有多余空格（判题会去掉行尾空白，但保持干净更好）。',
    version: 1
  },
  {
    id: 'code-word-count',
    title: '出现次数最多的单词',
    domain: 'algorithm',
    tags: ['字符串', '哈希'],
    difficulty: 2,
    statement: '给定一行由空格分隔的单词，找出出现次数最多的单词，输出该单词和它的出现次数。\n\n如果出现次数相同，输出字典序最小的那个。',
    inputFormat: '一行字符串，由若干单词组成，单词之间用单个空格分隔（长度不超过 10^5）。',
    outputFormat: '一行，两个部分：单词与次数，用空格分隔。',
    samples: [
      { input: 'apple banana apple cherry banana apple', output: 'apple 3' }
    ],
    testCases: [
      { input: 'apple banana apple cherry banana apple', output: 'apple 3' },
      { input: 'a b c', output: 'a 1' },
      { input: 'x x y y', output: 'x 2' },
      { input: 'hello', output: 'hello 1' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const line = require('fs').readFileSync(0, 'utf8').trim();\nconst words = line.split(/\\s+/).filter(Boolean);\n// TODO: 统计次数，按次数降序、字典序升序取第一个\n",
      python: 'words = input().split()\n# TODO: 统计次数，按次数降序、字典序升序取第一个\n'
    },
    hint: '次数相同时要按字典序（不是出现顺序）取最小的。',
    version: 1
  },

  // ==========================================================
  //  第二批：Hot 100 高频题型（自命题，覆盖链表/树/DP/回溯/二分/滑动窗口/图）
  // ==========================================================
  {
    id: 'code-lc-reverse-list',
    title: '反转链表',
    domain: 'algorithm',
    tags: ['链表'],
    difficulty: 2,
    statement: '给定一个单链表，请输出反转后的链表。\n\n链表用数组形式给出：第一个数是长度 n，接下来 n 个数依次是节点的值（从表头到表尾）。',
    inputFormat: '第一行一个整数 n（0 ≤ n ≤ 10^5）。\n第二行 n 个整数，表示链表各节点的值。',
    outputFormat: '一行 n 个整数，表示反转后从表头到表尾的值。n = 0 时输出空行。',
    samples: [
      { input: '5\n1 2 3 4 5', output: '5 4 3 2 1' },
      { input: '1\n7', output: '7' }
    ],
    testCases: [
      { input: '5\n1 2 3 4 5', output: '5 4 3 2 1' },
      { input: '1\n7', output: '7' },
      { input: '3\n-1 0 1', output: '1 0 -1' },
      { input: '4\n2 2 3 3', output: '3 3 2 2' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst n=Number(L[0]);\nconst a=n?L[1].trim().split(/\\s+/).map(Number):[];\nconsole.log(a.reverse().join(' '));\n",
      python: 'n=int(input())\na=list(map(int,input().split())) if n else []\nprint(\' \'.join(map(str,a[::-1])))\n'
    },
    hint: '真实链表要用三个指针迭代反转；本题按数组输入，重点是把「表头表尾」的语义搞对。',
    version: 1
  },
  {
    id: 'code-lc-merge-sorted',
    title: '合并两个有序数组',
    domain: 'algorithm',
    tags: ['数组', '双指针'],
    difficulty: 2,
    statement: '给定两个按非递减顺序排列的整数数组，将它们合并为一个仍然有序的数组并输出。',
    inputFormat: '第一行两个整数 n、m（0 ≤ n, m ≤ 10^5）。\n第二行 n 个整数，非递减。\n第三行 m 个整数，非递减。',
    outputFormat: '一行 n+m 个整数，用空格分隔。',
    samples: [
      { input: '3 3\n1 3 5\n2 4 6', output: '1 2 3 4 5 6' }
    ],
    testCases: [
      { input: '3 3\n1 3 5\n2 4 6', output: '1 2 3 4 5 6' },
      { input: '1 1\n1\n2', output: '1 2' },
      { input: '3 2\n1 2 3\n4 5', output: '1 2 3 4 5' },
      { input: '2 3\n-5 0\n-3 1 9', output: '-5 -3 0 1 9' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst [n,m]=L[0].trim().split(/\\s+/).map(Number);\nconst a=n?L[1].trim().split(/\\s+/).map(Number):[];\nconst b=m?L[2].trim().split(/\\s+/).map(Number):[];\n// TODO: 双指针归并\n",
      python: 'n,m=map(int,input().split())\na=list(map(int,input().split())) if n else []\nb=list(map(int,input().split())) if m else []\n# TODO: 双指针归并\n'
    },
    hint: '面试里常考「从后往前填」的原地版本，这里输出新数组即可。',
    version: 1
  },
  {
    id: 'code-lc-remove-dup',
    title: '删除有序数组中的重复项',
    domain: 'algorithm',
    tags: ['数组', '双指针'],
    difficulty: 2,
    statement: '给定一个非递减排列的整数数组，原地删除重复元素，使每个元素只出现一次，输出处理后的数组。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个整数，非递减。',
    outputFormat: '一行若干个整数，用空格分隔。',
    samples: [
      { input: '3\n1 1 2', output: '1 2' },
      { input: '5\n0 0 1 1 2', output: '0 1 2' }
    ],
    testCases: [
      { input: '3\n1 1 2', output: '1 2' },
      { input: '5\n0 0 1 1 2', output: '0 1 2' },
      { input: '1\n5', output: '5' },
      { input: '6\n-2 -2 -1 0 0 0', output: '-2 -1 0' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst n=Number(L[0]);\nconst a=L[1].trim().split(/\\s+/).map(Number);\n// TODO: 快慢指针，原地覆盖\n",
      python: 'n=int(input())\na=list(map(int,input().split()))\n# TODO: 快慢指针，原地覆盖\n'
    },
    hint: '有序数组的重复项一定相邻，快慢指针 O(n) 即可。',
    version: 1
  },
  {
    id: 'code-lc-tree-depth',
    title: '二叉树的最大深度',
    domain: 'algorithm',
    tags: ['树', 'dfs'],
    difficulty: 2,
    statement: '给定一棵二叉树，求其最大深度（根节点到最远叶子节点的节点数）。\n\n二叉树用层序数组表示，空节点用 -1 表示，末尾的连续 -1 可以省略。例如 [3,9,20,-1,-1,15,7] 表示根 3，左子 9，右子 20，20 的左右子分别是 15 和 7。',
    inputFormat: '第一行一个整数 n，表示层序数组长度（1 ≤ n ≤ 10^4）。\n第二行 n 个整数，-1 表示空节点。',
    outputFormat: '一行一个整数，表示最大深度。',
    samples: [
      { input: '7\n3 9 20 -1 -1 15 7', output: '3' },
      { input: '2\n1 -1', output: '1' }
    ],
    testCases: [
      { input: '7\n3 9 20 -1 -1 15 7', output: '3' },
      { input: '2\n1 -1', output: '1' },
      { input: '1\n0', output: '1' },
      { input: '9\n1 2 3 4 -1 -1 5 6 -1', output: '4' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst n=Number(L[0]);\nconst a=L[1].trim().split(/\\s+/).map(Number);\n// TODO: 层序建树后递归求深度，或直接按层序下标推导\n",
      python: 'n=int(input())\na=list(map(int,input().split()))\n# TODO: 层序建树后递归求深度\n'
    },
    hint: 'n 可达 10^4，递归深度可能较深；也可以按「节点下标 → 父下标」迭代算深度。',
    version: 1
  },
  {
    id: 'code-lc-inorder',
    title: '二叉树的中序遍历',
    domain: 'algorithm',
    tags: ['树', '栈'],
    difficulty: 2,
    statement: '给定一棵二叉树（层序数组表示，-1 为空），输出它的中序遍历序列。',
    inputFormat: '第一行一个整数 n。\n第二行 n 个整数，-1 表示空节点。',
    outputFormat: '一行若干个整数，用空格分隔。',
    samples: [
      { input: '7\n1 -1 2 -1 -1 3 -1', output: '1 3 2' }
    ],
    testCases: [
      { input: '7\n1 -1 2 -1 -1 3 -1', output: '1 3 2' },
      { input: '1\n1', output: '1' },
      { input: '3\n2 1 3', output: '1 2 3' },
      { input: '7\n3 9 20 -1 -1 15 7', output: '9 3 15 20 7' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst n=Number(L[0]);\nconst a=L[1].trim().split(/\\s+/).map(Number);\n// TODO: 中序 = 左 → 根 → 右\n",
      python: 'n=int(input())\na=list(map(int,input().split()))\n# TODO: 中序 = 左 → 根 → 右\n'
    },
    hint: '注意「空节点也占数组位置」，建树时要按层序下标严格对应。',
    version: 1
  },
  {
    id: 'code-lc-climb-stairs',
    title: '爬楼梯',
    domain: 'algorithm',
    tags: ['动态规划'],
    difficulty: 2,
    statement: '假设你正在爬楼梯，需要 n 阶才能到达楼顶。每次你可以爬 1 或 2 个台阶，问有多少种不同的方法可以爬到楼顶。',
    inputFormat: '一行一个整数 n（1 ≤ n ≤ 45）。',
    outputFormat: '一行一个整数，表示方法数。',
    samples: [
      { input: '2', output: '2', explain: '1+1 或 2' },
      { input: '3', output: '3', explain: '1+1+1、1+2、2+1' }
    ],
    testCases: [
      { input: '1', output: '1' },
      { input: '2', output: '2' },
      { input: '3', output: '3' },
      { input: '10', output: '89' },
      { input: '45', output: '1836311903' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const n=Number(require('fs').readFileSync(0,'utf8').trim());\n// TODO: f(n)=f(n-1)+f(n-2)\n",
      python: 'n=int(input())\n# TODO: f(n)=f(n-1)+f(n-2)\n'
    },
    hint: '本质是斐波那契；n ≤ 45 时结果在 32 位整数范围内。',
    version: 1
  },
  {
    id: 'code-lc-coin-change',
    title: '零钱兑换',
    domain: 'algorithm',
    tags: ['动态规划'],
    difficulty: 3,
    statement: '给定不同面额的硬币和一个总金额，计算凑成该金额所需的最少硬币个数。如果无法凑出，输出 -1。\n\n每种硬币的数量不限。',
    inputFormat: '第一行两个整数 amount 和 n（0 ≤ amount ≤ 10^4，1 ≤ n ≤ 12）。\n第二行 n 个整数，表示硬币面额。',
    outputFormat: '一行一个整数，表示最少硬币数或 -1。',
    samples: [
      { input: '11 3\n1 2 5', output: '3', explain: '5 + 5 + 1' },
      { input: '3 1\n2', output: '-1' }
    ],
    testCases: [
      { input: '11 3\n1 2 5', output: '3' },
      { input: '3 1\n2', output: '-1' },
      { input: '0 1\n1', output: '0' },
      { input: '27 3\n2 5 10', output: '4' },
      { input: '100 4\n1 5 10 25', output: '4' }
    ],
    timeLimitMs: 1500,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst [amount,n]=L[0].trim().split(/\\s+/).map(Number);\nconst coins=L[1].trim().split(/\\s+/).map(Number);\n// TODO: dp[i] = min(dp[i], dp[i-c]+1)\n",
      python: 'amount,n=map(int,input().split())\ncoins=list(map(int,input().split()))\n# TODO: dp[i] = min(dp[i], dp[i-c]+1)\n'
    },
    hint: 'dp 初值用 amount+1 表示「不可达」，最后判断 dp[amount] 是否仍是它。',
    version: 1
  },
  {
    id: 'code-lc-lis',
    title: '最长递增子序列',
    domain: 'algorithm',
    tags: ['动态规划', '二分'],
    difficulty: 3,
    statement: '给定一个整数数组，求最长严格递增子序列的长度。\n\n子序列不要求连续，但元素的相对顺序必须保持不变。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个整数。',
    outputFormat: '一行一个整数，表示最长递增子序列长度。',
    samples: [
      { input: '8\n10 9 2 5 3 7 101 18', output: '4', explain: '2, 3, 7, 101 或 2, 3, 7, 18' }
    ],
    testCases: [
      { input: '8\n10 9 2 5 3 7 101 18', output: '4' },
      { input: '6\n0 1 0 3 2 3', output: '4' },
      { input: '7\n7 7 7 7 7 7 7', output: '1' },
      { input: '1\n5', output: '1' },
      { input: '5\n1 2 3 4 5', output: '5' }
    ],
    timeLimitMs: 1500,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst n=Number(L[0]);\nconst a=L[1].trim().split(/\\s+/).map(Number);\n// TODO: O(n^2) 会超时（n=1e5），用「贪心 + 二分」（tails 数组）\n",
      python: 'import bisect\nn=int(input())\na=list(map(int,input().split()))\n# TODO: O(n^2) 会超时，用 tails 数组 + bisect_left\n'
    },
    hint: 'tails[i] 表示长度为 i+1 的递增子序列的最小结尾值；用二分替换，整体 O(n log n)。',
    version: 1
  },
  {
    id: 'code-lc-knapsack',
    title: '01 背包',
    domain: 'algorithm',
    tags: ['动态规划'],
    difficulty: 3,
    statement: '有 n 件物品和一个容量为 W 的背包。第 i 件物品的重量是 w[i]，价值是 v[i]，每件物品最多取一次。求背包能装下的最大总价值。',
    inputFormat: '第一行两个整数 n 和 W（1 ≤ n ≤ 1000，1 ≤ W ≤ 10000）。\n接下来 n 行，每行两个整数 w[i] 和 v[i]。',
    outputFormat: '一行一个整数，表示最大总价值。',
    samples: [
      { input: '4 5\n1 2\n2 4\n3 4\n4 5', output: '8', explain: '选前两件（重量 3）价值 6 不如选 1+2+3（重量 6 超了）；最优是 2+3 两件：重量 5，价值 8' }
    ],
    testCases: [
      { input: '4 5\n1 2\n2 4\n3 4\n4 5', output: '8' },
      { input: '1 1\n2 100', output: '0' },
      { input: '3 10\n5 10\n5 10\n5 10', output: '20' },
      { input: '2 3\n1 1\n2 3', output: '4' }
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst [n,W]=L[0].trim().split(/\\s+/).map(Number);\n// TODO: 一维 dp，容量从大到小遍历（保证每件只取一次）\n",
      python: 'n,W=map(int,input().split())\nitems=[tuple(map(int,input().split())) for _ in range(n)]\n# TODO: 一维 dp，容量从大到小遍历\n'
    },
    hint: '一维数组写法里容量必须**倒序**遍历，否则同一件物品会被重复放入（那就成了完全背包）。',
    version: 1
  },
  {
    id: 'code-lc-permute',
    title: '全排列',
    domain: 'algorithm',
    tags: ['回溯'],
    difficulty: 3,
    statement: '给定一个整数 n，输出 1 到 n 的所有排列，按字典序升序，每个排列占一行，数字之间用空格分隔。',
    inputFormat: '一行一个整数 n（1 ≤ n ≤ 6）。',
    outputFormat: '共 n! 行，每行一个排列。',
    samples: [
      { input: '3', output: '1 2 3\n1 3 2\n2 1 3\n2 3 1\n3 1 2\n3 2 1' }
    ],
    testCases: [
      { input: '1', output: '1' },
      { input: '2', output: '1 2\n2 1' },
      { input: '3', output: '1 2 3\n1 3 2\n2 1 3\n2 3 1\n3 1 2\n3 2 1' }
    ],
    timeLimitMs: 1500,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const n=Number(require('fs').readFileSync(0,'utf8').trim());\n// TODO: 回溯 + used 数组；按 1..n 顺序枚举天然就是字典序\n",
      python: 'n=int(input())\n# TODO: 回溯 + used 数组；按 1..n 顺序枚举天然就是字典序\n'
    },
    hint: '按 1..n 顺序尝试，得到的自然就是字典序，不需要额外排序。',
    version: 1
  },
  {
    id: 'code-lc-binary-search',
    title: '二分查找',
    domain: 'algorithm',
    tags: ['二分'],
    difficulty: 2,
    statement: '给定一个升序排列的整数数组和一个目标值 target，返回 target 的下标；不存在则输出 -1。\n\n要求时间复杂度 O(log n)。',
    inputFormat: '第一行两个整数 n 和 target（1 ≤ n ≤ 10^5）。\n第二行 n 个整数，严格升序。',
    outputFormat: '一行一个整数，表示下标（从 0 开始）或 -1。',
    samples: [
      { input: '6 9\n-1 0 3 5 9 12', output: '4' },
      { input: '6 2\n-1 0 3 5 9 12', output: '-1' }
    ],
    testCases: [
      { input: '6 9\n-1 0 3 5 9 12', output: '4' },
      { input: '6 2\n-1 0 3 5 9 12', output: '-1' },
      { input: '1 5\n5', output: '0' },
      { input: '5 1\n1 2 3 4 5', output: '0' },
      { input: '5 5\n1 2 3 4 5', output: '4' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst [n,target]=L[0].trim().split(/\\s+/).map(Number);\nconst a=L[1].trim().split(/\\s+/).map(Number);\n// TODO: left/right 闭区间二分\n",
      python: 'n,target=map(int,input().split())\na=list(map(int,input().split()))\n# TODO: left/right 闭区间二分\n'
    },
    hint: '注意 while 条件和 mid 更新方式，写错会死循环。',
    version: 1
  },
  {
    id: 'code-lc-longest-substr',
    title: '无重复字符的最长子串',
    domain: 'algorithm',
    tags: ['滑动窗口', '字符串'],
    difficulty: 3,
    statement: '给定一个字符串，找出其中不含重复字符的最长子串的长度。',
    inputFormat: '一行字符串（长度 ≤ 10^5，可能包含字母、数字、符号与空格）。',
    outputFormat: '一行一个整数，表示最长无重复子串的长度。',
    samples: [
      { input: 'abcabcbb', output: '3', explain: '最长的是 abc' },
      { input: 'bbbbb', output: '1' },
      { input: 'pwwkew', output: '3', explain: 'wke' }
    ],
    testCases: [
      { input: 'abcabcbb', output: '3' },
      { input: 'bbbbb', output: '1' },
      { input: 'pwwkew', output: '3' },
      { input: 'a', output: '1' },
      { input: 'abba', output: '2' }
    ],
    timeLimitMs: 1500,
    memoryLimitMb: 128,
    starterCode: {
      javascript: "const s=require('fs').readFileSync(0,'utf8').replace(/\\n$/,'');\n// TODO: 滑动窗口 + 记录字符最后出现位置\n",
      python: 's=input()\n# TODO: 滑动窗口 + 字典记录字符最后出现位置\n'
    },
    hint: '左指针要跳到「重复字符上次出现位置 + 1」，不能简单加一，否则 abba 会算错。',
    version: 1
  },
  {
    id: 'code-lc-merge-intervals',
    title: '合并区间',
    domain: 'algorithm',
    tags: ['数组', '排序'],
    difficulty: 3,
    statement: '给定若干个区间 [l, r]，合并所有重叠的区间，按左端点升序输出合并后的结果。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n接下来 n 行，每行两个整数 l、r（l ≤ r）。',
    outputFormat: '第一行一个整数 m，表示合并后的区间数。\n接下来 m 行，每行两个整数，表示合并后的区间。',
    samples: [
      { input: '4\n1 3\n2 6\n8 10\n15 18', output: '3\n1 6\n8 10\n15 18' }
    ],
    testCases: [
      { input: '4\n1 3\n2 6\n8 10\n15 18', output: '3\n1 6\n8 10\n15 18' },
      { input: '2\n1 4\n4 5', output: '1\n1 5' },
      { input: '1\n1 1', output: '1\n1 1' },
      { input: '3\n5 7\n1 2\n3 4', output: '3\n1 2\n3 4\n5 7' }
    ],
    timeLimitMs: 1500,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst n=Number(L[0]);\nconst seg=L.slice(1,1+n).map(s=>s.trim().split(/\\s+/).map(Number));\n// TODO: 按左端点排序，再线性合并（注意相邻端点相等也算重叠）\n",
      python: 'n=int(input())\nseg=[tuple(map(int,input().split())) for _ in range(n)]\n# TODO: 按左端点排序，再线性合并\n'
    },
    hint: '端点相等（如 [1,4] 与 [4,5]）也算重叠；输入顺序不保证有序，必须先排序。',
    version: 1
  },
  {
    id: 'code-lc-islands',
    title: '岛屿数量',
    domain: 'algorithm',
    tags: ['图', 'dfs', 'bfs'],
    difficulty: 3,
    statement: '给定一个由 "0"（水）和 "1"（陆地）组成的网格，计算岛屿的数量。\n\n岛屿由上下左右相邻的陆地连接而成，斜向不算相邻。',
    inputFormat: '第一行两个整数 n、m（1 ≤ n, m ≤ 500）。\n接下来 n 行，每行一个长度为 m 的 01 字符串。',
    outputFormat: '一行一个整数，表示岛屿数量。',
    samples: [
      { input: '4 5\n11000\n11000\n00100\n00011', output: '3' }
    ],
    testCases: [
      { input: '4 5\n11000\n11000\n00100\n00011', output: '3' },
      { input: '1 1\n1', output: '1' },
      { input: '1 1\n0', output: '0' },
      { input: '3 3\n111\n111\n111', output: '1' },
      { input: '2 2\n10\n01', output: '2' }
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');\nconst [n,m]=L[0].trim().split(/\\s+/).map(Number);\nconst g=L.slice(1,1+n).map(r=>r.trim().split(''));\n// TODO: 遍历每个格子，遇到 1 就计数并 DFS/BFS 把整块淹掉\n",
      python: 'n,m=map(int,input().split())\ng=[list(input().strip()) for _ in range(n)]\n# TODO: 遍历每个格子，遇到 1 就计数并 DFS/BFS\n'
    },
    hint: 'DFS 递归深度最坏可达 n*m，可能爆栈；用显式栈或 BFS 更稳。',
    version: 1
  },
  {
    id: 'code-lc-edit-distance',
    title: '编辑距离',
    domain: 'algorithm',
    tags: ['动态规划', '字符串'],
    difficulty: 4,
    statement: '给定两个单词 word1 和 word2，计算把 word1 转换成 word2 所需的最少操作数。\n\n允许的操作：插入一个字符、删除一个字符、替换一个字符。',
    inputFormat: '第一行一个字符串 word1。\n第二行一个字符串 word2。（长度均 ≤ 500）',
    outputFormat: '一行一个整数，表示最少操作数。',
    samples: [
      { input: 'horse\nros', output: '3', explain: 'horse → rorse（替换）→ rose（删除）→ ros（删除）' },
      { input: 'intention\nexecution', output: '5' }
    ],
    testCases: [
      { input: 'horse\nros', output: '3' },
      { input: 'intention\nexecution', output: '5' },
      { input: 'abc\nabc', output: '0' },
      { input: '\nabc', output: '3' },
      { input: 'a\nb', output: '1' }
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L=require('fs').readFileSync(0,'utf8').split('\\n');\nconst a=(L[0]||'').replace(/\\r$/,'');\nconst b=(L[1]||'').replace(/\\r$/,'');\n// TODO: dp[i][j] 表示 a 前 i 个字符变成 b 前 j 个字符的最少操作数\n",
      python: "lines=open(0).read().split('\\n')\na=lines[0].rstrip('\\r')\nb=lines[1].rstrip('\\r') if len(lines)>1 else ''\n# TODO: dp[i][j]\n"
    },
    hint: '空串的情况要特殊处理：一行可能完全没有内容，读入时不要用 trim 把整段吞掉。',
    version: 1
  }
];

// ============================================================
//  C++ 起始骨架：读入部分写好，核心逻辑留 TODO。
//  单独放一张表、最后合并进题库，避免把每道题的对象撑得太长。
// ============================================================
const CPP_STARTERS: Record<string, string> = {
  'code-two-sum': `#include <iostream>
#include <vector>
#include <unordered_map>
using namespace std;

int main() {
    int n;
    long long target;
    cin >> n >> target;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // TODO: 用哈希表记录「值 -> 下标」，边遍历边查 target - a[i]
    // 找到后输出两个下标（小的在前），记得 return

    return 0;
}
`,
  'code-reverse-string': `#include <iostream>
#include <string>
#include <algorithm>
using namespace std;

int main() {
    string s;
    getline(cin, s);

    // TODO: 反转 s 并输出

    return 0;
}
`,
  'code-fib': `#include <iostream>
using namespace std;

const long long MOD = 1000000007LL;

int main() {
    int n;
    cin >> n;

    // TODO: 两个变量滚动递推，避免递归爆栈
    // 注意每步都对 MOD 取模

    return 0;
}
`,
  'code-max-subarray': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // TODO: Kadane：cur = max(a[i], cur + a[i])
    // 初值不能写成 0（全负数时答案是最大那个负数）

    return 0;
}
`,
  'code-brackets': `#include <iostream>
#include <string>
#include <stack>
using namespace std;

int main() {
    string s;
    cin >> s;

    // TODO: 左括号入栈，右括号出栈比对，最后栈必须为空

    return 0;
}
`,
  'code-dedupe': `#include <iostream>
#include <vector>
#include <unordered_set>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // TODO: 用 set 记录出现过的值，保持首次出现顺序输出

    return 0;
}
`,
  'code-word-count': `#include <iostream>
#include <string>
#include <sstream>
#include <unordered_map>
using namespace std;

int main() {
    string line;
    getline(cin, line);
    istringstream iss(line);
    string w;
    unordered_map<string, int> cnt;
    while (iss >> w) cnt[w]++;

    // TODO: 找次数最多的；次数相同时取字典序最小

    return 0;
}
`,
  'code-lc-reverse-list': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // TODO: 反转后按空格输出（真实链表要用三指针迭代）

    return 0;
}
`,
  'code-lc-merge-sorted': `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n, m;
    cin >> n >> m;
    vector<long long> a(n), b(m);
    for (auto &x : a) cin >> x;
    for (auto &x : b) cin >> x;

    // TODO: 双指针归并，输出合并后的数组

    return 0;
}
`,
  'code-lc-remove-dup': `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // TODO: 快慢指针原地去重（有序数组重复项一定相邻）

    return 0;
}
`,
  'code-lc-tree-depth': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // 层序数组：节点 i 的左子 2i+1、右子 2i+2，-1 表示空
    // TODO: 递归求深度，注意 n 可达 1e4

    return 0;
}
`,
  'code-lc-inorder': `#include <iostream>
#include <vector>
using namespace std;

int n;
vector<long long> a;
vector<long long> out;

// TODO: 写一个中序遍历（左 → 根 → 右），把结果 push 进 out

int main() {
    cin >> n;
    a.resize(n);
    for (auto &x : a) cin >> x;

    // TODO: 从根（下标 0）开始遍历，最后按空格输出 out

    return 0;
}
`,
  'code-lc-climb-stairs': `#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;

    // TODO: f(n) = f(n-1) + f(n-2)，f(1)=1, f(2)=2

    return 0;
}
`,
  'code-lc-coin-change': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int amount, n;
    cin >> amount >> n;
    vector<int> coins(n);
    for (auto &c : coins) cin >> c;

    // TODO: dp[i] = 凑出 i 的最少硬币数，初值用 amount+1 表示不可达

    return 0;
}
`,
  'code-lc-lis': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // TODO: n 可达 1e5，O(n^2) 会超时
    // 用 tails 数组 + lower_bound 做到 O(n log n)

    return 0;
}
`,
  'code-lc-knapsack': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n, W;
    cin >> n >> W;

    // TODO: 一维 dp，容量必须**倒序**遍历（保证每件只取一次）
    vector<long long> dp(W + 1, 0);
    for (int i = 0; i < n; i++) {
        int w, v;
        cin >> w >> v;
        // TODO: for (int j = W; j >= w; j--) dp[j] = max(dp[j], dp[j-w]+v);
    }

    // cout << dp[W] << endl;
    return 0;
}
`,
  'code-lc-permute': `#include <iostream>
#include <vector>
using namespace std;

int n;
vector<int> cur;
vector<bool> used;

// TODO: 回溯，按 1..n 顺序枚举天然就是字典序

int main() {
    cin >> n;
    used.assign(n + 1, false);

    // TODO: 输出所有排列，每行一个

    return 0;
}
`,
  'code-lc-binary-search': `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n;
    long long target;
    cin >> n >> target;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    // TODO: 闭区间二分，注意 while 条件和 mid 更新，写错会死循环

    return 0;
}
`,
  'code-lc-longest-substr': `#include <iostream>
#include <string>
#include <unordered_map>
#include <algorithm>
using namespace std;

int main() {
    string s;
    getline(cin, s);

    // TODO: 滑动窗口，左指针跳到「重复字符上次位置 + 1」
    // 不能简单加一，否则 abba 会算错

    return 0;
}
`,
  'code-lc-merge-intervals': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<pair<int, int>> seg(n);
    for (auto &p : seg) cin >> p.first >> p.second;

    // TODO: 按左端点排序后线性合并（端点相等也算重叠）
    // 输出格式：第一行合并后区间数，之后每行一个区间

    return 0;
}
`,
  'code-lc-islands': `#include <iostream>
#include <vector>
#include <string>
using namespace std;

int main() {
    int n, m;
    cin >> n >> m;
    vector<string> g(n);
    for (auto &row : g) cin >> row;

    // TODO: 遍历每个格子，遇到 '1' 就计数并 DFS/BFS 把整块淹掉
    // 建议用显式栈，避免递归爆栈

    return 0;
}
`,
  'code-lc-edit-distance': `#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    string a, b;
    getline(cin, a);
    getline(cin, b);

    int m = a.size(), n = b.size();
    vector<vector<int>> dp(m + 1, vector<int>(n + 1, 0));

    // TODO: dp[i][j] 表示 a 前 i 个字符变成 b 前 j 个字符的最少操作数
    // 边界：dp[i][0]=i、dp[0][j]=j

    return 0;
}
`
};

// 第二批题库：单调栈 / 并查集 / Trie / 前缀和 / 位运算 / 双指针进阶
// 单独放文件，避免本文件无限膨胀；合并后再走同一套 C++ 骨架补齐逻辑
CODE_BANK.push(...EXTRA_CODE_BANK);

// 合并 C++ 起始代码（不覆盖已有显式定义的）
CODE_BANK.forEach((item) => {
  const starter = CPP_STARTERS[item.id];
  if (starter && !(item.starterCode && item.starterCode.cpp)) {
    item.starterCode = Object.assign({}, item.starterCode, { cpp: starter });
  }
});

export const CODE_MAP: Map<string, CodeQuestion> = new Map(CODE_BANK.map((q) => [q.id, q]));

export function getCodeQuestion(id: string): CodeQuestion | null {
  return CODE_MAP.get(id) || null;
}

/** 下发给渲染层的题目：剥掉隐藏用例 */
export function publicCodeQuestion(q: CodeQuestion) {
  return {
    id: q.id,
    title: q.title,
    domain: q.domain,
    tags: q.tags,
    difficulty: q.difficulty,
    statement: q.statement,
    inputFormat: q.inputFormat,
    outputFormat: q.outputFormat,
    samples: q.samples,
    timeLimitMs: q.timeLimitMs,
    memoryLimitMb: q.memoryLimitMb,
    starterCode: q.starterCode,
    hint: q.hint,
    version: q.version
  };
}
