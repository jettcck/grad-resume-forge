'use strict';

// ============================================================
//  编程题判题自测
//  重点：题库用例与参考解法一致（否则用户永远过不了）、
//        超时/运行错误/输出超限/答案错误四种判定的真实性
// ============================================================
const { CODE_BANK, CODE_MAP, getCodeQuestion, publicCodeQuestion } = require('./dist/main/code-bank');
const runner = require('./dist/main/code-runner');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------------- 1) 题库完整性 ----------------
assert(CODE_BANK.length >= 8, '编程题 ≥8 道（实得 ' + CODE_BANK.length + '）');
assert(new Set(CODE_BANK.map((q) => q.id)).size === CODE_BANK.length, '题目 id 唯一');
assert(CODE_BANK.every((q) => q.statement && q.inputFormat && q.outputFormat), '每题都有题面与输入输出说明');
assert(CODE_BANK.every((q) => q.samples.length >= 1 && q.testCases.length >= 3), '每题至少 1 个样例、3 个用例');
assert(CODE_BANK.every((q) => q.timeLimitMs >= 500 && q.memoryLimitMb >= 64), '时间/内存限制合理');

// 样例必须包含在隐藏用例里，否则「运行通过」但「提交挂掉」会让人抓狂
const sampleNotInTests = CODE_BANK.filter((q) => !q.samples.every((s) =>
  q.testCases.some((t) => t.input === s.input && t.output === s.output)));
assert(sampleNotInTests.length === 0,
  '每个样例都包含在判题用例中（缺失：' + (sampleNotInTests.map((q) => q.id).join(',') || '无') + '）');

// 下发给渲染层的数据不能带隐藏用例
const pub = publicCodeQuestion(CODE_BANK[0]);
assert(!('testCases' in pub), '公开题目数据不含隐藏用例');

// ---------------- 2) 输出归一化 ----------------
assert(runner.normalizeOutput('a\r\nb\r\n') === 'a\nb', 'CRLF 归一化并去掉末尾空行');
assert(runner.normalizeOutput('a  \nb\t\n\n') === 'a\nb', '去掉每行行尾空白');
assert(runner.normalizeOutput('') === '', '空输出归一化为空');

// ---------------- 3) 运行时探测 ----------------
const env = runner.detectRuntimes();
assert(env.javascript === true, 'JavaScript 运行时可用（Electron 自带 Node）');
console.log('   [env] python=' + env.python + (env.python ? ' cmd=' + env.pythonCmd : ''));

// ---------------- 4) 参考解法跑通全部用例 ----------------
// 每题一份参考实现：既验证用例正确，也验证判题器能给出 AC
const JS_SOLUTIONS = {
  'code-a-plus-b': `const [a,b]=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b);`,
  'code-two-sum': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,t]=L[0].trim().split(/\\s+/).map(Number);
const a=L[1].trim().split(/\\s+/).map(Number);
const m=new Map();
for(let i=0;i<n;i++){const need=t-a[i];if(m.has(need)){console.log(m.get(need)+' '+i);break;}m.set(a[i],i);}`,
  'code-reverse-string': `console.log(require('fs').readFileSync(0,'utf8').replace(/\\n$/,'').split('').reverse().join(''));`,
  'code-fib': `const MOD=1000000007n;const n=Number(require('fs').readFileSync(0,'utf8').trim());let a=0n,b=1n;for(let i=0;i<n;i++){[a,b]=[b,(a+b)%MOD];}console.log(a.toString());`,
  'code-max-subarray': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);const a=L[1].trim().split(/\\s+/).map(Number);
let cur=a[0],best=a[0];for(let i=1;i<n;i++){cur=Math.max(a[i],cur+a[i]);best=Math.max(best,cur);}console.log(best);`,
  'code-brackets': `const s=require('fs').readFileSync(0,'utf8').trim();
const st=[],m={')':'(',']':'[','}':'{'};let ok=true;
for(const ch of s){if('([{'.includes(ch))st.push(ch);else if(')]}'.includes(ch)){if(st.pop()!==m[ch]){ok=false;break;}}}
if(st.length)ok=false;console.log(ok?'YES':'NO');`,
  'code-dedupe': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const a=L[1].trim().split(/\\s+/).map(Number);
const s=new Set(),o=[];for(const x of a){if(!s.has(x)){s.add(x);o.push(x);}}console.log(o.join(' '));`,
  'code-word-count': `const w=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).filter(Boolean);
const c=new Map();for(const x of w)c.set(x,(c.get(x)||0)+1);
let best=null,bc=0;for(const [k,v] of c){if(v>bc||(v===bc&&k<best)){best=k;bc=v;}}
console.log(best+' '+bc);`
};

const PY_SOLUTIONS = {
  'code-a-plus-b': 'a,b=map(int,input().split())\nprint(a+b)',
  'code-two-sum': 'n,t=map(int,input().split())\na=list(map(int,input().split()))\nseen={}\nfor i,x in enumerate(a):\n    need=t-x\n    if need in seen:\n        print(seen[need],i);break\n    seen[x]=i',
  'code-reverse-string': 'print(input()[::-1])',
  'code-fib': 'MOD=1000000007\nn=int(input())\na,b=0,1\nfor _ in range(n):\n    a,b=b,(a+b)%MOD\nprint(a)',
  'code-max-subarray': 'n=int(input())\na=list(map(int,input().split()))\ncur=best=a[0]\nfor x in a[1:]:\n    cur=max(x,cur+x)\n    best=max(best,cur)\nprint(best)',
  'code-brackets': "s=input().strip()\nst=[]\nm={')':'(',']':'[','}':'{'}\nok=True\nfor ch in s:\n    if ch in '([{': st.append(ch)\n    elif ch in ')]}':\n        if not st or st.pop()!=m[ch]: ok=False;break\nif st: ok=False\nprint('YES' if ok else 'NO')",
  'code-dedupe': "n=int(input())\na=list(map(int,input().split()))\nseen=set();out=[]\nfor x in a:\n    if x not in seen:\n        seen.add(x);out.append(x)\nprint(' '.join(map(str,out)))",
  'code-word-count': "w=input().split()\nc={}\nfor x in w: c[x]=c.get(x,0)+1\nbest=None;bc=0\nfor k,v in c.items():\n    if v>bc or (v==bc and k<best):\n        best,bc=k,v\nprint(best,bc)"
};

(async () => {
  // ---- JavaScript 参考解法 ----
  for (const q of CODE_BANK) {
    const code = JS_SOLUTIONS[q.id];
    assert(!!code, q.id + ' 有 JS 参考解法');
    if (!code) continue;
    const r = await runner.judgeCode(q, 'javascript', code, 'all');
    assert(r.verdict === 'AC' && r.passed === r.total,
      'JS 参考解法全过：' + q.title + '（' + r.passed + '/' + r.total + (r.verdict !== 'AC' ? ' · ' + r.verdict : '') + '）');
  }

  // ---- Python 参考解法（本机有 Python 才跑）----
  if (env.python) {
    for (const q of CODE_BANK) {
      const code = PY_SOLUTIONS[q.id];
      if (!code) continue;
      const r = await runner.judgeCode(q, 'python', code, 'all');
      assert(r.verdict === 'AC' && r.passed === r.total,
        'Python 参考解法全过：' + q.title + '（' + r.passed + '/' + r.total + (r.verdict !== 'AC' ? ' · ' + r.verdict : '') + '）');
    }
  } else {
    console.log('   [skip] 本机没有 Python，跳过 Python 参考解法');
  }

  // ---------------- 5) 四种判定真实性 ----------------
  const ab = getCodeQuestion('code-a-plus-b');

  const wa = await runner.judgeCode(ab, 'javascript', 'console.log(0);', 'all');
  assert(wa.verdict === 'WA' && wa.passed < wa.total, '错误答案判为 WA（' + wa.passed + '/' + wa.total + '）');

  const re = await runner.judgeCode(ab, 'javascript', "throw new Error('boom');", 'all');
  assert(re.verdict === 'RE', '抛异常判为 RE');

  const tle = await runner.judgeCode(ab, 'javascript', 'while(true){}', 'samples');
  assert(tle.verdict === 'TLE', '死循环判为 TLE（实际 ' + tle.verdict + '）');

  const ole = await runner.judgeCode(ab, 'javascript',
    "const s='x'.repeat(1000);for(let i=0;i<1000;i++)console.log(s);", 'samples');
  assert(ole.verdict === 'OLE', '输出爆炸判为 OLE（实际 ' + ole.verdict + '）');

  // 样例模式只跑样例，不会泄露隐藏用例
  const sampleRun = await runner.judgeCode(ab, 'javascript', JS_SOLUTIONS['code-a-plus-b'], 'samples');
  assert(sampleRun.total === ab.samples.length, '「运行」只跑公开样例（' + sampleRun.total + ' 个）');
  assert(sampleRun.cases.every((c) => c.isSample), '运行结果全部标记为样例');
  assert(sampleRun.cases.every((c) => c.input != null && c.expected != null), '样例回传输入与期望输出');

  const submitRun = await runner.judgeCode(ab, 'javascript', JS_SOLUTIONS['code-a-plus-b'], 'all');
  const hidden = submitRun.cases.filter((c) => !c.isSample);
  assert(hidden.length > 0 && hidden.every((c) => c.input === undefined),
    '隐藏用例不回传输入输出（' + hidden.length + ' 个）');

  // 空代码
  const empty = await runner.judgeCode(ab, 'javascript', '   ', 'all');
  assert(empty.verdict === 'CE' && empty.passed === 0, '空代码判为 CE');

  console.log('\n编程题自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
})();
