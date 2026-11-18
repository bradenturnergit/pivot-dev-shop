// Works out the numbers behind the Insights tab on pivotdevshop.com/shipped
// and saves them as one Firestore document, insights/latest.
//
// Run by the Insights workflow, nightly, never by hand:
//
//   node insights.js <dir>    <dir> holds a full clone of every repo in REPOS
//
// The arithmetic is insights/collect.js. The document is { json, generatedAt }:
// the whole summary as one JSON string, so nested arrays and maps don't run
// into Firestore's rules about either, and the page reads it with one GET.
// Read only by isEditor() (firestore.rules), same as `releases`.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseLog, summarise } = require('./insights/collect');

// The repos counted, and what the tab calls each. Add a repo here, to the
// workflow's clone list and to the INSIGHTS_TOKEN's access, all together.
const REPOS = [
  ['famous-people-app', 'Famous People game'],
  ['famous-people', 'Famous People site & admin'],
  ['pivot-dev-shop', 'Pivot Dev Shop site'],
  ['household-docs', 'Organized'],
  ['garage', 'Garage'],
  ['my-doodles', 'My Doodles'],
];

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function project(root, [repo, name]) {
  const dir = path.join(root, repo);
  if (git(dir, 'rev-parse', '--is-shallow-repository').trim() === 'true') {
    throw new Error(`${repo} is a shallow clone, so its history would be cut short. Clone it in full.`);
  }
  const commits = parseLog(git(dir, 'log', 'HEAD', '--no-merges', '--format=@@%aI|%an|%s', '--numstat'));
  const merges = Number(git(dir, 'rev-list', '--count', '--merges', 'HEAD').trim());
  const files = git(dir, 'ls-files').split('\n').filter(Boolean).map((p) => {
    try { return { path: p, lines: fs.readFileSync(path.join(dir, p), 'utf8').split('\n').length - 1 }; } catch { return { path: p, lines: 0 }; }
  });
  let claudeMd = 0;
  try { claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').split('\n').length - 1; } catch { /* none */ }
  return summarise({ id: repo, name, commits, merges, files, claudeMd });
}

async function main() {
  const root = process.argv[2];
  if (!root) throw new Error('Usage: node insights.js <folder holding the clones>');
  const projects = REPOS.map((r) => project(root, r));
  const generatedAt = new Date().toISOString();
  const json = JSON.stringify({ generatedAt, projects });
  projects.forEach((p) => console.log(`${p.name}: ${p.commits} commits, ${p.prs} merged, ${p.loc} lines`));
  console.log(`${json.length} characters`);

  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault(), projectId: 'pivot-dev-shop' });
  await getFirestore().collection('insights').doc('latest').set({ json, generatedAt });
  console.log('Saved insights/latest.');
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { REPOS, project };
