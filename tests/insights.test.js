// The arithmetic behind the Insights tab (insights/collect.js).
const test = require('node:test');
const assert = require('node:assert');
const { kindOf, local, parseLog, summarise } = require('../insights/collect');
const { REPOS } = require('../insights');

const LOG = [
  '@@2026-11-10T03:30:00+00:00|Claude|Add the | pipe to a title',
  '10\t2\tsrc/a.js',
  '-\t-\tpublic/photo.jpg',
  '',
  '@@2026-11-10T15:00:00-05:00|Braden Turner|Fix a typo',
  '1\t1\tREADME.md',
].join('\n');

test('parseLog reads each commit, keeps a | in the subject and skips binary files', () => {
  const c = parseLog(LOG);
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c[0], { at: '2026-11-10T03:30:00+00:00', author: 'Claude', subject: 'Add the | pipe to a title', lines: 12 });
  assert.strictEqual(c[1].lines, 2);
});

test('times are Eastern: 03:30 UTC Tuesday is 10:30pm Monday', () => {
  assert.deepStrictEqual(local('2026-11-10T03:30:00Z'), { day: '2026-11-09', hour: 22, weekday: 0 });
});

test('kindOf counts code and leaves out lock files and images', () => {
  assert.strictEqual(kindOf('src/App.jsx'), 'JavaScript');
  assert.strictEqual(kindOf('firestore.rules'), 'Firestore rules');
  assert.strictEqual(kindOf('package-lock.json'), null);
  assert.strictEqual(kindOf('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'), null);
  assert.strictEqual(kindOf('public/photo.jpg'), null);
});

test('summarise adds it up for one project', () => {
  const s = summarise({
    id: 'x', name: 'X', commits: parseLog(LOG), merges: 3, claudeMd: 40,
    files: [{ path: 'src/a.js', lines: 100 }, { path: 'README.md', lines: 20 }, { path: 'big.json', lines: 50000 }, { path: 'a.png', lines: 3 }],
  });
  assert.strictEqual(s.commits, 2);
  assert.strictEqual(s.prs, 3);
  assert.strictEqual(s.claude, 1);
  assert.strictEqual(s.loc, 120); // the 50,000-line file is generated data, not code
  assert.deepStrictEqual(s.langs, { JavaScript: 100, Docs: 20 });
  assert.deepStrictEqual(s.daily, { '2026-11-09': 1, '2026-11-10': 1 });
  assert.strictEqual(s.first, '2026-11-09');
  assert.strictEqual(s.calendarDays, 2);
  assert.strictEqual(s.hours[22], 1);
  assert.strictEqual(s.hours[15], 1);
  assert.strictEqual(s.weekdays.reduce((a, b) => a + b), 2);
  assert.strictEqual(s.biggest[0].title, 'Add the | pipe to a title');
});

test('the workflow clones exactly the repos insights.js counts', () => {
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'insights.yml'), 'utf8');
  const cloned = (yml.match(/for repo in ([^;]+);/) || [])[1].trim().split(/\s+/);
  assert.deepStrictEqual(cloned, REPOS.map(([r]) => r));
});
