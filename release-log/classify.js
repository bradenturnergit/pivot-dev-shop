// Which solution a merged pull request belongs to, and whether it reads as a
// feature, a fix or behind-the-scenes work. Pure, so release-log.js and its test
// share one copy. The kind is a guess from the title — good enough for a list
// one person reads, and a wrong one is a one-field edit in the Firebase console.

const REPOS = {
  'garage':            { solution: 'garage',        part: 'Garage' },
  'household-docs':    { solution: 'organized',     part: 'Organized' },
  'famous-people-app': { solution: 'famous-people', part: 'Game' },
  'famous-people':     { solution: 'famous-people', part: 'Admin & website' },
  'pivot-dev-shop':    { solution: 'pivot-dev-shop', part: 'Website' },
};

// pivot-dev-shop also holds the menu board, which is its own product.
const MENU = /menu|JavaBlender|cafe|flatten script/i;

const BEHIND = /workflow|Node 20|CLAUDE\.md|PR template|Vitest|unit-test|emulator|service account|output style|index audit|indexes endpoint|index file|backup|restore procedure|TTL|drift|default configuration|Firestore rules|\brules\b|Deploy the|deploys|\bCI\b|copy-preview|loadtest|fastlane|TestFlight|ios-deploy|AASA|Team ID|stub|\.json now|visibility script|data scripts|Project settings|isAdmin|Mixpanel|GA4|Google Analytics|Track |tag events|session replay|cleanup script|deploy key|icon generation|release log/i;
const FIX = /^(Fix|Stop|Don't|Prevent|Cover the|Revert|Ensure)\b|\bfix\b/i;

function classify(repo, title) {
  const base = REPOS[repo] || { solution: repo, part: repo };
  const where = repo === 'pivot-dev-shop' && MENU.test(title)
    ? { solution: 'menu-board', part: 'Menu board' }
    : base;
  const kind = BEHIND.test(title) ? 'behind' : FIX.test(title) ? 'fix' : 'feature';
  return { ...where, kind };
}

module.exports = { classify, REPOS };
