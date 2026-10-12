const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const owner = 'jettcck';
const repo = 'grad-resume-forge';
const commit = '563d89d';
const tag = 'v1.12.16';
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN missing');
const headers = { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
async function api(path, options = {}) {
  console.error(`${options.method || 'GET'} ${path}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(`https://api.github.com${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}
async function main() {
  const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/main`);
  const base = ref.object.sha;
  const localCommit = execFileSync('git', ['-C', 'C:/trae/resume-app', 'rev-parse', commit], { encoding: 'utf8' }).trim();
  if (!localCommit.startsWith(commit)) throw new Error(`local commit mismatch: ${localCommit}`);
  const files = execFileSync('git', ['-C', 'C:/trae/resume-app', 'ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  const tree = [];
  for (const path of files) {
    const bytes = fs.readFileSync(`C:/trae/resume-app/${path}`);
    const blob = await api(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: bytes.toString('base64'), encoding: 'base64' }) });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const localMessage = execFileSync('git', ['-C', 'C:/trae/resume-app', 'log', '-1', '--format=%B', commit], { encoding: 'utf8' }).trim();
  const newTree = await api(`/repos/${owner}/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: base, tree }) });
  const newCommit = await api(`/repos/${owner}/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: localMessage, tree: newTree.sha, parents: [base] }) });
  await api(`/repos/${owner}/${repo}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha, force: false }) });
  const identity = { name: 'jettcck', email: '41898282+jettcck@users.noreply.github.com', date: new Date().toISOString() };
  const tagObj = await api(`/repos/${owner}/${repo}/git/tags`, { method: 'POST', body: JSON.stringify({ tag, message: `Release ${tag}`, object: newCommit.sha, type: 'commit', tagger: identity }) });
  await api(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: tagObj.sha }) });
  console.log(JSON.stringify({ base, pushedCommit: newCommit.sha, tag }, null, 2));
}
main().catch(error => { console.error(error.message); process.exit(1); });
