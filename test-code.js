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
console.log(best+' '+bc);`,

  // ---- 第二批：Hot 100 高频题型 ----
  'code-lc-reverse-list': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);const a=n?L[1].trim().split(/\\s+/).map(Number):[];
console.log(a.reverse().join(' '));`,
  'code-lc-merge-sorted': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,m]=L[0].trim().split(/\\s+/).map(Number);
const a=n?L[1].trim().split(/\\s+/).map(Number):[];
const b=m?L[2].trim().split(/\\s+/).map(Number):[];
let i=0,j=0,out=[];
while(i<n&&j<m){ if(a[i]<=b[j]) out.push(a[i++]); else out.push(b[j++]); }
while(i<n) out.push(a[i++]);
while(j<m) out.push(b[j++]);
console.log(out.join(' '));`,
  'code-lc-remove-dup': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const a=L[1].trim().split(/\\s+/).map(Number);
const out=[];for(const x of a){ if(!out.length||out[out.length-1]!==x) out.push(x); }
console.log(out.join(' '));`,
  'code-lc-tree-depth': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);const a=L[1].trim().split(/\\s+/).map(Number);
const dep=(i)=> (i>=n||a[i]===-1)?0:1+Math.max(dep(2*i+1),dep(2*i+2));
console.log(dep(0));`,
  'code-lc-inorder': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);const a=L[1].trim().split(/\\s+/).map(Number);
const out=[];
(function go(i){ if(i>=n||a[i]===-1) return; go(2*i+1); out.push(a[i]); go(2*i+2); })(0);
console.log(out.join(' '));`,
  'code-lc-climb-stairs': `const n=Number(require('fs').readFileSync(0,'utf8').trim());
let a=1,b=2;if(n===1){console.log(1);}else{for(let i=3;i<=n;i++){[a,b]=[b,a+b];}console.log(b);}`,
  'code-lc-coin-change': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [amount,cn]=L[0].trim().split(/\\s+/).map(Number);
const coins=L[1].trim().split(/\\s+/).map(Number);
const dp=new Array(amount+1).fill(Infinity);dp[0]=0;
for(let i=1;i<=amount;i++)for(const c of coins)if(i>=c&&dp[i-c]+1<dp[i])dp[i]=dp[i-c]+1;
console.log(dp[amount]===Infinity?-1:dp[amount]);`,
  'code-lc-lis': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);const a=L[1].trim().split(/\\s+/).map(Number);
const tails=[];
for(const x of a){let lo=0,hi=tails.length;while(lo<hi){const mid=(lo+hi)>>1;if(tails[mid]<x)lo=mid+1;else hi=mid;}tails[lo]=x;}
console.log(tails.length);`,
  'code-lc-knapsack': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,W]=L[0].trim().split(/\\s+/).map(Number);
const dp=new Array(W+1).fill(0);
for(let i=1;i<=n;i++){const [w,v]=L[i].trim().split(/\\s+/).map(Number);for(let j=W;j>=w;j--)dp[j]=Math.max(dp[j],dp[j-w]+v);}
console.log(dp[W]);`,
  'code-lc-permute': `const n=Number(require('fs').readFileSync(0,'utf8').trim());
const used=new Array(n+1).fill(false),cur=[],out=[];
(function go(){ if(cur.length===n){out.push(cur.join(' '));return;} for(let i=1;i<=n;i++){ if(used[i])continue; used[i]=true;cur.push(i);go();cur.pop();used[i]=false; } })();
console.log(out.join('\\n'));`,
  'code-lc-binary-search': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,target]=L[0].trim().split(/\\s+/).map(Number);
const a=L[1].trim().split(/\\s+/).map(Number);
let lo=0,hi=n-1,ans=-1;
while(lo<=hi){const mid=(lo+hi)>>1;if(a[mid]===target){ans=mid;break;}else if(a[mid]<target)lo=mid+1;else hi=mid-1;}
console.log(ans);`,
  'code-lc-longest-substr': `const s=require('fs').readFileSync(0,'utf8').replace(/\\n$/,'');
const last=new Map();let left=0,best=0;
for(let i=0;i<s.length;i++){const ch=s[i];if(last.has(ch)&&last.get(ch)>=left)left=last.get(ch)+1;last.set(ch,i);best=Math.max(best,i-left+1);}
console.log(best);`,
  'code-lc-merge-intervals': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);
const seg=L.slice(1,1+n).map(s=>s.trim().split(/\\s+/).map(Number));
seg.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
const out=[];
for(const [l,r] of seg){ if(!out.length||l>out[out.length-1][1]) out.push([l,r]); else out[out.length-1][1]=Math.max(out[out.length-1][1],r); }
console.log(out.length);
console.log(out.map(x=>x.join(' ')).join('\\n'));`,
  'code-lc-islands': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,m]=L[0].trim().split(/\\s+/).map(Number);
const g=L.slice(1,1+n).map(r=>r.trim().split(''));
let cnt=0;
for(let i=0;i<n;i++)for(let j=0;j<m;j++){ if(g[i][j]!=='1')continue; cnt++; g[i][j]='0'; const st=[[i,j]];
  while(st.length){const [x,y]=st.pop();for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<n&&ny>=0&&ny<m&&g[nx][ny]==='1'){g[nx][ny]='0';st.push([nx,ny]);}}}
}
console.log(cnt);`,
  'code-lc-edit-distance': `const raw=require('fs').readFileSync(0,'utf8');
const parts=raw.split('\\n').map(s=>s.replace(/\\r$/,''));
const a=parts[0]||'',b=parts[1]||'';
const m=a.length,n=b.length;
const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));
for(let i=0;i<=m;i++)dp[i][0]=i;
for(let j=0;j<=n;j++)dp[0][j]=j;
for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]= a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j-1],dp[i-1][j],dp[i][j-1]);
console.log(dp[m][n]);`
};

const PY_SOLUTIONS = {
  'code-a-plus-b': 'a,b=map(int,input().split())\nprint(a+b)',
  'code-two-sum': 'n,t=map(int,input().split())\na=list(map(int,input().split()))\nseen={}\nfor i,x in enumerate(a):\n    need=t-x\n    if need in seen:\n        print(seen[need],i);break\n    seen[x]=i',
  'code-reverse-string': 'print(input()[::-1])',
  'code-fib': 'MOD=1000000007\nn=int(input())\na,b=0,1\nfor _ in range(n):\n    a,b=b,(a+b)%MOD\nprint(a)',
  'code-max-subarray': 'n=int(input())\na=list(map(int,input().split()))\ncur=best=a[0]\nfor x in a[1:]:\n    cur=max(x,cur+x)\n    best=max(best,cur)\nprint(best)',
  'code-brackets': "s=input().strip()\nst=[]\nm={')':'(',']':'[','}':'{'}\nok=True\nfor ch in s:\n    if ch in '([{': st.append(ch)\n    elif ch in ')]}':\n        if not st or st.pop()!=m[ch]: ok=False;break\nif st: ok=False\nprint('YES' if ok else 'NO')",
  'code-dedupe': "n=int(input())\na=list(map(int,input().split()))\nseen=set();out=[]\nfor x in a:\n    if x not in seen:\n        seen.add(x);out.append(x)\nprint(' '.join(map(str,out)))",
  'code-word-count': "w=input().split()\nc={}\nfor x in w: c[x]=c.get(x,0)+1\nbest=None;bc=0\nfor k,v in c.items():\n    if v>bc or (v==bc and k<best):\n        best,bc=k,v\nprint(best,bc)",

  // ---- 第二批：Hot 100 高频题型 ----
  'code-lc-reverse-list': "n=int(input())\na=list(map(int,input().split())) if n else []\nprint(' '.join(map(str,a[::-1])))",
  'code-lc-merge-sorted': "n,m=map(int,input().split())\na=list(map(int,input().split())) if n else []\nb=list(map(int,input().split())) if m else []\ni=j=0;out=[]\nwhile i<n and j<m:\n    if a[i]<=b[j]: out.append(a[i]);i+=1\n    else: out.append(b[j]);j+=1\nout+=a[i:];out+=b[j:]\nprint(' '.join(map(str,out)))",
  'code-lc-remove-dup': "n=int(input())\na=list(map(int,input().split()))\nout=[]\nfor x in a:\n    if not out or out[-1]!=x: out.append(x)\nprint(' '.join(map(str,out)))",
  'code-lc-tree-depth': "n=int(input())\na=list(map(int,input().split()))\ndef dep(i):\n    if i>=n or a[i]==-1: return 0\n    return 1+max(dep(2*i+1),dep(2*i+2))\nprint(dep(0))",
  'code-lc-inorder': "n=int(input())\na=list(map(int,input().split()))\nout=[]\ndef go(i):\n    if i>=n or a[i]==-1: return\n    go(2*i+1);out.append(a[i]);go(2*i+2)\ngo(0)\nprint(' '.join(map(str,out)))",
  'code-lc-climb-stairs': "n=int(input())\na,b=1,2\nif n==1: print(1)\nelse:\n    for _ in range(3,n+1): a,b=b,a+b\n    print(b)",
  'code-lc-coin-change': "amount,n=map(int,input().split())\ncoins=list(map(int,input().split()))\nINF=float('inf')\ndp=[INF]*(amount+1);dp[0]=0\nfor i in range(1,amount+1):\n    for c in coins:\n        if i>=c and dp[i-c]+1<dp[i]: dp[i]=dp[i-c]+1\nprint(-1 if dp[amount]==INF else dp[amount])",
  'code-lc-lis': "import bisect\nn=int(input())\na=list(map(int,input().split()))\ntails=[]\nfor x in a:\n    i=bisect.bisect_left(tails,x)\n    if i==len(tails): tails.append(x)\n    else: tails[i]=x\nprint(len(tails))",
  'code-lc-knapsack': "n,W=map(int,input().split())\ndp=[0]*(W+1)\nfor _ in range(n):\n    w,v=map(int,input().split())\n    for j in range(W,w-1,-1):\n        dp[j]=max(dp[j],dp[j-w]+v)\nprint(dp[W])",
  'code-lc-permute': "n=int(input())\nused=[False]*(n+1);cur=[];out=[]\ndef go():\n    if len(cur)==n:\n        out.append(' '.join(map(str,cur)));return\n    for i in range(1,n+1):\n        if used[i]: continue\n        used[i]=True;cur.append(i);go();cur.pop();used[i]=False\ngo()\nprint('\\n'.join(out))",
  'code-lc-binary-search': "n,target=map(int,input().split())\na=list(map(int,input().split()))\nlo,hi,ans=0,n-1,-1\nwhile lo<=hi:\n    mid=(lo+hi)//2\n    if a[mid]==target: ans=mid;break\n    elif a[mid]<target: lo=mid+1\n    else: hi=mid-1\nprint(ans)",
  'code-lc-longest-substr': "s=input()\nlast={};left=0;best=0\nfor i,ch in enumerate(s):\n    if ch in last and last[ch]>=left: left=last[ch]+1\n    last[ch]=i\n    best=max(best,i-left+1)\nprint(best)",
  'code-lc-merge-intervals': "n=int(input())\nseg=[tuple(map(int,input().split())) for _ in range(n)]\nseg.sort()\nout=[]\nfor l,r in seg:\n    if not out or l>out[-1][1]: out.append([l,r])\n    else: out[-1][1]=max(out[-1][1],r)\nprint(len(out))\nprint('\\n'.join(str(l)+' '+str(r) for l,r in out))",
  'code-lc-islands': "n,m=map(int,input().split())\ng=[list(input().strip()) for _ in range(n)]\ncnt=0\nfor i in range(n):\n    for j in range(m):\n        if g[i][j]!='1': continue\n        cnt+=1;st=[(i,j)];g[i][j]='0'\n        while st:\n            x,y=st.pop()\n            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):\n                nx,ny=x+dx,y+dy\n                if 0<=nx<n and 0<=ny<m and g[nx][ny]=='1':\n                    g[nx][ny]='0';st.append((nx,ny))\nprint(cnt)",
  'code-lc-edit-distance': "raw=open(0).read()\nparts=raw.split('\\n')\na=parts[0].rstrip('\\r')\nb=parts[1].rstrip('\\r') if len(parts)>1 else ''\nm,n=len(a),len(b)\ndp=[[0]*(n+1) for _ in range(m+1)]\nfor i in range(m+1): dp[i][0]=i\nfor j in range(n+1): dp[0][j]=j\nfor i in range(1,m+1):\n    for j in range(1,n+1):\n        dp[i][j]=dp[i-1][j-1] if a[i-1]==b[j-1] else 1+min(dp[i-1][j-1],dp[i-1][j],dp[i][j-1])\nprint(dp[m][n])"
};

// C++ 参考解法：验证「编译 → 运行 → 判定」整条链路
const CPP_SOLUTIONS = {
  'code-a-plus-b': '#include <iostream>\nusing namespace std;\nint main(){long long a,b;if(!(cin>>a>>b))return 0;cout<<a+b<<endl;return 0;}',
  'code-reverse-string': '#include <iostream>\n#include <string>\n#include <algorithm>\nusing namespace std;\nint main(){string s;getline(cin,s);reverse(s.begin(),s.end());cout<<s<<endl;return 0;}',
  'code-lc-climb-stairs': '#include <iostream>\nusing namespace std;\nint main(){int n;if(!(cin>>n))return 0;if(n==1){cout<<1<<endl;return 0;}long long a=1,b=2;for(int i=3;i<=n;i++){long long t=a+b;a=b;b=t;}cout<<b<<endl;return 0;}',
  'code-lc-binary-search': '#include <iostream>\n#include <vector>\nusing namespace std;\nint main(){int n;long long target;if(!(cin>>n>>target))return 0;vector<long long> a(n);for(auto &x:a)cin>>x;int lo=0,hi=n-1,ans=-1;while(lo<=hi){int mid=(lo+hi)/2;if(a[mid]==target){ans=mid;break;}else if(a[mid]<target)lo=mid+1;else hi=mid-1;}cout<<ans<<endl;return 0;}',

  // ---- 第二批：补全剩余 19 题 ----
  'code-two-sum': `#include <iostream>
#include <vector>
#include <unordered_map>
using namespace std;
int main(){
    int n; long long t;
    if(!(cin>>n>>t)) return 0;
    vector<long long> a(n);
    for(auto &x:a) cin>>x;
    unordered_map<long long,int> seen;
    for(int i=0;i<n;i++){
        auto it=seen.find(t-a[i]);
        if(it!=seen.end()){ cout<<it->second<<" "<<i<<endl; return 0; }
        seen[a[i]]=i;
    }
    return 0;
}`,
  'code-fib': `#include <iostream>
using namespace std;
int main(){
    int n; if(!(cin>>n)) return 0;
    const long long MOD=1000000007;
    long long a=0,b=1;
    for(int i=0;i<n;i++){ long long t=(a+b)%MOD; a=b; b=t; }
    cout<<a<<endl;
    return 0;
}`,
  'code-max-subarray': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    int n; if(!(cin>>n)) return 0;
    vector<long long> a(n);
    for(auto &x:a) cin>>x;
    long long cur=a[0], best=a[0];
    for(int i=1;i<n;i++){ cur=max(a[i],cur+a[i]); best=max(best,cur); }
    cout<<best<<endl;
    return 0;
}`,
  'code-brackets': `#include <iostream>
#include <string>
#include <stack>
using namespace std;
int main(){
    string s; getline(cin,s);
    if(!s.empty() && s.back()=='\\r') s.pop_back();
    stack<char> st; bool ok=true;
    for(char ch:s){
        if(ch=='('||ch=='['||ch=='{') st.push(ch);
        else if(ch==')'||ch==']'||ch=='}'){
            char want = ch==')' ? '(' : (ch==']' ? '[' : '{');
            if(st.empty()||st.top()!=want){ ok=false; break; }
            st.pop();
        }
    }
    if(!st.empty()) ok=false;
    cout<<(ok?"YES":"NO")<<endl;
    return 0;
}`,
  'code-dedupe': `#include <iostream>
#include <vector>
#include <unordered_set>
using namespace std;
int main(){
    int n; if(!(cin>>n)) return 0;
    vector<long long> a(n);
    for(auto &x:a) cin>>x;
    unordered_set<long long> seen; vector<long long> out;
    for(auto x:a) if(seen.insert(x).second) out.push_back(x);
    for(size_t i=0;i<out.size();i++){ if(i) cout<<" "; cout<<out[i]; }
    cout<<endl;
    return 0;
}`,
  'code-word-count': `#include <iostream>
#include <string>
#include <map>
using namespace std;
int main(){
    map<string,int> cnt;
    string w;
    while(cin>>w) cnt[w]++;
    string best; int bc=0;
    for(auto &kv:cnt){
        if(kv.second>bc || (kv.second==bc && kv.first<best)){ best=kv.first; bc=kv.second; }
    }
    if(bc) cout<<best<<" "<<bc<<endl;
    return 0;
}`,
  'code-lc-reverse-list': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    int n; if(!(cin>>n)) return 0;
    vector<long long> a(n);
    for(auto &x:a) cin>>x;
    reverse(a.begin(),a.end());
    for(int i=0;i<n;i++){ if(i) cout<<" "; cout<<a[i]; }
    cout<<endl;
    return 0;
}`,
  'code-lc-merge-sorted': `#include <iostream>
#include <vector>
using namespace std;
int main(){
    int n,m; if(!(cin>>n>>m)) return 0;
    vector<long long> a(n),b(m);
    for(auto &x:a) cin>>x;
    for(auto &x:b) cin>>x;
    vector<long long> o; o.reserve(n+m);
    int i=0,j=0;
    while(i<n && j<m){ if(a[i]<=b[j]) o.push_back(a[i++]); else o.push_back(b[j++]); }
    while(i<n) o.push_back(a[i++]);
    while(j<m) o.push_back(b[j++]);
    for(size_t k=0;k<o.size();k++){ if(k) cout<<" "; cout<<o[k]; }
    cout<<endl;
    return 0;
}`,
  'code-lc-remove-dup': `#include <iostream>
#include <vector>
using namespace std;
int main(){
    int n; if(!(cin>>n)) return 0;
    vector<long long> a(n);
    for(auto &x:a) cin>>x;
    vector<long long> out;
    for(auto x:a) if(out.empty()||out.back()!=x) out.push_back(x);
    for(size_t i=0;i<out.size();i++){ if(i) cout<<" "; cout<<out[i]; }
    cout<<endl;
    return 0;
}`,
  'code-lc-tree-depth': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int n; vector<long long> a;
int dep(int i){
    if(i>=n || a[i]==-1) return 0;
    return 1+max(dep(2*i+1),dep(2*i+2));
}
int main(){
    if(!(cin>>n)) return 0;
    a.resize(n);
    for(auto &x:a) cin>>x;
    cout<<dep(0)<<endl;
    return 0;
}`,
  'code-lc-inorder': `#include <iostream>
#include <vector>
using namespace std;
int n; vector<long long> a; vector<long long> out;
void go(int i){
    if(i>=n || a[i]==-1) return;
    go(2*i+1); out.push_back(a[i]); go(2*i+2);
}
int main(){
    if(!(cin>>n)) return 0;
    a.resize(n);
    for(auto &x:a) cin>>x;
    go(0);
    for(size_t i=0;i<out.size();i++){ if(i) cout<<" "; cout<<out[i]; }
    cout<<endl;
    return 0;
}`,
  'code-lc-coin-change': `#include <iostream>
#include <vector>
using namespace std;
int main(){
    int amount,cn; if(!(cin>>amount>>cn)) return 0;
    vector<int> coins(cn);
    for(auto &c:coins) cin>>c;
    const int INF=1000000000;
    vector<int> dp(amount+1,INF); dp[0]=0;
    for(int i=1;i<=amount;i++)
        for(int c:coins)
            if(i>=c && dp[i-c]+1<dp[i]) dp[i]=dp[i-c]+1;
    cout<<(dp[amount]>=INF?-1:dp[amount])<<endl;
    return 0;
}`,
  'code-lc-lis': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    int n; if(!(cin>>n)) return 0;
    vector<long long> a(n);
    for(auto &x:a) cin>>x;
    vector<long long> tails;
    for(auto x:a){
        auto it=lower_bound(tails.begin(),tails.end(),x);
        if(it==tails.end()) tails.push_back(x); else *it=x;
    }
    cout<<tails.size()<<endl;
    return 0;
}`,
  'code-lc-knapsack': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    int n,W; if(!(cin>>n>>W)) return 0;
    vector<long long> dp(W+1,0);
    for(int i=0;i<n;i++){
        int w; long long v;
        cin>>w>>v;
        for(int j=W;j>=w;j--) dp[j]=max(dp[j],dp[j-w]+v);
    }
    cout<<dp[W]<<endl;
    return 0;
}`,
  'code-lc-permute': `#include <iostream>
#include <vector>
using namespace std;
int n; vector<int> cur; vector<bool> used;
void go(){
    if((int)cur.size()==n){
        for(int i=0;i<n;i++){ if(i) cout<<" "; cout<<cur[i]; }
        cout<<"\\n";
        return;
    }
    for(int i=1;i<=n;i++){
        if(used[i]) continue;
        used[i]=true; cur.push_back(i); go(); cur.pop_back(); used[i]=false;
    }
}
int main(){
    if(!(cin>>n)) return 0;
    used.assign(n+1,false);
    go();
    return 0;
}`,
  'code-lc-longest-substr': `#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    string s; getline(cin,s);
    if(!s.empty() && s.back()=='\\r') s.pop_back();
    vector<int> last(256,-1);
    int left=0,best=0;
    for(int i=0;i<(int)s.size();i++){
        unsigned char ch=(unsigned char)s[i];
        if(last[ch]>=left) left=last[ch]+1;
        last[ch]=i;
        best=max(best,i-left+1);
    }
    cout<<best<<endl;
    return 0;
}`,
  'code-lc-merge-intervals': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    int n; if(!(cin>>n)) return 0;
    vector<pair<int,int>> seg(n);
    for(auto &p:seg) cin>>p.first>>p.second;
    sort(seg.begin(),seg.end());
    vector<pair<int,int>> out;
    for(auto &p:seg){
        if(out.empty() || p.first>out.back().second) out.push_back(p);
        else out.back().second=max(out.back().second,p.second);
    }
    cout<<out.size()<<endl;
    for(auto &p:out) cout<<p.first<<" "<<p.second<<endl;
    return 0;
}`,
  'code-lc-islands': `#include <iostream>
#include <vector>
#include <string>
using namespace std;
int main(){
    int n,m; if(!(cin>>n>>m)) return 0;
    vector<string> g(n);
    for(auto &r:g) cin>>r;
    int dx[4]={1,-1,0,0}, dy[4]={0,0,1,-1};
    int cnt=0;
    for(int i=0;i<n;i++) for(int j=0;j<m;j++){
        if(g[i][j]!='1') continue;
        cnt++;
        vector<pair<int,int>> st{{i,j}};
        g[i][j]='0';
        while(!st.empty()){
            auto [x,y]=st.back(); st.pop_back();
            for(int d=0;d<4;d++){
                int nx=x+dx[d], ny=y+dy[d];
                if(nx>=0&&nx<n&&ny>=0&&ny<m&&g[nx][ny]=='1'){ g[nx][ny]='0'; st.push_back({nx,ny}); }
            }
        }
    }
    cout<<cnt<<endl;
    return 0;
}`,
  'code-lc-edit-distance': `#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    string a,b;
    getline(cin,a); getline(cin,b);
    if(!a.empty() && a.back()=='\\r') a.pop_back();
    if(!b.empty() && b.back()=='\\r') b.pop_back();
    int m=a.size(), n=b.size();
    vector<vector<int>> dp(m+1, vector<int>(n+1,0));
    for(int i=0;i<=m;i++) dp[i][0]=i;
    for(int j=0;j<=n;j++) dp[0][j]=j;
    for(int i=1;i<=m;i++) for(int j=1;j<=n;j++){
        dp[i][j] = (a[i-1]==b[j-1]) ? dp[i-1][j-1]
                                   : 1+min({dp[i-1][j-1],dp[i-1][j],dp[i][j-1]});
    }
    cout<<dp[m][n]<<endl;
    return 0;
}`
};

// 第二批 20 题的参考解法单独放文件，这里合并进来一起验证
const extra = require('./test-code-extra');
Object.assign(JS_SOLUTIONS, extra.JS_EXTRA);
Object.assign(PY_SOLUTIONS, extra.PY_EXTRA);
Object.assign(CPP_SOLUTIONS, extra.CPP_EXTRA);

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

  // ---- C++ 参考解法（本机有 g++/clang++ 才跑）----
  if (env.cpp) {
    console.log('   [env] cpp=' + env.cppCmd);
    const abQ = getCodeQuestion('code-a-plus-b');
    for (const q of CODE_BANK) {
      const code = CPP_SOLUTIONS[q.id];
      if (!code) continue;
      const r = await runner.judgeCode(q, 'cpp', code, 'all');
      assert(r.verdict === 'AC' && r.passed === r.total,
        'C++ 参考解法全过：' + q.title + '（' + r.passed + '/' + r.total + (r.verdict !== 'AC' ? ' · ' + r.verdict + ' ' + (r.message || '') : '') + '）');
    }
    // 编译错误要判 CE 并把编译器报错带回来
    const ce = await runner.judgeCode(abQ, 'cpp', 'int main(){ this is not c++; }', 'all');
    assert(ce.verdict === 'CE', 'C++ 语法错误判为 CE（实际 ' + ce.verdict + '）');
    assert(!!(ce.cases[0] && ce.cases[0].stderr), 'CE 时回传编译器报错');
    // 运行错误
    const cppRe = await runner.judgeCode(abQ, 'cpp',
      '#include <cstdlib>\nint main(){ int* p=nullptr; *p=1; return 0; }', 'all');
    assert(cppRe.verdict === 'RE' || cppRe.verdict === 'CE', 'C++ 空指针崩溃判为 RE/CE（实际 ' + cppRe.verdict + '）');
  } else {
    console.log('   [skip] 本机没有 C++ 编译器，跳过 C++ 参考解法');
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

  // ---------------- 自定义测试输入 ----------------
  // 不比对期望输出，只回传真实 stdout/stderr/耗时；边界数据靠它自测
  const customSum = `const d=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(d[0]+d[1]);`;
  const c1 = await runner.runCustomInput(ab, 'javascript', customSum, '7 35');
  assert(c1.verdict === 'OK', '自定义输入：正常结束判 OK（实际 ' + c1.verdict + '）');
  assert(c1.stdout.trim() === '42', '自定义输入：回传真实 stdout（' + JSON.stringify(c1.stdout.trim()) + '）');
  assert(c1.timeMs >= 0, '自定义输入：回传耗时');

  const c2 = await runner.runCustomInput(ab, 'javascript', customSum, '');
  assert(c2.verdict === 'OK' || c2.verdict === 'RE', '自定义输入：空输入不崩判题器（实际 ' + c2.verdict + '）');

  const c3 = await runner.runCustomInput(ab, 'javascript', `process.exit(3);`, '1 2');
  assert(c3.verdict === 'RE', '自定义输入：非 0 退出判 RE（实际 ' + c3.verdict + '）');
  assert(!!c3.message, '自定义输入：RE 时给出退出码说明');

  const c4 = await runner.runCustomInput(ab, 'javascript', `while(true){}`, '1 2');
  assert(c4.verdict === 'TLE', '自定义输入：死循环判 TLE（实际 ' + c4.verdict + '）');

  const c5 = await runner.runCustomInput(ab, 'javascript', `const s='x'.repeat(1000);for(let i=0;i<1000;i++)console.log(s);`, '');
  assert(c5.verdict === 'OLE', '自定义输入：输出爆炸判 OLE（实际 ' + c5.verdict + '）');

  const c6 = await runner.runCustomInput(ab, 'javascript', '   ', '1');
  assert(c6.verdict === 'CE' && c6.message === '代码为空', '自定义输入：空代码判 CE');

  // 大输入不泄漏到 stdout（截断保护）
  const c7 = await runner.runCustomInput(ab, 'javascript',
    `const d=require('fs').readFileSync(0,'utf8');console.log(d.length);`, 'a'.repeat(50000));
  assert(c7.verdict === 'OK' && c7.stdout.trim() === '50000', '自定义输入：5 万字符输入可正常读入');

  if (env.cpp) {
    const cppCustom = await runner.runCustomInput(ab, 'cpp',
      '#include <iostream>\nusing namespace std;\nint main(){long long a,b;if(!(cin>>a>>b))return 0;cout<<a*b<<endl;return 0;}', '6 7');
    assert(cppCustom.verdict === 'OK' && cppCustom.stdout.trim() === '42',
      '自定义输入：C++ 链路可用（' + cppCustom.verdict + ' ' + JSON.stringify(cppCustom.stdout.trim()) + '）');
    const cppCe = await runner.runCustomInput(ab, 'cpp', 'int main(){ oops }', '1');
    assert(cppCe.verdict === 'CE' && !!cppCe.stderr, '自定义输入：C++ 语法错误判 CE 且回传编译器报错');
  }

  console.log('\n编程题自测完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
})();
