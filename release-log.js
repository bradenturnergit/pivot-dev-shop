// Adds merged pull requests to the release log at pivotdevshop.com/shipped.
//
// The log is the `releases` collection, one document per pull request, id
// "<repo>-<number>". Run from the Release log workflow, never by hand:
//
//   node release-log.js add      one PR, from PR_REPO / PR_NUMBER / PR_TITLE /
//                                PR_MERGED_AT (what every repo's own Release log
//                                workflow sends when a PR merges into main)
//   node release-log.js import   every entry in data/releases-seed.json — the
//                                history up to the day this was built
//
// Create-only, same rule as the menu import: a document that already exists is
// left alone, so a title or kind corrected in the Firebase console stays
// corrected, and running either mode twice writes nothing the second time.

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { classify } = require('./release-log/classify');

const OWNER = 'bradenturnergit';
const SEED = path.join(__dirname, 'data', 'releases-seed.json');

function fromEnv() {
  const repo = process.env.PR_REPO || '';
  const number = Number(process.env.PR_NUMBER);
  const title = (process.env.PR_TITLE || '').trim();
  const mergedAt = new Date(process.env.PR_MERGED_AT || '');
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`PR_REPO "${repo}" isn't a repository name`);
  if (!Number.isInteger(number) || number < 1) throw new Error(`PR_NUMBER "${process.env.PR_NUMBER}" isn't a PR number`);
  if (!title) throw new Error('PR_TITLE is empty');
  if (isNaN(mergedAt)) throw new Error(`PR_MERGED_AT "${process.env.PR_MERGED_AT}" isn't a date`);
  return {
    id: `${repo}-${number}`,
    repo, number, title: title.slice(0, 300),
    mergedAt: mergedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    url: `https://github.com/${OWNER}/${repo}/pull/${number}`,
    ...classify(repo, title),
  };
}

async function createOnly(db, entries) {
  let added = 0, kept = 0;
  for (const e of entries) {
    try {
      await db.collection('releases').doc(e.id).create(e);
      added++;
      console.log(`added  ${e.id}  [${e.kind}]  ${e.title}`);
    } catch (err) {
      if (err.code !== 6) throw err;   // 6 = ALREADY_EXISTS
      kept++;
      console.log(`exists ${e.id} (left as it is)`);
    }
  }
  console.log(`\n${added} added, ${kept} already there.`);
}

async function main() {
  const mode = process.argv[2];
  let entries;
  if (mode === 'add') entries = [fromEnv()];
  else if (mode === 'import') entries = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  else throw new Error('Usage: node release-log.js add|import');

  initializeApp({ credential: applicationDefault(), projectId: 'pivot-dev-shop' });
  await createOnly(getFirestore(), entries);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
