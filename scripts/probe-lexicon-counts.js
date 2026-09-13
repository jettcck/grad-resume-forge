'use strict';

// Probe: verify that the counts claimed in the READMEs match the real lexicons.
// Run: node scripts/probe-lexicon-counts.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'lexicon.ts'), 'utf8');

const countArr = (name) => {
  const i = src.indexOf('const ' + name);
  if (i < 0) return 'not found';
  const j = src.indexOf('];', i);
  const body = src.slice(i, j < 0 ? src.length : j);
  return (body.match(/'[^']*'/g) || []).length;
};

['AI_CLICHES', 'AI_CLICHES_SOFT', 'AI_EN_WORDS', 'EMPTY_ADJECTIVES', 'EMPTY_ADJ_KEEP_HEADS', 'EXTRA_VERB_START_CHARS', 'JD_REQUIRED_MARKERS', 'JD_NICE_MARKERS']
  .forEach((n) => console.log((n + ' ').padEnd(24) + '= ' + countArr(n)));

const dIdx = src.indexOf('const STRONG_VERBS');
const seg = src.slice(dIdx, src.indexOf('};', dIdx));
const keys = [...seg.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
console.log('STRONG_VERBS domains'.padEnd(24) + '= ' + keys.length + ' -> ' + keys.join(', '));

const W = src.indexOf('const WEAK_TO_STRONG');
if (W >= 0) {
  const wseg = src.slice(W, src.indexOf('};', W));
  console.log('WEAK_TO_STRONG entries'.padEnd(24) + '= ' + ((wseg.match(/'[^']*'/g) || []).length / 2));
}

const R = src.indexOf('const ROLE_SKILLS');
if (R >= 0) {
  const rseg = src.slice(R, src.indexOf('};', R));
  console.log('ROLE_SKILLS groups'.padEnd(24) + '= ' + [...rseg.matchAll(/^ {2}(\w+):/gm)].length);
}
