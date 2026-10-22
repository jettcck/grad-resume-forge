'use strict';
// Verify the deployed app.asar actually contains the job-pool UI.
const asar = require('@electron/asar');
const path = require('path');

const asarPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'grad-resume-forge', 'resources', 'app.asar');
const all = asar.listPackage(asarPath);

function find(suffix) {
  const hit = all.find((f) => f.replace(/\\/g, '/').endsWith(suffix));
  if (!hit) throw new Error('missing in asar: ' + suffix);
  return hit.replace(/^[\\/]/, '');
}
const read = (suffix) => asar.extractFile(asarPath, find(suffix)).toString('utf8');

const html = read('src/renderer/index.html');
const css = read('src/renderer/styles.css');
const js = read('src/renderer/app.js');

console.log('nav routes:', [...html.matchAll(/data-route="(\w+)"/g)].map((m) => m[1]).join(','));
console.log('route-jobs section:', html.includes('route-jobs'));
console.log('css .job-list:', css.includes('.job-list'));
console.log('css .job-card:', css.includes('.job-card'));
console.log('js renderJobs:', js.includes('function renderJobs'));
console.log('js calls all jobs apis:', ['jobs.list', 'jobs.get', 'jobs.save', 'jobs.mark', 'jobs.remove']
  .every((k) => js.includes('api.' + k)));
