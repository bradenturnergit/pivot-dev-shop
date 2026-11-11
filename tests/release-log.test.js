// Run with: npm test (node --test, no packages needed)
// The release log at /shipped: which project and kind each merged pull request
// lands under, and what a merge notification is turned into.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, REPOS } = require('../release-log/classify');
const { fromEnv } = require('../release-log');

test('each repository lands under its own project', () => {
  assert.deepEqual(
    Object.fromEntries(Object.keys(REPOS).map((r) => [r, classify(r, 'Add a thing').solution])),
    {
      'garage': 'garage',
      'household-docs': 'organized',
      'famous-people-app': 'famous-people',
      'famous-people': 'famous-people',
      'pivot-dev-shop': 'pivot-dev-shop',
      'my-doodles': 'my-doodles',
    },
  );
  assert.equal(classify('famous-people-app', 'x').part, 'Game');
  assert.equal(classify('famous-people', 'x').part, 'Admin & website');
});

test("this repo's menu work goes under Menu board, the rest under Website", () => {
  assert.equal(classify('pivot-dev-shop', 'Undo last publish on the menu editor').solution, 'menu-board');
  assert.equal(classify('pivot-dev-shop', 'Salted Caramel JavaBlender photo').solution, 'menu-board');
  assert.equal(classify('pivot-dev-shop', 'Add the My Doodles write-up').solution, 'pivot-dev-shop');
  // Only this repo: another repo's title mentioning a menu stays where it is.
  assert.equal(classify('garage', 'Menu of services on the car card').solution, 'garage');
});

test('kind is guessed from the title', () => {
  assert.equal(classify('garage', 'Put car reminders on the shared calendar').kind, 'feature');
  assert.equal(classify('garage', 'Fix the due date on short months').kind, 'fix');
  assert.equal(classify('garage', "Don't send the same reminder twice").kind, 'fix');
  assert.equal(classify('garage', 'Stop the banner showing offline').kind, 'fix');
  assert.equal(classify('garage', 'Run the tests in CI on every pull request').kind, 'behind');
  assert.equal(classify('famous-people-app', 'Docs: TestFlight builds ship from Xcode Cloud').kind, 'behind');
  // Behind the scenes wins over fix: a workflow fix is still plumbing.
  assert.equal(classify('garage', 'Fix the deploy workflow').kind, 'behind');
});

test('an unknown repository still gets an entry, named after itself', () => {
  assert.deepEqual(classify('new-thing', 'Add a page'), { solution: 'new-thing', part: 'new-thing', kind: 'feature' });
});

const env = (over) => {
  const keys = { PR_REPO: 'garage', PR_NUMBER: '24', PR_TITLE: '  Test the reminder math  ', PR_MERGED_AT: '2026-11-05T03:30:27.123Z', ...over };
  const saved = {};
  for (const [k, v] of Object.entries(keys)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fromEnv(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

test('a merge notification becomes one entry, id <repo>-<number>', () => {
  assert.deepEqual(env({}), {
    id: 'garage-24', repo: 'garage', number: 24, title: 'Test the reminder math',
    mergedAt: '2026-11-05T03:30:27Z',
    url: 'https://github.com/bradenturnergit/garage/pull/24',
    solution: 'garage', part: 'Garage', kind: 'feature',
  });
  assert.equal(env({ PR_TITLE: 'x'.repeat(400) }).title.length, 300);
});

test('a bad notification is refused rather than written', () => {
  assert.throws(() => env({ PR_REPO: '../garage' }), /isn't a repository name/);
  assert.throws(() => env({ PR_REPO: undefined }), /isn't a repository name/);
  assert.throws(() => env({ PR_NUMBER: '0' }), /isn't a PR number/);
  assert.throws(() => env({ PR_NUMBER: '2.5' }), /isn't a PR number/);
  assert.throws(() => env({ PR_TITLE: '   ' }), /PR_TITLE is empty/);
  assert.throws(() => env({ PR_MERGED_AT: 'yesterday' }), /isn't a date/);
});
