// 经 Git Data API 把本地 main 的快照推到 origin/main 并打 tag
//
// 适用场景：git-over-HTTPS(github.com) 被阻断，但 api.github.com 可达。
//
// 用法：
//   GITHUB_TOKEN=xxx node push-via-api.js            # tag 取 package.json version
//   GITHUB_TOKEN=xxx node push-via-api.js v1.12.30   # 指定 tag
//
// 三个关键点（都是踩过的坑）：
//   1) blob 内容用 `git cat-file blob <sha>` 取仓库内的精确字节，
//      避免 core.autocrlf 把工作区 CRLF 传上去、导致远端与本地 HEAD 不一致；
//   2) 只上传远端缺失/内容不同的 blob，远端多出的文件显式删除，
//      建完 tree 后用 recursive tree 回读逐条校验，不一致就终止（不推 ref）；
//   3) 推之前检查 tag / release 是否已存在，已存在直接终止，不覆盖。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname);
const owner = 'jettcck';
const repo = 'grad-resume-forge';

const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const tag = String(process.argv[2] || ('v' + pkg.version)).trim();
const localHead = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN missing');

const headers = {
  'Accept': 'application/vnd.github+json',
  'Authorization': `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json'
};

async function api(urlPath, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let response;
  try {
    response = await fetch(`https://api.github.com${urlPath}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${urlPath} -> ${response.status}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

const git = (args, opts) => execFileSync('git', ['-C', REPO, ...args], opts);

/** 用最近若干条真实提交信息生成快照提交的说明（不写死功能描述） */
function buildCommitMessage() {
  const log = git(['log', '--oneline', '-8'], { encoding: 'utf8' }).trim();
  return [
    `sync main with dev line (${tag})`,
    '',
    `本地开发线推到 ${tag}；GitHub main 可能停在此前的发布线。`,
    `本次经 Git Data API 以快照提交同步，tree 与本地 main (${localHead.slice(0, 7)}) 逐字节一致（已用 recursive tree 回读校验）。`,
    '',
    '包含的提交：',
    ...log.split(/\r?\n/).map((l) => '- ' + l)
  ].join('\n');
}

async function main() {
  console.log('localHead=' + localHead + ' tag=' + tag);

  // 0) 前置检查：tag / release 不能已存在
  const existingRelease = await api(`/repos/${owner}/${repo}/releases/tags/${tag}`).catch((e) => {
    if (String(e.message).includes('404')) return null;
    throw e;
  });
  if (existingRelease) throw new Error(`release ${tag} already exists — 不覆盖，终止`);
  const existingTag = await api(`/repos/${owner}/${repo}/git/refs/tags/${tag}`).catch((e) => {
    if (String(e.message).includes('404')) return null;
    throw e;
  });
  if (existingTag) throw new Error(`tag ${tag} already exists — 不覆盖，终止`);

  // 1) 远端 main 现状
  const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/main`);
  const base = ref.object.sha;
  const baseCommit = await api(`/repos/${owner}/${repo}/git/commits/${base}`);
  const baseTreeSha = baseCommit.tree.sha;
  console.log('remote main base=' + base + ' tree=' + baseTreeSha);

  const remoteTree = await api(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
  if (remoteTree.truncated) throw new Error('remote tree truncated — 需要分页，终止');
  const remoteMap = new Map();
  for (const item of remoteTree.tree) {
    if (item.type === 'blob') remoteMap.set(item.path, item.sha);
  }
  console.log('remote tree files=' + remoteMap.size);

  // 2) 本地 HEAD 全量文件（mode/sha/path）
  const lsTree = git(['ls-tree', '-r', 'HEAD'], { encoding: 'utf8' });
  const localEntries = [];
  for (const line of lsTree.split(/\r?\n/)) {
    const m = line.match(/^(\d+) (blob) ([0-9a-f]{40})\t(.+)$/);
    if (m) localEntries.push({ mode: m[1], sha: m[3], path: m[4] });
  }
  console.log('local HEAD files=' + localEntries.length);

  // 3) 差异：上传缺失/不一致的 blob，收集删除项
  const entries = [];
  const deletions = [];
  let uploaded = 0, skipped = 0;
  const localPaths = new Set(localEntries.map((e) => e.path));
  for (const item of localEntries) {
    if (remoteMap.get(item.path) === item.sha) { skipped++; continue; }
    const bytes = git(['cat-file', 'blob', item.sha], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 64 });
    const blob = await api(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: bytes.toString('base64'), encoding: 'base64' })
    });
    entries.push({ path: item.path, mode: item.mode, type: 'blob', sha: blob.sha });
    uploaded++;
    if (uploaded % 50 === 0) console.log('  uploaded ' + uploaded + ' ...');
  }
  for (const [p] of remoteMap) {
    if (!localPaths.has(p)) deletions.push({ path: p, mode: '100644', type: 'blob', sha: null });
  }
  console.log('blobs uploaded=' + uploaded + ' skipped=' + skipped + ' deletions=' + deletions.length);

  // 4) 建 tree（base_tree + 差异项 + 删除项）→ 回读逐条校验
  const newTree = await api(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: [...entries, ...deletions] })
  });
  console.log('newTree=' + newTree.sha + ' (truncated=' + !!newTree.truncated + ')');

  const verifyTree = await api(`/repos/${owner}/${repo}/git/trees/${newTree.sha}?recursive=1`);
  const verifyMap = new Map();
  for (const item of verifyTree.tree) {
    if (item.type === 'blob') verifyMap.set(item.path, item.sha);
  }
  let mismatch = 0;
  for (const item of localEntries) {
    if (verifyMap.get(item.path) !== item.sha) {
      mismatch++;
      if (mismatch <= 5) console.log('  MISMATCH ' + item.path);
    }
  }
  if (verifyMap.size !== localEntries.length) {
    console.log('  size differs: remote=' + verifyMap.size + ' local=' + localEntries.length);
    for (const [p] of verifyMap) if (!localPaths.has(p)) console.log('  EXTRA-ON-REMOTE ' + p);
    mismatch++;
  }
  if (mismatch > 0) throw new Error('tree verification failed: ' + mismatch + ' mismatches — 终止，不推 ref');

  // 5) 快照提交（父 = 远端 main tip）
  const newCommit = await api(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: buildCommitMessage(), tree: newTree.sha, parents: [base] })
  });
  console.log('newCommit=' + newCommit.sha);

  // 6) 推进 main（非 force）
  await api(`/repos/${owner}/${repo}/git/refs/heads/main`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });
  console.log('main updated -> ' + newCommit.sha);

  // 7) 注释标签（触发 release.yml）
  const identity = {
    name: 'jettcck',
    email: '41898282+jettcck@users.noreply.github.com',
    date: new Date().toISOString()
  };
  const tagObj = await api(`/repos/${owner}/${repo}/git/tags`, {
    method: 'POST',
    body: JSON.stringify({
      tag,
      message: `Release ${tag}`,
      object: newCommit.sha,
      type: 'commit',
      tagger: identity
    })
  });
  await api(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: tagObj.sha })
  });
  console.log('tag pushed: ' + tag + ' -> ' + newCommit.sha);
  console.log(JSON.stringify({
    base, pushedCommit: newCommit.sha, newTree: newTree.sha, tag,
    blobUploaded: uploaded, deletions: deletions.length
  }, null, 2));
}

main().catch((error) => { console.error('FAILED: ' + error.message); process.exit(1); });
