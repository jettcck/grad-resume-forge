'use strict';

// ============================================================
//  第二批 20 题的参考解法（JS / Python / C++ 各一份）
//
//  作用：验证题面与用例一致——如果某题用例的期望值写错了，
//  这里正确的实现也会 WA，测试会立刻指出来。
//  与 test-code.js 里第一批的写法保持一致：直接从 stdin 读、往 stdout 写。
// ============================================================

const JS_EXTRA = {
  'code-lc-daily-temperatures': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);const t=L[1].trim().split(/\\s+/).map(Number);
const ans=new Array(n).fill(0);const st=[];
for(let i=0;i<n;i++){while(st.length&&t[st[st.length-1]]<t[i]){const j=st.pop();ans[j]=i-j;}st.push(i);}
console.log(ans.join(' '));`,

  'code-lc-largest-rectangle': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const h=L[1].trim().split(/\\s+/).map(Number);
const n=h.length;let best=0;const st=[];
for(let i=0;i<=n;i++){
  const cur=i===n?0:h[i];
  while(st.length&&h[st[st.length-1]]>cur){
    const height=h[st.pop()];
    const left=st.length?st[st.length-1]:-1;
    best=Math.max(best,height*(i-left-1));
  }
  st.push(i);
}
console.log(best);`,

  'code-lc-sliding-window-max': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,k]=L[0].trim().split(/\\s+/).map(Number);
const a=L[1].trim().split(/\\s+/).map(Number);
const dq=[];let head=0;const out=[];
for(let i=0;i<n;i++){
  while(dq.length>head&&a[dq[dq.length-1]]<=a[i])dq.pop();
  dq.push(i);
  if(dq[head]<=i-k)head++;
  if(i>=k-1)out.push(a[dq[head]]);
}
console.log(out.join(' '));`,

  'code-lc-provinces': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);
const g=L.slice(1,1+n).map(r=>r.trim().split(/\\s+/).map(Number));
const fa=Array.from({length:n},(_,i)=>i);
const find=(x)=>{while(fa[x]!==x){fa[x]=fa[fa[x]];x=fa[x];}return x;};
let cnt=n;
for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  if(!g[i][j])continue;
  const a=find(i),b=find(j);
  if(a!==b){fa[a]=b;cnt--;}
}
console.log(cnt);`,

  'code-lc-redundant-connection': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);
const edges=L.slice(1,1+n).map(r=>r.trim().split(/\\s+/).map(Number));
const fa=Array.from({length:n+1},(_,i)=>i);
const find=(x)=>{while(fa[x]!==x){fa[x]=fa[fa[x]];x=fa[x];}return x;};
for(const [u,v] of edges){
  const a=find(u),b=find(v);
  if(a===b){console.log(u+' '+v);break;}
  fa[a]=b;
}`,

  'code-lc-equations-satisfiable': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);
const eqs=L.slice(1,1+n).map(s=>s.trim());
const fa=Array.from({length:26},(_,i)=>i);
const find=(x)=>{while(fa[x]!==x){fa[x]=fa[fa[x]];x=fa[x];}return x;};
for(const s of eqs){
  if(s[1]!=='=')continue;
  const a=find(s.charCodeAt(0)-97),b=find(s.charCodeAt(3)-97);
  if(a!==b)fa[a]=b;
}
let ok=true;
for(const s of eqs){
  if(s[1]!=='!')continue;
  if(find(s.charCodeAt(0)-97)===find(s.charCodeAt(3)-97)){ok=false;break;}
}
console.log(ok?'YES':'NO');`,

  'code-lc-trie-prefix-count': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,q]=L[0].trim().split(/\\s+/).map(Number);
const words=L[1].trim().split(/\\s+/);
const qs=L.slice(2,2+q).map(s=>s.trim());
const trie={pass:0,kids:{}};
for(const w of words){
  let nd=trie;nd.pass++;
  for(const ch of w){
    if(!nd.kids[ch])nd.kids[ch]={pass:0,kids:{}};
    nd=nd.kids[ch];nd.pass++;
  }
}
const query=(p)=>{let nd=trie;for(const ch of p){if(!nd.kids[ch])return 0;nd=nd.kids[ch];}return nd.pass;};
console.log(qs.map(query).join('\\n'));`,

  'code-lc-word-replace': `const L=require('fs').readFileSync(0,'utf8').split('\\n');
const m=Number(L[0]);
const roots=L[1].trim().split(/\\s+/);
const sentence=L[2]||'';
const trie={end:false,kids:{}};
for(const r of roots){
  let nd=trie;
  for(const ch of r){if(!nd.kids[ch])nd.kids[ch]={end:false,kids:{}};nd=nd.kids[ch];}
  nd.end=true;
}
const out=sentence.split(' ').map((w)=>{
  let nd=trie;
  for(let i=0;i<w.length;i++){
    const ch=w[i];
    if(!nd.kids[ch])break;
    nd=nd.kids[ch];
    if(nd.end)return w.slice(0,i+1);
  }
  return w;
});
console.log(out.join(' '));`,

  'code-lc-max-xor-pair': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);
const a=L[1].trim().split(/\\s+/).map(Number);
const trie=[[-1,-1]];
for(const x of a){
  let node=0;
  for(let b=30;b>=0;b--){
    const bit=(x>>b)&1;
    if(trie[node][bit]===-1){trie.push([-1,-1]);trie[node][bit]=trie.length-1;}
    node=trie[node][bit];
  }
}
let best=0;
for(const x of a){
  let node=0,cur=0;
  for(let b=30;b>=0;b--){
    const bit=(x>>b)&1,want=bit^1;
    if(trie[node][want]!==-1){cur|=1<<b;node=trie[node][want];}
    else node=trie[node][bit];
  }
  best=Math.max(best,cur);
}
console.log(best);`,

  'code-lc-subarray-sum-k': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,k]=L[0].trim().split(/\\s+/).map(Number);
const a=L[1].trim().split(/\\s+/).map(Number);
let sum=0,ans=0;
const cnt=new Map([[0,1]]);
for(const x of a){
  sum+=x;
  ans+=cnt.get(sum-k)||0;
  cnt.set(sum,(cnt.get(sum)||0)+1);
}
console.log(ans);`,

  'code-lc-range-sum-query': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,q]=L[0].trim().split(/\\s+/).map(Number);
const a=L[1].trim().split(/\\s+/).map(Number);
const pre=[0];
for(const x of a)pre.push(pre[pre.length-1]+x);
const out=[];
for(let i=0;i<q;i++){
  const [l,r]=L[2+i].trim().split(/\\s+/).map(Number);
  out.push(pre[r]-pre[l-1]);
}
console.log(out.join('\\n'));`,

  'code-lc-matrix-block-sum': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,m,q]=L[0].trim().split(/\\s+/).map(Number);
const pre=Array.from({length:n+1},()=>new Array(m+1).fill(0));
for(let i=1;i<=n;i++){
  const row=L[i].trim().split(/\\s+/).map(Number);
  for(let j=1;j<=m;j++)pre[i][j]=pre[i-1][j]+pre[i][j-1]-pre[i-1][j-1]+row[j-1];
}
const out=[];
for(let t=0;t<q;t++){
  const [x1,y1,x2,y2]=L[1+n+t].trim().split(/\\s+/).map(Number);
  out.push(pre[x2][y2]-pre[x1-1][y2]-pre[x2][y1-1]+pre[x1-1][y1-1]);
}
console.log(out.join('\\n'));`,

  'code-lc-single-number': `const a=require('fs').readFileSync(0,'utf8').trim().split('\\n')[1].trim().split(/\\s+/).map(Number);
let x=0;for(const v of a)x^=v;
console.log(x);`,

  'code-lc-count-bits': `const a=require('fs').readFileSync(0,'utf8').trim().split('\\n')[1].trim().split(/\\s+/).map(Number);
const out=a.map((v)=>{let c=0,x=v;while(x>0){x&=x-1;c++;}return c;});
console.log(out.join(' '));`,

  'code-lc-power-of-two': `const a=require('fs').readFileSync(0,'utf8').trim().split('\\n')[1].trim().split(/\\s+/).map(Number);
const out=a.map((x)=> (x>0 && (x & (x-1))===0) ? 'YES' : 'NO');
console.log(out.join(' '));`,

  'code-lc-hamming-distance': `const [x,y]=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);
let z=(x^y)>>>0,c=0;
while(z>0){z&=z-1;c++;}
console.log(c);`,

  'code-lc-three-sum': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);
const a=L[1].trim().split(/\\s+/).map(Number).sort((x,y)=>x-y);
const out=[];
for(let i=0;i<n-2;i++){
  if(i>0&&a[i]===a[i-1])continue;
  if(a[i]>0)break;
  let l=i+1,r=n-1;
  while(l<r){
    const s=a[i]+a[l]+a[r];
    if(s===0){
      out.push([a[i],a[l],a[r]]);
      while(l<r&&a[l]===a[l+1])l++;
      while(l<r&&a[r]===a[r-1])r--;
      l++;r--;
    } else if(s<0) l++; else r--;
  }
}
console.log(out.length);
for(const t of out)console.log(t.join(' '));`,

  'code-lc-container-water': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const h=L[1].trim().split(/\\s+/).map(Number);
let i=0,j=h.length-1,best=0;
while(i<j){
  best=Math.max(best,Math.min(h[i],h[j])*(j-i));
  if(h[i]<h[j])i++; else j--;
}
console.log(best);`,

  'code-lc-trap-rain': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const n=Number(L[0]);
const h=L[1].trim().split(/\\s+/).map(Number);
let i=0,j=n-1,lm=0,rm=0,water=0;
while(i<j){
  if(h[i]<h[j]){
    if(h[i]>=lm)lm=h[i]; else water+=lm-h[i];
    i++;
  } else {
    if(h[j]>=rm)rm=h[j]; else water+=rm-h[j];
    j--;
  }
}
console.log(water);`,

  'code-lc-remove-nth-node': `const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');
const [n,k]=L[0].trim().split(/\\s+/).map(Number);
const a=L[1].trim().split(/\\s+/).map(Number);
a.splice(n-k,1);
console.log(a.join(' '));`
};

const PY_EXTRA = {
  'code-lc-daily-temperatures': `n=int(input())
t=list(map(int,input().split()))
ans=[0]*n;st=[]
for i in range(n):
    while st and t[st[-1]]<t[i]:
        j=st.pop();ans[j]=i-j
    st.append(i)
print(' '.join(map(str,ans)))`,

  'code-lc-largest-rectangle': `n=int(input())
h=list(map(int,input().split()))
best=0;st=[]
for i in range(n+1):
    cur=0 if i==n else h[i]
    while st and h[st[-1]]>cur:
        height=h[st.pop()]
        left=st[-1] if st else -1
        best=max(best,height*(i-left-1))
    st.append(i)
print(best)`,

  'code-lc-sliding-window-max': `from collections import deque
n,k=map(int,input().split())
a=list(map(int,input().split()))
dq=deque();out=[]
for i in range(n):
    while dq and a[dq[-1]]<=a[i]: dq.pop()
    dq.append(i)
    if dq[0]<=i-k: dq.popleft()
    if i>=k-1: out.append(a[dq[0]])
print(' '.join(map(str,out)))`,

  'code-lc-provinces': `n=int(input())
g=[list(map(int,input().split())) for _ in range(n)]
fa=list(range(n))
def find(x):
    while fa[x]!=x:
        fa[x]=fa[fa[x]];x=fa[x]
    return x
cnt=n
for i in range(n):
    for j in range(i+1,n):
        if not g[i][j]: continue
        a,b=find(i),find(j)
        if a!=b: fa[a]=b;cnt-=1
print(cnt)`,

  'code-lc-redundant-connection': `n=int(input())
edges=[tuple(map(int,input().split())) for _ in range(n)]
fa=list(range(n+1))
def find(x):
    while fa[x]!=x:
        fa[x]=fa[fa[x]];x=fa[x]
    return x
for u,v in edges:
    a,b=find(u),find(v)
    if a==b:
        print(u,v);break
    fa[a]=b`,

  'code-lc-equations-satisfiable': `n=int(input())
eqs=[input().strip() for _ in range(n)]
fa=list(range(26))
def find(x):
    while fa[x]!=x:
        fa[x]=fa[fa[x]];x=fa[x]
    return x
for s in eqs:
    if s[1]!='=': continue
    a,b=find(ord(s[0])-97),find(ord(s[3])-97)
    if a!=b: fa[a]=b
ok=True
for s in eqs:
    if s[1]!='!': continue
    if find(ord(s[0])-97)==find(ord(s[3])-97): ok=False;break
print('YES' if ok else 'NO')`,

  'code-lc-trie-prefix-count': `n,q=map(int,input().split())
words=input().split()
qs=[input().strip() for _ in range(q)]
trie={'pass':0,'kids':{}}
for w in words:
    nd=trie;nd['pass']+=1
    for ch in w:
        if ch not in nd['kids']: nd['kids'][ch]={'pass':0,'kids':{}}
        nd=nd['kids'][ch];nd['pass']+=1
out=[]
for p in qs:
    nd=trie;ok=True
    for ch in p:
        if ch not in nd['kids']: ok=False;break
        nd=nd['kids'][ch]
    out.append(nd['pass'] if ok else 0)
print('\\n'.join(map(str,out)))`,

  'code-lc-word-replace': `m=int(input())
roots=input().split()
sentence=input()
trie={'end':False,'kids':{}}
for r in roots:
    nd=trie
    for ch in r:
        if ch not in nd['kids']: nd['kids'][ch]={'end':False,'kids':{}}
        nd=nd['kids'][ch]
    nd['end']=True
out=[]
for w in sentence.split(' '):
    nd=trie;rep=w
    for i,ch in enumerate(w):
        if ch not in nd['kids']: break
        nd=nd['kids'][ch]
        if nd['end']: rep=w[:i+1];break
    out.append(rep)
print(' '.join(out))`,

  'code-lc-max-xor-pair': `n=int(input())
a=list(map(int,input().split()))
trie=[[-1,-1]]
for x in a:
    node=0
    for b in range(30,-1,-1):
        bit=(x>>b)&1
        if trie[node][bit]==-1:
            trie.append([-1,-1]);trie[node][bit]=len(trie)-1
        node=trie[node][bit]
best=0
for x in a:
    node=0;cur=0
    for b in range(30,-1,-1):
        bit=(x>>b)&1;want=bit^1
        if trie[node][want]!=-1:
            cur|=1<<b;node=trie[node][want]
        else: node=trie[node][bit]
    best=max(best,cur)
print(best)`,

  'code-lc-subarray-sum-k': `n,k=map(int,input().split())
a=list(map(int,input().split()))
sum_=0;ans=0
cnt={0:1}
for x in a:
    sum_+=x
    ans+=cnt.get(sum_-k,0)
    cnt[sum_]=cnt.get(sum_,0)+1
print(ans)`,

  'code-lc-range-sum-query': `n,q=map(int,input().split())
a=list(map(int,input().split()))
pre=[0]
for x in a: pre.append(pre[-1]+x)
out=[]
for _ in range(q):
    l,r=map(int,input().split())
    out.append(pre[r]-pre[l-1])
print('\\n'.join(map(str,out)))`,

  'code-lc-matrix-block-sum': `n,m,q=map(int,input().split())
pre=[[0]*(m+1) for _ in range(n+1)]
for i in range(1,n+1):
    row=list(map(int,input().split()))
    for j in range(1,m+1):
        pre[i][j]=pre[i-1][j]+pre[i][j-1]-pre[i-1][j-1]+row[j-1]
out=[]
for _ in range(q):
    x1,y1,x2,y2=map(int,input().split())
    out.append(pre[x2][y2]-pre[x1-1][y2]-pre[x2][y1-1]+pre[x1-1][y1-1])
print('\\n'.join(map(str,out)))`,

  'code-lc-single-number': `n=int(input())
a=list(map(int,input().split()))
x=0
for v in a: x^=v
print(x)`,

  'code-lc-count-bits': `n=int(input())
a=list(map(int,input().split()))
out=[]
for v in a:
    c=0;x=v
    while x>0:
        x&=x-1;c+=1
    out.append(c)
print(' '.join(map(str,out)))`,

  'code-lc-power-of-two': `n=int(input())
a=list(map(int,input().split()))
print(' '.join('YES' if x>0 and (x&(x-1))==0 else 'NO' for x in a))`,

  'code-lc-hamming-distance': `x,y=map(int,input().split())
z=x^y
print(bin(z).count('1'))`,

  'code-lc-three-sum': `n=int(input())
a=sorted(map(int,input().split()))
out=[]
for i in range(n-2):
    if i>0 and a[i]==a[i-1]: continue
    if a[i]>0: break
    l,r=i+1,n-1
    while l<r:
        s=a[i]+a[l]+a[r]
        if s==0:
            out.append((a[i],a[l],a[r]))
            while l<r and a[l]==a[l+1]: l+=1
            while l<r and a[r]==a[r-1]: r-=1
            l+=1;r-=1
        elif s<0: l+=1
        else: r-=1
print(len(out))
for t in out: print(' '.join(map(str,t)))`,

  'code-lc-container-water': `n=int(input())
h=list(map(int,input().split()))
i,j=0,n-1;best=0
while i<j:
    best=max(best,min(h[i],h[j])*(j-i))
    if h[i]<h[j]: i+=1
    else: j-=1
print(best)`,

  'code-lc-trap-rain': `n=int(input())
h=list(map(int,input().split()))
i,j=0,n-1;lm=rm=water=0
while i<j:
    if h[i]<h[j]:
        if h[i]>=lm: lm=h[i]
        else: water+=lm-h[i]
        i+=1
    else:
        if h[j]>=rm: rm=h[j]
        else: water+=rm-h[j]
        j-=1
print(water)`,

  'code-lc-remove-nth-node': `n,k=map(int,input().split())
a=list(map(int,input().split()))
del a[n-k]
print(' '.join(map(str,a)))`
};

// C++ 参考解法：与 starterCode 同结构，但核心逻辑写完整
const CPP_EXTRA = {
  'code-lc-daily-temperatures': `#include <iostream>
#include <vector>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;vector<int>t(n);for(auto&x:t)cin>>x;
vector<int>ans(n,0),st;
for(int i=0;i<n;i++){while(!st.empty()&&t[st.back()]<t[i]){ans[st.back()]=i-st.back();st.pop_back();}st.push_back(i);}
for(int i=0;i<n;i++){if(i)cout<<" ";cout<<ans[i];}cout<<endl;return 0;}`,

  'code-lc-largest-rectangle': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;vector<long long>h(n);for(auto&x:h)cin>>x;
long long best=0;vector<int>st;
for(int i=0;i<=n;i++){long long cur=i==n?0:h[i];
while(!st.empty()&&h[st.back()]>cur){long long ht=h[st.back()];st.pop_back();int left=st.empty()?-1:st.back();best=max(best,ht*(i-left-1));}
st.push_back(i);}
cout<<best<<endl;return 0;}`,

  'code-lc-sliding-window-max': `#include <iostream>
#include <vector>
#include <deque>
using namespace std;
int main(){int n,k;if(!(cin>>n>>k))return 0;vector<int>a(n);for(auto&x:a)cin>>x;
deque<int>dq;vector<int>out;
for(int i=0;i<n;i++){while(!dq.empty()&&a[dq.back()]<=a[i])dq.pop_back();dq.push_back(i);
if(dq.front()<=i-k)dq.pop_front();if(i>=k-1)out.push_back(a[dq.front()]);}
for(size_t i=0;i<out.size();i++){if(i)cout<<" ";cout<<out[i];}cout<<endl;return 0;}`,

  'code-lc-provinces': `#include <iostream>
#include <vector>
using namespace std;
vector<int>fa;
int find(int x){return fa[x]==x?x:fa[x]=find(fa[x]);}
int main(){int n;if(!(cin>>n))return 0;fa.resize(n);for(int i=0;i<n;i++)fa[i]=i;
int cnt=n;
for(int i=0;i<n;i++)for(int j=0;j<n;j++){int v;cin>>v;if(v&&i<j){int a=find(i),b=find(j);if(a!=b){fa[a]=b;cnt--;}}}
cout<<cnt<<endl;return 0;}`,

  'code-lc-redundant-connection': `#include <iostream>
#include <vector>
using namespace std;
vector<int>fa;
int find(int x){return fa[x]==x?x:fa[x]=find(fa[x]);}
int main(){int n;if(!(cin>>n))return 0;fa.resize(n+1);for(int i=1;i<=n;i++)fa[i]=i;
for(int i=0;i<n;i++){int u,v;cin>>u>>v;int a=find(u),b=find(v);
if(a==b){cout<<u<<" "<<v<<endl;return 0;}fa[a]=b;}
return 0;}`,

  'code-lc-equations-satisfiable': `#include <iostream>
#include <string>
#include <vector>
using namespace std;
vector<int>fa(26);
int find(int x){return fa[x]==x?x:fa[x]=find(fa[x]);}
int main(){int n;if(!(cin>>n))return 0;for(int i=0;i<26;i++)fa[i]=i;
vector<string>eqs(n);for(auto&s:eqs)cin>>s;
for(auto&s:eqs){if(s[1]!='=')continue;int a=find(s[0]-'a'),b=find(s[3]-'a');if(a!=b)fa[a]=b;}
bool ok=true;
for(auto&s:eqs){if(s[1]!='!')continue;if(find(s[0]-'a')==find(s[3]-'a')){ok=false;break;}}
cout<<(ok?"YES":"NO")<<endl;return 0;}`,

  'code-lc-trie-prefix-count': `#include <iostream>
#include <string>
#include <vector>
using namespace std;
int main(){int n,q;if(!(cin>>n>>q))return 0;
vector<vector<int>>nxt(1,vector<int>(26,-1));
vector<int>pass(1,0);
for(int i=0;i<n;i++){string w;cin>>w;int nd=0;pass[nd]++;
for(char ch:w){int c=ch-'a';if(nxt[nd][c]==-1){nxt[nd][c]=nxt.size();nxt.push_back(vector<int>(26,-1));pass.push_back(0);}
nd=nxt[nd][c];pass[nd]++;}}
for(int i=0;i<q;i++){string p;cin>>p;int nd=0;bool ok=true;
for(char ch:p){int c=ch-'a';if(nxt[nd][c]==-1){ok=false;break;}nd=nxt[nd][c];}
cout<<(ok?pass[nd]:0)<<endl;}
return 0;}`,

  'code-lc-word-replace': `#include <iostream>
#include <string>
#include <vector>
#include <sstream>
using namespace std;
int main(){int m;if(!(cin>>m))return 0;
vector<vector<int>>nxt(1,vector<int>(26,-1));
vector<bool>isEnd(1,false);
for(int i=0;i<m;i++){string r;cin>>r;int nd=0;
for(char ch:r){int c=ch-'a';if(nxt[nd][c]==-1){nxt[nd][c]=nxt.size();nxt.push_back(vector<int>(26,-1));isEnd.push_back(false);}
nd=nxt[nd][c];}
isEnd[nd]=true;}
string line;getline(cin,line);getline(cin,line);
istringstream iss(line);string w;bool first=true;
while(iss>>w){string rep=w;int nd=0;
for(int i=0;i<(int)w.size();i++){int c=w[i]-'a';if(nxt[nd][c]==-1)break;
nd=nxt[nd][c];if(isEnd[nd]){rep=w.substr(0,i+1);break;}}
if(!first)cout<<" ";cout<<rep;first=false;}
cout<<endl;return 0;}`,

  'code-lc-max-xor-pair': `#include <iostream>
#include <vector>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;vector<long long>a(n);for(auto&x:a)cin>>x;
vector<vector<int>>nxt(1,vector<int>(2,-1));
for(auto x:a){int nd=0;for(int b=30;b>=0;b--){int bit=(x>>b)&1;
if(nxt[nd][bit]==-1){nxt[nd][bit]=nxt.size();nxt.push_back(vector<int>(2,-1));}
nd=nxt[nd][bit];}}
long long best=0;
for(auto x:a){int nd=0;long long cur=0;
for(int b=30;b>=0;b--){int bit=(x>>b)&1,want=bit^1;
if(nxt[nd][want]!=-1){cur|=1LL<<b;nd=nxt[nd][want];}else nd=nxt[nd][bit];}
if(cur>best)best=cur;}
cout<<best<<endl;return 0;}`,

  'code-lc-subarray-sum-k': `#include <iostream>
#include <vector>
#include <unordered_map>
using namespace std;
int main(){int n;long long k;if(!(cin>>n>>k))return 0;
vector<long long>a(n);for(auto&x:a)cin>>x;
long long sum=0,ans=0;unordered_map<long long,long long>cnt{{0,1}};
for(auto x:a){sum+=x;auto it=cnt.find(sum-k);if(it!=cnt.end())ans+=it->second;cnt[sum]++;}
cout<<ans<<endl;return 0;}`,

  'code-lc-range-sum-query': `#include <iostream>
#include <vector>
using namespace std;
int main(){int n,q;if(!(cin>>n>>q))return 0;
vector<long long>pre(n+1,0);
for(int i=1;i<=n;i++){long long x;cin>>x;pre[i]=pre[i-1]+x;}
while(q--){int l,r;cin>>l>>r;cout<<pre[r]-pre[l-1]<<endl;}
return 0;}`,

  'code-lc-matrix-block-sum': `#include <iostream>
#include <vector>
using namespace std;
int main(){int n,m,q;if(!(cin>>n>>m>>q))return 0;
vector<vector<long long>>pre(n+1,vector<long long>(m+1,0));
for(int i=1;i<=n;i++)for(int j=1;j<=m;j++){long long x;cin>>x;
pre[i][j]=pre[i-1][j]+pre[i][j-1]-pre[i-1][j-1]+x;}
while(q--){int x1,y1,x2,y2;cin>>x1>>y1>>x2>>y2;
cout<<pre[x2][y2]-pre[x1-1][y2]-pre[x2][y1-1]+pre[x1-1][y1-1]<<endl;}
return 0;}`,

  'code-lc-single-number': `#include <iostream>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;long long x=0;
for(int i=0;i<n;i++){long long v;cin>>v;x^=v;}
cout<<x<<endl;return 0;}`,

  'code-lc-count-bits': `#include <iostream>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;
for(int i=0;i<n;i++){unsigned int x;cin>>x;int c=0;while(x){x&=x-1;c++;}
if(i)cout<<" ";cout<<c;}
cout<<endl;return 0;}`,

  'code-lc-power-of-two': `#include <iostream>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;
for(int i=0;i<n;i++){long long x;cin>>x;bool ok=x>0&&(x&(x-1))==0;
if(i)cout<<" ";cout<<(ok?"YES":"NO");}
cout<<endl;return 0;}`,

  'code-lc-hamming-distance': `#include <iostream>
using namespace std;
int main(){unsigned int x,y;if(!(cin>>x>>y))return 0;
unsigned int z=x^y;int c=0;while(z){z&=z-1;c++;}
cout<<c<<endl;return 0;}`,

  'code-lc-three-sum': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;vector<long long>a(n);for(auto&x:a)cin>>x;
sort(a.begin(),a.end());
vector<vector<long long>>out;
for(int i=0;i<n-2;i++){
if(i>0&&a[i]==a[i-1])continue;if(a[i]>0)break;
int l=i+1,r=n-1;
while(l<r){long long s=a[i]+a[l]+a[r];
if(s==0){out.push_back({a[i],a[l],a[r]});
while(l<r&&a[l]==a[l+1])l++;while(l<r&&a[r]==a[r-1])r--;l++;r--;}
else if(s<0)l++;else r--;}}
cout<<out.size()<<endl;
for(auto&t:out)cout<<t[0]<<" "<<t[1]<<" "<<t[2]<<endl;
return 0;}`,

  'code-lc-container-water': `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;vector<long long>h(n);for(auto&x:h)cin>>x;
int i=0,j=n-1;long long best=0;
while(i<j){best=max(best,min(h[i],h[j])*(long long)(j-i));
if(h[i]<h[j])i++;else j--;}
cout<<best<<endl;return 0;}`,

  'code-lc-trap-rain': `#include <iostream>
#include <vector>
using namespace std;
int main(){int n;if(!(cin>>n))return 0;vector<long long>h(n);for(auto&x:h)cin>>x;
int i=0,j=n-1;long long lm=0,rm=0,water=0;
while(i<j){
if(h[i]<h[j]){if(h[i]>=lm)lm=h[i];else water+=lm-h[i];i++;}
else{if(h[j]>=rm)rm=h[j];else water+=rm-h[j];j--;}}
cout<<water<<endl;return 0;}`,

  'code-lc-remove-nth-node': `#include <iostream>
#include <vector>
using namespace std;
int main(){int n,k;if(!(cin>>n>>k))return 0;vector<long long>a(n);for(auto&x:a)cin>>x;
int skip=n-k;bool first=true;
for(int i=0;i<n;i++){if(i==skip)continue;if(!first)cout<<" ";cout<<a[i];first=false;}
cout<<endl;return 0;}`
};

module.exports = { JS_EXTRA, PY_EXTRA, CPP_EXTRA };
