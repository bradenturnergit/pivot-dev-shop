// Run with: npm test (node --test, no packages needed)
// Checks on the pages themselves: nothing they point at is missing, and the
// rules in CLAUDE.md that a browser enforces silently still hold.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const firebase = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
const site = firebase.hosting.find((h) => h.site === 'pivot-dev-shop');
const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const cssFiles = (dir = PUBLIC) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? cssFiles(path.join(dir, d.name)) : d.name.endsWith('.css') ? [path.join(dir, d.name)] : []);

const rewrites = Object.fromEntries(site.rewrites.map((r) => [r.source, r.destination]));
// What a path on the live site serves, or null if it would 404.
function served(urlPath) {
  const p = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  if (p === '/' || p === '') return 'index.html';
  if (rewrites[p]) return rewrites[p].slice(1);
  const file = p.replace(/^\//, '');
  return fs.existsSync(path.join(PUBLIC, file)) && fs.statSync(path.join(PUBLIC, file)).isFile() ? file : null;
}
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test('found the pages (so the checks below are looking at something)', () => {
  assert.ok(pages.length >= 6, pages.join(', '));
});

test('every link, image and stylesheet on a page exists', () => {
  const missing = [];
  for (const page of pages) {
    const html = read(page);
    const refs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1])
      .concat([...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+/)[0])));
    for (const ref of refs) {
      if (/^(https?:|mailto:|tel:|data:)/.test(ref)) continue;
      if (ref.startsWith('#')) {
        if (ref.length > 1 && !ids(html).has(ref.slice(1))) missing.push(`${page}: ${ref} (no element with that id)`);
        continue;
      }
      const abs = ref.startsWith('/') ? ref : '/' + ref;
      const file = served(abs);
      if (!file) { missing.push(`${page}: ${ref}`); continue; }
      const hash = ref.split('#')[1];
      if (hash && file.endsWith('.html') && !ids(read(file)).has(hash)) missing.push(`${page}: ${ref} (no #${hash} on ${file})`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every font and image a stylesheet points at exists', () => {
  const missing = [];
  for (const css of cssFiles()) {
    const text = fs.readFileSync(css, 'utf8');
    for (const [, ref] of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (/^(data:|https?:)/.test(ref)) continue;
      const target = ref.startsWith('/') ? path.join(PUBLIC, ref) : path.join(path.dirname(css), ref);
      if (!fs.existsSync(target.split(/[?#]/)[0])) missing.push(`${path.relative(PUBLIC, css)}: ${ref}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every clean URL points at a page that exists', () => {
  for (const [source, dest] of Object.entries(rewrites)) {
    assert.ok(fs.existsSync(path.join(PUBLIC, dest)), `${source} → ${dest} is missing`);
  }
  // Out in the world already: see "The case study lives here".
  assert.equal(rewrites['/case-study'], '/case-study.html');
});

test('every brand page is counted by analytics; /shipped never is', () => {
  for (const page of pages) {
    const has = /<script src="\/analytics\.js" defer><\/script>/.test(read(page));
    if (page === 'shipped.html') assert.equal(has, false, 'shipped.html must load no analytics');
    else assert.ok(has, `${page} is missing the analytics.js line, so it isn't counted`);
  }
});

test('no inline scripts or onclick= attributes (the CSP refuses them)', () => {
  const found = [];
  for (const page of pages) {
    const html = read(page);
    for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
      if (/\ssrc=/.test(tag) || /type="application\/ld\+json"/.test(tag)) continue;
      found.push(`${page}: ${tag}`);
    }
    for (const [attr] of html.matchAll(/<[^>]+\son[a-z]+=/g)) found.push(`${page}: ${attr.slice(0, 60)}`);
  }
  assert.deepEqual(found, []);
  const csp = site.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline/);
});

test("no font: shorthand that mixes values with a var() (WebKit drops it)", () => {
  const bad = [];
  const sources = pages.map((p) => [p, read(p)]).concat(cssFiles().map((c) => [path.relative(PUBLIC, c), fs.readFileSync(c, 'utf8')]));
  for (const [name, text] of sources) {
    for (const [decl] of text.matchAll(/(?<![-\w])font:\s*[^;"}]*/g)) {
      if (/var\(/.test(decl) && !/^font:\s*var\([^)]*\)\s*$/.test(decl.trim())) bad.push(`${name}: ${decl.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('/shipped stays out of search on its own, not only through the pre-launch block', () => {
  const block = site.headers.find((h) => h.regex && h.regex.includes('shipped'));
  assert.ok(block, 'no header block of its own for /shipped');
  const keys = Object.fromEntries(block.headers.map((h) => [h.key, h.value]));
  assert.match(keys['X-Robots-Tag'], /noindex/);
  assert.equal(keys['Cache-Control'], 'no-store');
  assert.match(read('shipped.html'), /<script src="\/shipped\.js\?v=\d+" defer><\/script>/);
});
