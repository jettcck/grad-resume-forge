// ============================================================
//  编程题库 · 第二批（20 道）
//
//  覆盖 Hot 100 里此前没考到的六类高频考点：
//  单调栈 / 并查集 / Trie / 前缀和 / 位运算 / 双指针进阶
//
//  约定与 code-bank.ts 一致：
//  - 题面与用例全部自命题（LeetCode 题面有版权，不搬运原文）；
//  - 每题 samples 必须包含在 testCases 里（test-code 会断言）；
//  - starterCode 三语言都给「读入写好、核心留 TODO」的骨架，
//    保证点「运行样例」不会编译失败/直接崩。
// ============================================================
import type { CodeQuestion } from './types';

export const EXTRA_CODE_BANK: CodeQuestion[] = [
  // ---------------- 单调栈 ----------------
  {
    id: 'code-lc-daily-temperatures',
    title: '每日温度',
    domain: 'backend',
    tags: ['单调栈', '数组'],
    difficulty: 2,
    statement: '给定连续若干天的气温，请对每一天算出：还要等几天才会出现更高的气温。\n\n如果之后都不会更高，该位置填 0。要求整体 O(n)，不要对每天都往后扫一遍。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个整数，表示每天气温（-50 ≤ t ≤ 100），空格分隔。',
    outputFormat: '一行 n 个整数，空格分隔，表示每天需要等待的天数。',
    samples: [
      { input: '8\n73 74 75 71 69 72 76 73', output: '1 1 4 2 1 1 0 0', explain: '第 3 天（75）要等 4 天到 76；最后两天之后没有更高温，填 0。' }
    ],
    testCases: [
      { input: '8\n73 74 75 71 69 72 76 73', output: '1 1 4 2 1 1 0 0' },
      { input: '1\n30', output: '0' },
      { input: '4\n30 40 50 60', output: '1 1 1 0' },
      { input: '4\n90 80 70 60', output: '0 0 0 0' },
      { input: '4\n30 60 90 120', output: '1 1 1 0' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(L[0]);\nconst t = L[1].trim().split(/\\s+/).map(Number);\nconst ans = new Array(n).fill(0);\n// TODO: 维护一个「气温递减」的下标栈，遇到更高温就弹出并结算\nconsole.log(ans.join(' '));\n",
      python: "n = int(input())\nt = list(map(int, input().split()))\nans = [0] * n\n# TODO: 单调栈，存下标\nprint(' '.join(map(str, ans)))\n",
      cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<int> t(n);
    for (auto &x : t) cin >> x;
    vector<int> ans(n, 0);
    vector<int> st;  // TODO: 维护下标栈
    for (int i = 0; i < n; i++) {
        while (!st.empty() && t[st.back()] < t[i]) {
            ans[st.back()] = i - st.back();
            st.pop_back();
        }
        st.push_back(i);
    }
    for (int i = 0; i < n; i++) {
        if (i) cout << " ";
        cout << ans[i];
    }
    cout << endl;
    return 0;
}
`
    },
    hint: '栈里存下标而不是气温：弹出时用「当前下标 - 栈顶下标」直接得到天数。',
    version: 1
  },
  {
    id: 'code-lc-largest-rectangle',
    title: '柱状图中最大的矩形',
    domain: 'backend',
    tags: ['单调栈', '数组'],
    difficulty: 3,
    statement: '给定 n 根相邻的柱子高度（宽度都为 1），求这些柱子能拼出的最大矩形面积。\n\n矩形必须由连续的一段柱子构成，高度取这段里最矮的那根。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个非负整数，表示柱子高度（0 ≤ h ≤ 10^4），空格分隔。',
    outputFormat: '一行一个整数，表示最大矩形面积。',
    samples: [
      { input: '6\n2 1 5 6 2 3', output: '10', explain: '取第 3、4 根（高 5、6），高度 5、宽 2，面积 10。' }
    ],
    testCases: [
      { input: '6\n2 1 5 6 2 3', output: '10' },
      { input: '2\n2 4', output: '4' },
      { input: '1\n5', output: '5' },
      { input: '5\n1 1 1 1 1', output: '5' },
      { input: '5\n4 2 0 3 2', output: '4' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst h = L[1].trim().split(/\\s+/).map(Number);\nlet best = 0;\n// TODO: 单调递增栈；弹出时用 (i - 栈顶前一个下标 - 1) 作宽度\nconsole.log(best);\n",
      python: "n = int(input())\nh = list(map(int, input().split()))\nbest = 0\n# TODO: 单调递增栈\nprint(best)\n",
      cpp: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> h(n);
    for (auto &x : h) cin >> x;
    long long best = 0;
    vector<int> st;  // TODO: 存下标，保持高度递增；末尾补一个 0 便于清空
    for (int i = 0; i <= n; i++) {
        long long cur = (i == n) ? 0 : h[i];
        while (!st.empty() && h[st.back()] > cur) {
            long long height = h[st.back()];
            st.pop_back();
            int left = st.empty() ? -1 : st.back();
            best = max(best, height * (i - left - 1));
        }
        st.push_back(i);
    }
    cout << best << endl;
    return 0;
}
`
    },
    hint: '在数组末尾虚拟一根高度 0 的柱子，循环到 n 时能把栈里剩下的全部结算掉，省掉一轮收尾。',
    version: 1
  },
  {
    id: 'code-lc-sliding-window-max',
    title: '滑动窗口最大值',
    domain: 'backend',
    tags: ['单调队列', '滑动窗口'],
    difficulty: 3,
    statement: '给定长度为 n 的数组和一个窗口大小 k，窗口从最左端开始每次右移一位。\n\n请输出每个窗口内的最大值。要求 O(n)，不要每个窗口都重新扫一遍。',
    inputFormat: '第一行两个整数 n、k（1 ≤ k ≤ n ≤ 10^5）。\n第二行 n 个整数（-10^4 ≤ a ≤ 10^4），空格分隔。',
    outputFormat: '一行 n-k+1 个整数，空格分隔，依次是每个窗口的最大值。',
    samples: [
      { input: '8 3\n1 3 -1 -3 5 3 6 7', output: '3 3 5 5 6 7', explain: '窗口依次是 [1,3,-1] [3,-1,-3] [-1,-3,5] [-3,5,3] [5,3,6] [3,6,7]。' }
    ],
    testCases: [
      { input: '8 3\n1 3 -1 -3 5 3 6 7', output: '3 3 5 5 6 7' },
      { input: '1 1\n1', output: '1' },
      { input: '5 1\n4 2 9 1 5', output: '4 2 9 1 5' },
      { input: '5 5\n1 2 3 4 5', output: '5' },
      { input: '6 2\n9 8 7 6 5 4', output: '9 8 7 6 5' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [n, k] = L[0].trim().split(/\\s+/).map(Number);\nconst a = L[1].trim().split(/\\s+/).map(Number);\nconst out = [];\n// TODO: 单调队列（存下标，队首是当前窗口最大值）\nconsole.log(out.join(' '));\n",
      python: "from collections import deque\nn, k = map(int, input().split())\na = list(map(int, input().split()))\nout = []\n# TODO: deque 存下标，保持值递减\nprint(' '.join(map(str, out)))\n",
      cpp: `#include <iostream>
#include <vector>
#include <deque>
using namespace std;

int main() {
    int n, k;
    if (!(cin >> n >> k)) return 0;
    vector<int> a(n);
    for (auto &x : a) cin >> x;
    deque<int> dq;  // TODO: 存下标，值递减
    vector<int> out;
    for (int i = 0; i < n; i++) {
        while (!dq.empty() && a[dq.back()] <= a[i]) dq.pop_back();
        dq.push_back(i);
        if (dq.front() <= i - k) dq.pop_front();
        if (i >= k - 1) out.push_back(a[dq.front()]);
    }
    for (size_t i = 0; i < out.size(); i++) {
        if (i) cout << " ";
        cout << out[i];
    }
    cout << endl;
    return 0;
}
`
    },
    hint: '队首出队的条件是「下标 ≤ i-k」，不是「值比新元素小」——两件事别混在一起。',
    version: 1
  },

  // ---------------- 并查集 ----------------
  {
    id: 'code-lc-provinces',
    title: '省份数量',
    domain: 'backend',
    tags: ['并查集', '图'],
    difficulty: 2,
    statement: '有 n 个城市，给出它们之间的直接相连关系（矩阵中 1 表示相连，且关系对称）。\n\n相连关系可以传递：A 连 B、B 连 C，则 A、B、C 属于同一个省份。求一共有多少个省份。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 200）。\n接下来 n 行，每行 n 个 0/1 整数，空格分隔，表示连接矩阵。',
    outputFormat: '一行一个整数，表示省份数量。',
    samples: [
      { input: '3\n1 1 0\n1 1 0\n0 0 1', output: '2', explain: '城市 1、2 相连成一片，城市 3 独立，共 2 个省份。' }
    ],
    testCases: [
      { input: '3\n1 1 0\n1 1 0\n0 0 1', output: '2' },
      { input: '1\n1', output: '1' },
      { input: '4\n1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 1', output: '4' },
      { input: '2\n1 1\n1 1', output: '1' },
      { input: '5\n1 1 0 0 0\n1 1 1 0 0\n0 1 1 0 0\n0 0 0 1 1\n0 0 0 1 1', output: '2' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(L[0]);\nconst g = L.slice(1, 1 + n).map((r) => r.trim().split(/\\s+/).map(Number));\n// TODO: 并查集统计连通分量\nlet count = n;\nconsole.log(count);\n",
      python: "n = int(input())\ng = [list(map(int, input().split())) for _ in range(n)]\n# TODO: 并查集统计连通分量\ncount = n\nprint(count)\n",
      cpp: `#include <iostream>
#include <vector>
using namespace std;

int n;
vector<int> fa;

int find(int x) { return fa[x] == x ? x : fa[x] = find(fa[x]); }

int main() {
    if (!(cin >> n)) return 0;
    fa.resize(n);
    for (int i = 0; i < n; i++) fa[i] = i;
    int count = n;
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            int v;
            cin >> v;
            if (v && i < j) {
                int a = find(i), b = find(j);
                if (a != b) { fa[a] = b; count--; }
            }
        }
    }
    cout << count << endl;
    return 0;
}
`
    },
    hint: '只在 i < j 时合并，避免把同一条边处理两遍。',
    version: 1
  },
  {
    id: 'code-lc-redundant-connection',
    title: '冗余连接',
    domain: 'backend',
    tags: ['并查集', '图'],
    difficulty: 3,
    statement: '一棵有 n 个节点的树本来有 n-1 条边，现在被多加了一条边，给出 n 条边（节点编号 1..n）。\n\n请找出那条多余的边：删掉它之后剩下的图正好是一棵树。如果有多个答案，输出输入中靠后的那条。',
    inputFormat: '第一行一个整数 n（3 ≤ n ≤ 1000）。\n接下来 n 行，每行两个整数 u、v，表示一条无向边。',
    outputFormat: '一行两个整数 u、v，表示多余的边（保持输入中的顺序）。',
    samples: [
      { input: '3\n1 2\n1 3\n2 3', output: '2 3', explain: '前两条边已经把 1、2、3 连成一棵树，第三条 2-3 是多余的。' }
    ],
    testCases: [
      { input: '3\n1 2\n1 3\n2 3', output: '2 3' },
      { input: '5\n1 2\n2 3\n3 4\n1 4\n1 5', output: '1 4' },
      { input: '3\n1 2\n2 3\n1 3', output: '1 3' },
      { input: '4\n1 2\n1 3\n1 4\n2 4', output: '2 4' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(L[0]);\nconst edges = L.slice(1, 1 + n).map((r) => r.trim().split(/\\s+/).map(Number));\n// TODO: 按顺序加边，第一条「两端已连通」的边就是答案\nconsole.log('');\n",
      python: "n = int(input())\nedges = [tuple(map(int, input().split())) for _ in range(n)]\n# TODO: 并查集按顺序加边\n",
      cpp: `#include <iostream>
#include <vector>
using namespace std;

vector<int> fa;

int find(int x) { return fa[x] == x ? x : fa[x] = find(fa[x]); }

int main() {
    int n;
    if (!(cin >> n)) return 0;
    fa.resize(n + 1);
    for (int i = 1; i <= n; i++) fa[i] = i;
    for (int i = 0; i < n; i++) {
        int u, v;
        cin >> u >> v;
        int a = find(u), b = find(v);
        if (a == b) { cout << u << " " << v << endl; return 0; }
        fa[a] = b;
    }
    return 0;
}
`
    },
    hint: '「加这条边之前两端已经连通」就说明它成环，即多余。按输入顺序处理，第一条命中就是答案。',
    version: 1
  },
  {
    id: 'code-lc-equations-satisfiable',
    title: '等式方程的可满足性',
    domain: 'backend',
    tags: ['并查集', '字符串'],
    difficulty: 3,
    statement: '给定若干条形如 a==b 或 a!=b 的方程（变量都是单个小写字母），判断能否给每个变量赋值，使全部方程同时成立。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 1000）。\n接下来 n 行，每行一个方程，形如 a==b 或 a!=b，没有空格。',
    outputFormat: '一行 YES 或 NO。',
    samples: [
      { input: '3\na==b\nb==c\na!=c', output: 'NO', explain: 'a==b 且 b==c 推出 a==c，与 a!=c 矛盾。' }
    ],
    testCases: [
      { input: '3\na==b\nb==c\na!=c', output: 'NO' },
      { input: '2\na==b\nb!=a', output: 'NO' },
      { input: '3\na==b\nb!=c\na!=c', output: 'YES' },
      { input: '2\na!=b\nb!=a', output: 'YES' },
      { input: '4\na==b\nb==c\nc==d\na!=d', output: 'NO' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(L[0]);\nconst eqs = L.slice(1, 1 + n).map((s) => s.trim());\n// TODO: 先把所有 == 合并，再检查每条 != 的两端是否同集合\nconsole.log('YES');\n",
      python: "n = int(input())\neqs = [input().strip() for _ in range(n)]\n# TODO: 先合并 ==，再检查 !=\nprint('YES')\n",
      cpp: `#include <iostream>
#include <string>
#include <vector>
using namespace std;

vector<int> fa(26);

int find(int x) { return fa[x] == x ? x : fa[x] = find(fa[x]); }

int main() {
    int n;
    if (!(cin >> n)) return 0;
    for (int i = 0; i < 26; i++) fa[i] = i;
    vector<string> eqs(n);
    for (auto &s : eqs) cin >> s;
    // TODO: 第一遍合并 ==，第二遍检查 !=
    cout << "YES" << endl;
    return 0;
}
`
    },
    hint: '必须两遍扫描：先把所有 == 合并完，再检查 !=，否则一条靠前的 != 会漏判。',
    version: 1
  },

  // ---------------- Trie ----------------
  {
    id: 'code-lc-trie-prefix-count',
    title: '前缀匹配计数',
    domain: 'backend',
    tags: ['Trie', '字符串'],
    difficulty: 3,
    statement: '给定一个单词表和若干查询前缀，对每个前缀回答：单词表里有多少个单词以它开头。\n\n单词只含小写字母。要求每次查询不要逐词比较，用前缀树（Trie）把复杂度压到 O(前缀长度)。',
    inputFormat: '第一行两个整数 n、q（1 ≤ n, q ≤ 10^4）。\n第二行 n 个单词，空格分隔（总长度 ≤ 10^5）。\n接下来 q 行，每行一个前缀。',
    outputFormat: '共 q 行，每行一个整数，表示以该前缀开头的单词数量。',
    samples: [
      { input: '5 3\napple app apply banana band\napp\nban\ncat', output: '3\n2\n0', explain: 'app 开头有 apple / app / apply 三个；ban 开头有 banana / band 两个；cat 没有。' }
    ],
    testCases: [
      { input: '5 3\napple app apply banana band\napp\nban\ncat', output: '3\n2\n0' },
      { input: '3 1\na ab abc\na', output: '3' },
      { input: '2 2\nhello world\nwo\nx', output: '1\n0' },
      { input: '4 2\na aa aaa aaaa\naa\naaaa', output: '3\n1' },
      { input: '3 1\ncat car card\nca', output: '3' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [n, q] = L[0].trim().split(/\\s+/).map(Number);\nconst words = L[1].trim().split(/\\s+/);\nconst queries = L.slice(2, 2 + q).map((s) => s.trim());\n// TODO: 建 Trie，每个节点记 pass 计数（经过的单词数）\nconst out = queries.map(() => 0);\nconsole.log(out.join('\\n'));\n",
      python: "n, q = map(int, input().split())\nwords = input().split()\nqueries = [input().strip() for _ in range(q)]\n# TODO: Trie + 经过计数\nprint('\\n'.join('0' for _ in range(q)))\n",
      cpp: `#include <iostream>
#include <string>
#include <vector>
using namespace std;

int main() {
    int n, q;
    if (!(cin >> n >> q)) return 0;
    // TODO: 用数组模拟 Trie：next[node][26] + pass[node]
    vector<string> words(n);
    for (auto &w : words) cin >> w;
    for (int i = 0; i < q; i++) {
        string p;
        cin >> p;
        cout << 0 << endl;
    }
    return 0;
}
`
    },
    hint: '节点上存「经过该节点的单词数」，插入时沿途 +1；查询时走到前缀末尾直接返回该计数。',
    version: 1
  },
  {
    id: 'code-lc-word-replace',
    title: '单词替换',
    domain: 'backend',
    tags: ['Trie', '字符串'],
    difficulty: 3,
    statement: '给定一组词根和一句话，把句子里每个单词替换成「能匹配它的最短词根」。\n\n规则：如果某个词根是单词的前缀，就用该词根替换整个单词；有多个词根都匹配时取最短的；没有词根匹配则保留原单词。句子按空格切分。',
    inputFormat: '第一行一个整数 m（1 ≤ m ≤ 1000）。\n第二行 m 个词根，空格分隔。\n第三行一句话（只含小写字母和空格，长度 ≤ 10^4）。',
    outputFormat: '一行替换后的句子。',
    samples: [
      { input: '3\ncat bat rat\nthe cattle was rattled by the battery', output: 'the cat was rat by the bat', explain: 'cattle 的前缀 cat 命中 → cat；rattled → rat；battery → bat。' }
    ],
    testCases: [
      { input: '3\ncat bat rat\nthe cattle was rattled by the battery', output: 'the cat was rat by the bat' },
      { input: '2\na b\na aa bb', output: 'a a b' },
      { input: '1\nab\nabc abcd', output: 'ab ab' },
      { input: '2\nx y\nxyz zyx', output: 'x zyx' },
      { input: '1\nabc\nabcabc', output: 'abc' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').split('\\n');\nconst m = Number(L[0]);\nconst roots = L[1].trim().split(/\\s+/);\nconst sentence = L[2] || '';\n// TODO: 建 Trie，对每个单词沿树走，遇到词根结尾就截断\nconsole.log(sentence);\n",
      python: "m = int(input())\nroots = input().split()\nsentence = input()\n# TODO: Trie 找最短前缀\nprint(sentence)\n",
      cpp: `#include <iostream>
#include <string>
#include <vector>
#include <sstream>
using namespace std;

int main() {
    int m;
    if (!(cin >> m)) return 0;
    vector<string> roots(m);
    for (auto &r : roots) cin >> r;
    string line;
    getline(cin, line);  // 吃掉 roots 行尾换行
    getline(cin, line);
    // TODO: 建 Trie，逐词找最短词根
    cout << line << endl;
    return 0;
}
`
    },
    hint: 'Trie 节点标记 isEnd；匹配一个单词时边走边看，第一次遇到 isEnd 就停止——这就是最短词根。',
    version: 1
  },
  {
    id: 'code-lc-max-xor-pair',
    title: '最大异或对',
    domain: 'backend',
    tags: ['Trie', '位运算'],
    difficulty: 4,
    statement: '给定 n 个非负整数，从中任选两个（可以是同一个位置吗？不可以，必须是不同位置），求它们的异或结果的最大值。',
    inputFormat: '第一行一个整数 n（2 ≤ n ≤ 10^5）。\n第二行 n 个整数（0 ≤ a ≤ 2^31-1），空格分隔。',
    outputFormat: '一行一个整数，表示最大异或值。',
    samples: [
      { input: '6\n3 10 5 25 2 8', output: '28', explain: '5 和 25 异或得 28，是最大的。' }
    ],
    testCases: [
      { input: '6\n3 10 5 25 2 8', output: '28' },
      { input: '2\n1 2', output: '3' },
      { input: '3\n0 0 0', output: '0' },
      { input: '4\n8 10 2 5', output: '15' },
      { input: '5\n14 70 53 83 49', output: '119' }
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(L[0]);\nconst a = L[1].trim().split(/\\s+/).map(Number);\nlet best = 0;\n// TODO: 二进制 Trie（31 位），每位尽量走相反分支\nconsole.log(best);\n",
      python: "n = int(input())\na = list(map(int, input().split()))\nbest = 0\n# TODO: 31 位二进制 Trie\nprint(best)\n",
      cpp: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    long long best = 0;
    // TODO: 二进制 Trie（30..0 位），每步优先走相反位
    cout << best << endl;
    return 0;
}
`
    },
    hint: '从高位往低位建树，贪心优先走「与当前位相反」的分支；走不通才走同向。',
    version: 1
  },

  // ---------------- 前缀和 ----------------
  {
    id: 'code-lc-subarray-sum-k',
    title: '和为 K 的子数组',
    domain: 'backend',
    tags: ['前缀和', '哈希'],
    difficulty: 3,
    statement: '给定一个整数数组和目标值 k，统计有多少个连续子数组的元素和正好等于 k。\n\n数组元素可能为负数，所以不能用滑动窗口。',
    inputFormat: '第一行两个整数 n、k（1 ≤ n ≤ 10^5，-10^9 ≤ k ≤ 10^9）。\n第二行 n 个整数（-10^4 ≤ a ≤ 10^4），空格分隔。',
    outputFormat: '一行一个整数，表示满足条件的子数组个数。',
    samples: [
      { input: '3 2\n1 1 1', output: '2', explain: '[1,1]（前两个）和 [1,1]（后两个）各算一个。' }
    ],
    testCases: [
      { input: '3 2\n1 1 1', output: '2' },
      { input: '3 3\n1 2 3', output: '2' },
      { input: '5 0\n0 0 0 0 0', output: '15' },
      { input: '4 -1\n1 -1 0 -1', output: '5' },
      { input: '2 100\n1 2', output: '0' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [n, k] = L[0].trim().split(/\\s+/).map(Number);\nconst a = L[1].trim().split(/\\s+/).map(Number);\nlet ans = 0;\n// TODO: 前缀和 + 哈希表：sum - k 出现过几次\nconsole.log(ans);\n",
      python: "n, k = map(int, input().split())\na = list(map(int, input().split()))\nans = 0\n# TODO: 前缀和 + 哈希\nprint(ans)\n",
      cpp: `#include <iostream>
#include <vector>
#include <unordered_map>
using namespace std;

int main() {
    int n;
    long long k;
    if (!(cin >> n >> k)) return 0;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    long long ans = 0, sum = 0;
    unordered_map<long long, long long> cnt{{0, 1}};
    for (auto x : a) {
        sum += x;
        auto it = cnt.find(sum - k);
        if (it != cnt.end()) ans += it->second;
        cnt[sum]++;
    }
    cout << ans << endl;
    return 0;
}
`
    },
    hint: '哈希表要先把 sum=0 的计数置为 1，否则从下标 0 开始的子数组会被漏掉。',
    version: 1
  },
  {
    id: 'code-lc-range-sum-query',
    title: '区间和查询',
    domain: 'backend',
    tags: ['前缀和'],
    difficulty: 1,
    statement: '给定一个数组和 q 次查询，每次查询一个区间 [l, r] 的元素和。\n\n查询次数较多，要求每次 O(1)：预处理前缀和。',
    inputFormat: '第一行两个整数 n、q（1 ≤ n, q ≤ 10^5）。\n第二行 n 个整数（-10^9 ≤ a ≤ 10^9），空格分隔。\n接下来 q 行，每行两个整数 l、r（1 ≤ l ≤ r ≤ n）。',
    outputFormat: '共 q 行，每行一个整数，表示区间和。',
    samples: [
      { input: '5 3\n1 2 3 4 5\n1 3\n2 5\n4 4', output: '6\n14\n4', explain: '[1,3]=1+2+3=6，[2,5]=2+3+4+5=14，[4,4]=4。' }
    ],
    testCases: [
      { input: '5 3\n1 2 3 4 5\n1 3\n2 5\n4 4', output: '6\n14\n4' },
      { input: '1 1\n7\n1 1', output: '7' },
      { input: '3 2\n-1 -2 -3\n1 1\n1 3', output: '-1\n-6' },
      { input: '4 1\n1000000000 1000000000 1000000000 1000000000\n1 4', output: '4000000000' },
      { input: '2 2\n5 -5\n1 2\n2 2', output: '0\n-5' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [n, q] = L[0].trim().split(/\\s+/).map(Number);\nconst a = L[1].trim().split(/\\s+/).map(Number);\n// TODO: 前缀和 pre[i] = a[0..i-1] 的和，答案 = pre[r] - pre[l-1]\nconst out = [];\nfor (let i = 0; i < q; i++) out.push(0);\nconsole.log(out.join('\\n'));\n",
      python: "n, q = map(int, input().split())\na = list(map(int, input().split()))\n# TODO: 前缀和\nprint('\\n'.join('0' for _ in range(q)))\n",
      cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n, q;
    if (!(cin >> n >> q)) return 0;
    vector<long long> pre(n + 1, 0);
    for (int i = 1; i <= n; i++) {
        long long x;
        cin >> x;
        pre[i] = pre[i - 1] + x;  // TODO: 读入时就累加
    }
    while (q--) {
        int l, r;
        cin >> l >> r;
        cout << pre[r] - pre[l - 1] << endl;
    }
    return 0;
}
`
    },
    hint: '前缀和用 long long：n 个 10^9 相加会溢出 int。',
    version: 1
  },
  {
    id: 'code-lc-matrix-block-sum',
    title: '二维区域和',
    domain: 'backend',
    tags: ['前缀和', '矩阵'],
    difficulty: 2,
    statement: '给定一个 n 行 m 列的矩阵，q 次查询，每次求一个子矩阵内所有元素之和。\n\n子矩阵由左上角 (x1, y1) 和右下角 (x2, y2) 给出（行列都从 1 开始，包含端点）。',
    inputFormat: '第一行三个整数 n、m、q（1 ≤ n, m ≤ 500，1 ≤ q ≤ 10^5）。\n接下来 n 行，每行 m 个整数（0 ≤ a ≤ 10^3）。\n接下来 q 行，每行四个整数 x1 y1 x2 y2。',
    outputFormat: '共 q 行，每行一个整数，表示子矩阵和。',
    samples: [
      { input: '3 3 2\n1 2 3\n4 5 6\n7 8 9\n1 1 2 2\n2 2 3 3', output: '12\n28', explain: '左上 2×2 = 1+2+4+5 = 12；右下 2×2 = 5+6+8+9 = 28。' }
    ],
    testCases: [
      { input: '3 3 2\n1 2 3\n4 5 6\n7 8 9\n1 1 2 2\n2 2 3 3', output: '12\n28' },
      { input: '1 1 1\n5\n1 1 1 1', output: '5' },
      { input: '2 2 1\n1 2\n3 4\n1 1 2 2', output: '10' },
      { input: '3 3 1\n1 1 1\n1 1 1\n1 1 1\n2 2 2 2', output: '1' },
      { input: '2 3 2\n1 2 3\n4 5 6\n1 2 2 3\n1 1 2 3', output: '16\n21' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [n, m, q] = L[0].trim().split(/\\s+/).map(Number);\n// TODO: 二维前缀和 pre[i][j] = pre[i-1][j] + pre[i][j-1] - pre[i-1][j-1] + a[i][j]\nconst out = [];\nfor (let i = 0; i < q; i++) out.push(0);\nconsole.log(out.join('\\n'));\n",
      python: "n, m, q = map(int, input().split())\ng = [list(map(int, input().split())) for _ in range(n)]\n# TODO: 二维前缀和\nprint('\\n'.join('0' for _ in range(q)))\n",
      cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n, m, q;
    if (!(cin >> n >> m >> q)) return 0;
    vector<vector<long long>> pre(n + 1, vector<long long>(m + 1, 0));
    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            long long x;
            cin >> x;
            // TODO: 二维前缀和递推
            pre[i][j] = pre[i - 1][j] + pre[i][j - 1] - pre[i - 1][j - 1] + x;
        }
    }
    while (q--) {
        int x1, y1, x2, y2;
        cin >> x1 >> y1 >> x2 >> y2;
        cout << pre[x2][y2] - pre[x1 - 1][y2] - pre[x2][y1 - 1] + pre[x1 - 1][y1 - 1] << endl;
    }
    return 0;
}
`
    },
    hint: '容斥四个角：pre[x2][y2] - pre[x1-1][y2] - pre[x2][y1-1] + pre[x1-1][y1-1]，最后一项别漏。',
    version: 1
  },

  // ---------------- 位运算 ----------------
  {
    id: 'code-lc-single-number',
    title: '只出现一次的数字',
    domain: 'backend',
    tags: ['位运算', '异或'],
    difficulty: 1,
    statement: '给定一个数组，除了某个元素只出现一次，其余元素都恰好出现两次。找出那个只出现一次的元素。\n\n要求 O(n) 时间、O(1) 额外空间。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5，n 为奇数）。\n第二行 n 个整数（-10^9 ≤ a ≤ 10^9），空格分隔。',
    outputFormat: '一行一个整数，表示只出现一次的元素。',
    samples: [
      { input: '3\n2 2 1', output: '1', explain: '2 出现两次抵消，剩 1。' }
    ],
    testCases: [
      { input: '3\n2 2 1', output: '1' },
      { input: '5\n4 1 2 1 2', output: '4' },
      { input: '1\n7', output: '7' },
      { input: '3\n1 -1 1', output: '-1' },
      { input: '7\n0 1 0 2 1 3 2', output: '3' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst a = L[1].trim().split(/\\s+/).map(Number);\nlet ans = 0;\n// TODO: 全部异或起来，成对的会抵消\nconsole.log(ans);\n",
      python: "n = int(input())\na = list(map(int, input().split()))\nans = 0\n# TODO: 全部异或\nprint(ans)\n",
      cpp: `#include <iostream>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    long long ans = 0;
    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;
        ans ^= x;  // TODO: 异或抵消成对元素
    }
    cout << ans << endl;
    return 0;
}
`
    },
    hint: 'a ^ a = 0，a ^ 0 = a，且异或满足交换律——顺序无关。',
    version: 1
  },
  {
    id: 'code-lc-count-bits',
    title: '二进制中 1 的个数',
    domain: 'backend',
    tags: ['位运算'],
    difficulty: 1,
    statement: '给定 n 个非负整数，分别输出它们二进制表示中 1 的个数。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个整数（0 ≤ a ≤ 10^9），空格分隔。',
    outputFormat: '一行 n 个整数，空格分隔，依次是每个数的二进制 1 的个数。',
    samples: [
      { input: '4\n0 1 2 3', output: '0 1 1 2', explain: '0→0，1→1，2(10)→1，3(11)→2。' }
    ],
    testCases: [
      { input: '4\n0 1 2 3', output: '0 1 1 2' },
      { input: '1\n1024', output: '1' },
      { input: '3\n7 8 15', output: '3 1 4' },
      { input: '2\n1000000000 999999999', output: '13 21' },
      { input: '1\n0', output: '0' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst a = L[1].trim().split(/\\s+/).map(Number);\nconst out = a.map((x) => {\n  // TODO: x & (x-1) 每次消掉最低位的 1\n  return 0;\n});\nconsole.log(out.join(' '));\n",
      python: "n = int(input())\na = list(map(int, input().split()))\nout = []\nfor x in a:\n    # TODO: x & (x-1) 消除最低位 1\n    out.append(0)\nprint(' '.join(map(str, out)))\n",
      cpp: `#include <iostream>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    for (int i = 0; i < n; i++) {
        unsigned int x;
        cin >> x;
        int c = 0;
        // TODO: while (x) { x &= x - 1; c++; }
        if (i) cout << " ";
        cout << c;
    }
    cout << endl;
    return 0;
}
`
    },
    hint: 'x & (x-1) 每次恰好消掉最低位的 1，循环次数就是 1 的个数（比逐位判断快）。',
    version: 1
  },
  {
    id: 'code-lc-power-of-two',
    title: '2 的幂',
    domain: 'backend',
    tags: ['位运算'],
    difficulty: 1,
    statement: '给定 n 个整数，判断每个数是不是 2 的整数次幂（1、2、4、8… 都算，0 和负数不算）。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个整数（0 ≤ a ≤ 2^31-1），空格分隔。',
    outputFormat: '一行 n 个 YES 或 NO，空格分隔。',
    samples: [
      { input: '3\n1 3 16', output: 'YES NO YES', explain: '1=2^0、16=2^4 是；3 不是。' }
    ],
    testCases: [
      { input: '3\n1 3 16', output: 'YES NO YES' },
      { input: '2\n0 2', output: 'NO YES' },
      { input: '3\n1024 1023 1048576', output: 'YES NO YES' },
      { input: '1\n1', output: 'YES' },
      { input: '2\n2147483647 1073741824', output: 'NO YES' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst a = L[1].trim().split(/\\s+/).map(Number);\nconst out = a.map((x) => {\n  // TODO: x > 0 且 x & (x-1) === 0\n  return 'NO';\n});\nconsole.log(out.join(' '));\n",
      python: "n = int(input())\na = list(map(int, input().split()))\nout = []\nfor x in a:\n    # TODO: x > 0 and x & (x-1) == 0\n    out.append('NO')\nprint(' '.join(out))\n",
      cpp: `#include <iostream>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;
        bool ok = false;  // TODO: x > 0 && (x & (x - 1)) == 0
        if (i) cout << " ";
        cout << (ok ? "YES" : "NO");
    }
    cout << endl;
    return 0;
}
`
    },
    hint: '2 的幂的二进制里只有一个 1，所以 x & (x-1) == 0；别忘了排除 0（0 也满足这个式子）。',
    version: 1
  },
  {
    id: 'code-lc-hamming-distance',
    title: '汉明距离',
    domain: 'backend',
    tags: ['位运算'],
    difficulty: 1,
    statement: '两个整数的汉明距离定义为它们二进制表示中不同位的个数。给定 x 和 y，求汉明距离。',
    inputFormat: '一行两个整数 x、y（0 ≤ x, y ≤ 2^31-1），空格分隔。',
    outputFormat: '一行一个整数，表示不同位的个数。',
    samples: [
      { input: '1 4', output: '2', explain: '1=001，4=100，有两位不同。' }
    ],
    testCases: [
      { input: '1 4', output: '2' },
      { input: '0 0', output: '0' },
      { input: '3 1', output: '1' },
      { input: '255 0', output: '8' },
      { input: '1234567 7654321', output: '12' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const [x, y] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nlet z = x ^ y;\nlet c = 0;\n// TODO: 统计 z 的二进制 1 的个数\nconsole.log(c);\n",
      python: "x, y = map(int, input().split())\nz = x ^ y\nc = 0\n# TODO: 统计 z 中 1 的个数\nprint(c)\n",
      cpp: `#include <iostream>
using namespace std;

int main() {
    unsigned int x, y;
    if (!(cin >> x >> y)) return 0;
    unsigned int z = x ^ y;
    int c = 0;
    // TODO: 统计 z 的 1 的个数
    cout << c << endl;
    return 0;
}
`
    },
    hint: '先异或得到「哪些位不同」的掩码，再统计这个掩码里 1 的个数。',
    version: 1
  },

  // ---------------- 双指针进阶 ----------------
  {
    id: 'code-lc-three-sum',
    title: '三数之和',
    domain: 'backend',
    tags: ['双指针', '排序'],
    difficulty: 3,
    statement: '给定一个整数数组，找出所有和为 0 的三元组，要求结果不重复。\n\n输出时每个三元组内部按升序排列，三元组之间按字典序排列；先输出三元组个数，再逐行输出。',
    inputFormat: '第一行一个整数 n（3 ≤ n ≤ 3000）。\n第二行 n 个整数（-10^5 ≤ a ≤ 10^5），空格分隔。',
    outputFormat: '第一行一个整数 k，表示三元组个数。\n接下来 k 行，每行三个整数（升序），按字典序排列。k 为 0 时只输出一行 0。',
    samples: [
      { input: '6\n-1 0 1 2 -1 -4', output: '2\n-1 -1 2\n-1 0 1', explain: '两个三元组：(-1,-1,2) 和 (-1,0,1)。' }
    ],
    testCases: [
      { input: '6\n-1 0 1 2 -1 -4', output: '2\n-1 -1 2\n-1 0 1' },
      { input: '3\n0 0 0', output: '1\n0 0 0' },
      { input: '3\n1 2 3', output: '0' },
      { input: '4\n-2 0 1 1', output: '1\n-2 1 1' },
      { input: '5\n-1 0 1 2 -1', output: '2\n-1 -1 2\n-1 0 1' }
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(L[0]);\nconst a = L[1].trim().split(/\\s+/).map(Number).sort((x, y) => x - y);\nconst out = [];\n// TODO: 固定第一个数，剩下两数用左右指针；注意跳过重复\nconsole.log(out.length);\nfor (const t of out) console.log(t.join(' '));\n",
      python: "n = int(input())\na = sorted(map(int, input().split()))\nout = []\n# TODO: 固定 i，双指针找 j/k\nprint(len(out))\nfor t in out:\n    print(' '.join(map(str, t)))\n",
      cpp: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    sort(a.begin(), a.end());
    vector<vector<long long>> out;
    // TODO: 固定 i，双指针 j/k；跳过重复的 i 与 j
    cout << out.size() << endl;
    for (auto &t : out) cout << t[0] << " " << t[1] << " " << t[2] << endl;
    return 0;
}
`
    },
    hint: '排序后固定第一个数，后两数用对撞指针；三个位置都要跳过重复值，否则会有重复三元组。',
    version: 1
  },
  {
    id: 'code-lc-container-water',
    title: '盛最多水的容器',
    domain: 'backend',
    tags: ['双指针', '贪心'],
    difficulty: 2,
    statement: '给定一排竖线的高度，选两条线作为容器两侧，求最多能装多少水。\n\n容量 = 两线间距 × 两条线中较矮的那条高度。',
    inputFormat: '第一行一个整数 n（2 ≤ n ≤ 10^5）。\n第二行 n 个整数（0 ≤ h ≤ 10^4），空格分隔。',
    outputFormat: '一行一个整数，表示最大容量。',
    samples: [
      { input: '9\n1 8 6 2 5 4 8 3 7', output: '49', explain: '第 2 根（高 8）和第 9 根（高 7），间距 7，容量 7×7=49。' }
    ],
    testCases: [
      { input: '9\n1 8 6 2 5 4 8 3 7', output: '49' },
      { input: '2\n1 1', output: '1' },
      { input: '3\n1 2 1', output: '2' },
      { input: '5\n4 3 2 1 4', output: '16' },
      { input: '4\n1 2 4 3', output: '4' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst h = L[1].trim().split(/\\s+/).map(Number);\nlet best = 0;\n// TODO: 左右指针，每次移动较矮的一侧\nconsole.log(best);\n",
      python: "n = int(input())\nh = list(map(int, input().split()))\nbest = 0\n# TODO: 双指针\nprint(best)\n",
      cpp: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> h(n);
    for (auto &x : h) cin >> x;
    long long best = 0;
    int i = 0, j = n - 1;
    // TODO: 每次移动较矮的一侧，因为移动高的一侧不可能变大
    cout << best << endl;
    return 0;
}
`
    },
    hint: '移动较矮的那侧：若移动高的一侧，宽度减小而高度受限于矮侧，面积不可能增大。',
    version: 1
  },
  {
    id: 'code-lc-trap-rain',
    title: '接雨水',
    domain: 'backend',
    tags: ['双指针', '单调栈'],
    difficulty: 4,
    statement: '给定 n 个柱子的高度（宽度为 1），求下雨后这些柱子之间一共能接住多少单位雨水。',
    inputFormat: '第一行一个整数 n（1 ≤ n ≤ 10^5）。\n第二行 n 个非负整数（0 ≤ h ≤ 10^4），空格分隔。',
    outputFormat: '一行一个整数，表示接住的雨水总量。',
    samples: [
      { input: '12\n0 1 0 2 1 0 1 3 2 1 2 1', output: '6', explain: '下标 2、4、5、6、8、10 各积 1 单位，合计 6。' }
    ],
    testCases: [
      { input: '12\n0 1 0 2 1 0 1 3 2 1 2 1', output: '6' },
      { input: '6\n4 2 0 3 2 5', output: '9' },
      { input: '1\n5', output: '0' },
      { input: '3\n2 0 2', output: '2' },
      { input: '5\n3 0 0 0 3', output: '9' }
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(L[0]);\nconst h = L[1].trim().split(/\\s+/).map(Number);\nlet water = 0;\n// TODO: 双指针维护左右最大高度，每次结算较矮一侧\nconsole.log(water);\n",
      python: "n = int(input())\nh = list(map(int, input().split()))\nwater = 0\n# TODO: 双指针 + 左右最大值\nprint(water)\n",
      cpp: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> h(n);
    for (auto &x : h) cin >> x;
    long long water = 0;
    int i = 0, j = n - 1;
    long long leftMax = 0, rightMax = 0;
    // TODO: 谁矮就结算谁，用该侧最大高度减去自身高度
    cout << water << endl;
    return 0;
}
`
    },
    hint: '双指针法：leftMax/rightMax 记录两侧历史最高；矮的那侧能积的水由它自己的 max 决定，可以直接结算。',
    version: 1
  },
  {
    id: 'code-lc-remove-nth-node',
    title: '删除链表的倒数第 N 个节点',
    domain: 'backend',
    tags: ['双指针', '链表'],
    difficulty: 2,
    statement: '给定一个链表的节点值序列和整数 k，删除倒数第 k 个节点后输出剩余序列。\n\n要求一趟扫描完成（快慢指针），不要先求长度。',
    inputFormat: '第一行两个整数 n、k（1 ≤ k ≤ n ≤ 10^5）。\n第二行 n 个整数（-10^4 ≤ v ≤ 10^4），空格分隔。',
    outputFormat: '一行剩余节点的值，空格分隔。如果删完为空，输出一个空行。',
    samples: [
      { input: '5 2\n1 2 3 4 5', output: '1 2 3 5', explain: '倒数第 2 个是 4，删掉后剩 1 2 3 5。' }
    ],
    testCases: [
      { input: '5 2\n1 2 3 4 5', output: '1 2 3 5' },
      { input: '1 1\n1', output: '' },
      { input: '2 1\n1 2', output: '1' },
      { input: '3 3\n1 2 3', output: '2 3' },
      { input: '4 4\n1 2 3 4', output: '2 3 4' }
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    starterCode: {
      javascript: "const L = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [n, k] = L[0].trim().split(/\\s+/).map(Number);\nconst a = L[1].trim().split(/\\s+/).map(Number);\n// TODO: 快慢指针 / 或直接算出要删的下标 n-k\nconsole.log(a.join(' '));\n",
      python: "n, k = map(int, input().split())\na = list(map(int, input().split()))\n# TODO: 删除下标 n-k\nprint(' '.join(map(str, a)))\n",
      cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n, k;
    if (!(cin >> n >> k)) return 0;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    // TODO: 删除下标 n-k 的元素
    for (int i = 0; i < n; i++) {
        if (i) cout << " ";
        cout << a[i];
    }
    cout << endl;
    return 0;
}
`
    },
    hint: 'ACM 模式下拿到的是数组而不是真链表，用「快指针先走 k 步」的思路定位到下标 n-k 即可。',
    version: 1
  }
];
