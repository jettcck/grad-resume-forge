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
      python: 'a, b = map(int, input().split())\nprint(a + b)\n'
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
  }
];

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
