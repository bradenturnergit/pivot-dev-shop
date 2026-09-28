/* Menu Price Editor — menu.pivotdevshop.com/admin
 *
 * Three stages per cafe, never skipped:
 *   edit     in this page only (yellow rows); Preview can show them
 *   Save     writes the edits to that cafe's *draft* collection — not live
 *   Publish  copies the saved drafts to the *live* collection the screens read,
 *            behind a typed confirmation
 *
 * Where each cafe's prices live (keep in step with cafePath() in ../index.html):
 *   default   live menuItems          draft menuItemsDraft
 *   <cafeId>  live cafes/<id>/items   draft cafes/<id>/draft
 *
 * ?mock=1 runs against in-memory data with no sign-in and no network, so the
 * page can be exercised without touching the database.
 */

const MOCK = new URLSearchParams(location.search).has('mock');
const SDK = 'https://www.gstatic.com/firebasejs/11.0.0/';
const CAFE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- backend */

function cafePath(cafeId, kind) {
  if (cafeId === 'default') return kind === 'draft' ? ['menuItemsDraft'] : ['menuItems'];
  return ['cafes', cafeId, kind === 'draft' ? 'draft' : 'items'];
}

async function firebaseBackend() {
  const res = await fetch('/__/firebase/init.json');
  if (!res.ok) throw new Error('NO_WEB_APP');
  const config = await res.json();
  const [appMod, authMod, fsMod] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  const { collection, getDocs, doc, writeBatch } = fsMod;

  const readMap = async (path) => {
    const snap = await getDocs(collection(db, ...path));
    const out = {};
    snap.forEach((d) => { out[d.id] = { name: String(d.data().name ?? ''), price: Number(d.data().price) }; });
    return out;
  };
  const writeItems = async (path, items, extra) => {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      if (i === 0 && extra) extra(batch);
      items.slice(i, i + 400).forEach((it) =>
        batch.set(doc(db, ...path, it.sku), { name: it.name, sku: it.sku, price: it.price }));
      await batch.commit();
    }
    if (!items.length && extra) { const b = writeBatch(db); extra(b); await b.commit(); }
  };

  return {
    onUser: (cb) => authMod.onAuthStateChanged(auth, (u) => cb(u ? u.email : null)),
    signIn: (email, pw) => authMod.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => authMod.signOut(auth),
    listCafes: async () => (await getDocs(collection(db, 'cafes'))).docs.map((d) => d.id),
    loadCafe: async (cafeId) => {
      const [live, draft] = await Promise.all([
        readMap(cafePath(cafeId, 'live')), readMap(cafePath(cafeId, 'draft'))]);
      return { live, draft };
    },
    saveDrafts: (cafeId, items, isNewCafe) => writeItems(cafePath(cafeId, 'draft'), items,
      isNewCafe ? (b) => b.set(doc(db, 'cafes', cafeId), {}) : null),
    publish: (cafeId, items) => writeItems(cafePath(cafeId, 'live'), items),
  };
}

function mockBackend() {
  const store = {
    default: {
      live: {
        '655715430': { name: 'ACAI BOWL', price: 10.69 },
        '655874409': { name: 'ACAI BOWL WITH NUTELLA®', price: 11.79 },
        '50303': { name: 'CHIA OATMEAL', price: 8.69 },
        '645609567': { name: 'CHIPOTLE CHICKEN CLUB', price: 7.49 },
      },
      draft: {},
    },
    '1001': { live: { '50303': { name: 'CHIA OATMEAL', price: 8.99 } }, draft: {} },
  };
  let listener = () => {};
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    onUser: (cb) => { listener = cb; cb('mock@example.com'); },
    signIn: async () => listener('mock@example.com'),
    signOut: async () => listener(null),
    listCafes: async () => Object.keys(store).filter((k) => k !== 'default'),
    loadCafe: async (id) => clone(store[id] || { live: {}, draft: {} }),
    saveDrafts: async (id, items) => {
      store[id] = store[id] || { live: {}, draft: {} };
      items.forEach((it) => { store[id].draft[it.sku] = { name: it.name, price: it.price }; });
    },
    publish: async (id, items) => {
      items.forEach((it) => { store[id].live[it.sku] = { name: it.name, price: it.price }; });
    },
  };
}

/* ------------------------------------------------------------------ state */

let api;
let boardSkus = new Set();
let knownCafes = [];
const S = {
  cafeId: null,
  isNew: false,      // cafe doesn't exist yet; created on first Save
  live: {},          // sku -> {name, price}  what the screens show now
  draft: {},         // sku -> {name, price}  saved, maybe not live
  edits: {},         // sku -> {name, price}  typed here, not saved
};

const saved = (sku) => S.draft[sku] || S.live[sku];
const current = (sku) => S.edits[sku] || saved(sku);
const same = (a, b) => !!a && !!b && a.name === b.name && a.price === b.price;
const allSkus = () => [...new Set([...Object.keys(S.live), ...Object.keys(S.draft), ...Object.keys(S.edits)])]
  .sort((a, b) => (current(a)?.name || '').localeCompare(current(b)?.name || ''));
const unsavedSkus = () => Object.keys(S.edits).filter((k) => !same(S.edits[k], saved(k)));
const pendingSkus = () => Object.keys(S.draft).filter((k) => !same(S.draft[k], S.live[k]));

function validate(item) {
  const errs = [];
  if (!item.name || !item.name.trim()) errs.push('name');
  if (item.name && item.name.length > 100) errs.push('name');
  if (!Number.isFinite(item.price) || item.price < 0 || item.price >= 1000 ||
      Math.round(item.price * 100) !== Math.round(item.price * 100 * 1000) / 1000) errs.push('price');
  return errs;
}
const invalidSkus = () => unsavedSkus().filter((k) => validate(S.edits[k]).length);
const money = (n) => (Number.isFinite(n) ? '$' + n.toFixed(2) : '—');

/* --------------------------------------------------------------- messages */

function showMsg(text, kind = 'info', sticky = false) {
  const box = $('topMsg');
  box.replaceChildren();
  if (!text) return;
  const p = document.createElement('p');
  p.className = 'msg ' + kind;
  p.textContent = text;
  box.append(p);
  if (!sticky && kind === 'good') setTimeout(() => { if (box.contains(p)) p.remove(); }, 5000);
}

function friendly(err) {
  const code = err && (err.code || err.message) || '';
  if (/NO_WEB_APP/.test(code)) return 'The editor isn\'t connected to Firebase yet: a web app needs registering in the Firebase console (Project settings → Your apps → Add app → Web).';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return 'That email and password don\'t match an editor account.';
  if (/too-many-requests/.test(code)) return 'Too many sign-in attempts. Wait a few minutes and try again.';
  if (/operation-not-allowed/.test(code)) return 'Email/password sign-in isn\'t switched on in Firebase Authentication yet.';
  if (/permission-denied|PERMISSION_DENIED|insufficient permissions/i.test(code)) return 'This account isn\'t allowed to change prices, or the latest database rules haven\'t been deployed. Nothing was changed.';
  if (/unavailable|network/i.test(code)) return 'Couldn\'t reach the database. Check the connection and try again — nothing was changed.';
  return 'Something went wrong: ' + (err && err.message || err);
}

/* ----------------------------------------------------------------- render */

function render() {
  const tbody = $('rows');
  tbody.replaceChildren();
  const q = $('search').value.trim().toLowerCase();
  const onlyBoard = $('onlyBoard').checked && boardSkus.size > 0;
  const skus = allSkus();
  let shown = 0;

  for (const sku of skus) {
    const cur = current(sku);
    if (onlyBoard && !boardSkus.has(sku)) continue;
    if (q && !sku.toLowerCase().includes(q) && !(cur.name || '').toLowerCase().includes(q)) continue;
    shown++;

    const isUnsaved = sku in S.edits && !same(S.edits[sku], saved(sku));
    const isPending = !isUnsaved && S.draft[sku] && !same(S.draft[sku], S.live[sku]);
    const errs = isUnsaved ? validate(S.edits[sku]) : [];

    const tr = document.createElement('tr');
    tr.className = (isUnsaved ? 'unsaved' : isPending ? 'pending' : '') + (errs.length ? ' invalid' : '');

    const tdSku = document.createElement('td'); tdSku.className = 'sku'; tdSku.textContent = sku;

    const tdName = document.createElement('td');
    const nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.value = cur.name; nameIn.setAttribute('aria-label', 'Name for ' + sku);
    if (errs.includes('name')) nameIn.classList.add('bad');
    nameIn.addEventListener('change', () => edit(sku, { name: nameIn.value.trim() }));
    tdName.append(nameIn);

    const tdPrice = document.createElement('td'); tdPrice.className = 'price';
    const priceIn = document.createElement('input');
    priceIn.type = 'number'; priceIn.step = '0.01'; priceIn.min = '0'; priceIn.inputMode = 'decimal';
    priceIn.value = Number.isFinite(cur.price) ? cur.price.toFixed(2) : '';
    priceIn.setAttribute('aria-label', 'Price for ' + (cur.name || sku));
    if (errs.includes('price')) priceIn.classList.add('bad');
    priceIn.addEventListener('change', () => edit(sku, { price: priceIn.value === '' ? NaN : Number(priceIn.value) }));
    tdPrice.append(priceIn);

    const tdLive = document.createElement('td'); tdLive.className = 'live';
    tdLive.textContent = S.live[sku] ? money(S.live[sku].price) : 'not live';

    const tdStatus = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'tag ' + (isUnsaved ? 'unsaved' : isPending ? 'pending' : 'live');
    tag.textContent = isUnsaved ? (errs.length ? 'Fix ' + errs.join(' & ') : 'Unsaved') : isPending ? 'Saved · not live' : 'Live';
    tdStatus.append(tag);

    const tdBoard = document.createElement('td'); tdBoard.className = 'board';
    if (boardSkus.has(sku)) { const b = document.createElement('span'); b.className = 'tag board'; b.textContent = 'On board'; tdBoard.append(b); }

    tr.append(tdSku, tdName, tdPrice, tdLive, tdStatus, tdBoard);
    tbody.append(tr);
  }

  $('count').textContent = skus.length
    ? `Showing ${shown} of ${skus.length} products` + (onlyBoard ? ' (menu board items only — untick the box to see all)' : '')
    : 'This cafe has no products yet.';
  renderActions();
}

function renderActions() {
  const u = unsavedSkus().length, p = pendingSkus().length, bad = invalidSkus().length;
  const parts = [];
  if (S.isNew) parts.push(`New cafe “${S.cafeId}” — Save to create it`);
  if (u) parts.push(`${u} unsaved change${u > 1 ? 's' : ''}`);
  if (p) parts.push(`${p} saved change${p > 1 ? 's' : ''} not live yet`);
  if (!u && !p && !S.isNew) parts.push('Everything here is live.');
  if (bad) parts.push(`${bad} to fix before saving`);
  $('status').textContent = parts.join(' · ');
  $('saveBtn').disabled = !u || bad > 0;
  $('discardBtn').disabled = !u;
  $('publishBtn').disabled = !p || u > 0;
  $('publishBtn').title = u ? 'Save your changes first' : p ? '' : 'Nothing saved is waiting to go live';
}

function renderCafebar() {
  const bar = $('cafebar');
  bar.replaceChildren();
  if (!S.cafeId) return;
  const url = location.origin + (S.cafeId === 'default' ? '/' : '/?cafe=' + encodeURIComponent(S.cafeId));
  const a = document.createElement('span');
  a.append('Editing ');
  const b = document.createElement('strong'); b.textContent = S.cafeId === 'default' ? 'the default menu' : 'cafe ' + S.cafeId;
  a.append(b, ' · this cafe\'s screen address: ');
  const code = document.createElement('code'); code.textContent = url;
  a.append(code);
  bar.append(a);
}

function renderCafeList() {
  const dl = $('cafeList');
  dl.replaceChildren();
  ['default', ...knownCafes].forEach((id) => { const o = document.createElement('option'); o.value = id; dl.append(o); });
}

/* ---------------------------------------------------------------- actions */

function edit(sku, patch) {
  const next = { ...current(sku), ...patch };
  if (same(next, saved(sku))) delete S.edits[sku];
  else S.edits[sku] = next;
  render();
}

async function openCafe(raw) {
  const cafeId = (raw || '').trim();
  if (!cafeId) return;
  if (cafeId !== 'default' && !CAFE_ID_RE.test(cafeId)) {
    showMsg('Cafe IDs can only use letters, numbers, - and _ (up to 40 characters).', 'err');
    return;
  }
  if (unsavedSkus().length && cafeId !== S.cafeId &&
      !confirm(`You have unsaved changes for ${S.cafeId === 'default' ? 'the default menu' : 'cafe ' + S.cafeId}. Switch cafes and lose them?`)) return;

  showMsg('Loading…');
  try {
    const exists = cafeId === 'default' || knownCafes.includes(cafeId);
    if (!exists) {
      if (!confirm(`Cafe “${cafeId}” doesn't exist yet.\n\nCreate it, starting from the default menu's prices? Nothing is saved until you press Save, and nothing goes live until you Publish.`)) { showMsg(''); return; }
      const base = await api.loadCafe('default');
      const start = {};
      for (const sku of new Set([...Object.keys(base.live), ...Object.keys(base.draft)])) start[sku] = base.draft[sku] || base.live[sku];
      Object.assign(S, { cafeId, isNew: true, live: {}, draft: {}, edits: start });
    } else {
      const { live, draft } = await api.loadCafe(cafeId);
      Object.assign(S, { cafeId, isNew: false, live, draft, edits: {} });
    }
    $('cafeInput').value = cafeId;
    try { localStorage.setItem('menuEditor:lastCafe', cafeId); } catch (e) { /* storage blocked */ }
    showMsg('');
    renderCafebar();
    render();
  } catch (err) {
    showMsg(friendly(err), 'err', true);
  }
}

async function save() {
  const skus = unsavedSkus();
  if (!skus.length || invalidSkus().length) return;
  const items = skus.map((sku) => ({ sku, name: S.edits[sku].name.trim(), price: Math.round(S.edits[sku].price * 100) / 100 }));
  $('saveBtn').disabled = true;
  showMsg('Saving…');
  try {
    await api.saveDrafts(S.cafeId, items, S.isNew);
    items.forEach((it) => { S.draft[it.sku] = { name: it.name, price: it.price }; delete S.edits[it.sku]; });
    if (S.isNew) { knownCafes.push(S.cafeId); renderCafeList(); S.isNew = false; }
    clearPreview();
    showMsg(`Saved ${items.length} change${items.length > 1 ? 's' : ''}. Not live yet — use Preview to check, then Publish.`, 'good');
  } catch (err) {
    showMsg(friendly(err), 'err', true);
  }
  render();
}

function discard() {
  if (!unsavedSkus().length) return;
  if (!confirm('Throw away all unsaved changes on this page?')) return;
  S.edits = {};
  if (S.isNew) { Object.assign(S, { cafeId: null, isNew: false }); renderCafebar(); $('cafeInput').value = ''; }
  clearPreview();
  render();
}

function previewKey() { return 'menuPreview:' + S.cafeId; }
function clearPreview() { try { localStorage.removeItem(previewKey()); } catch (e) { /* ignore */ } }

function preview() {
  if (!S.cafeId) return;
  const edits = {};
  unsavedSkus().forEach((sku) => { if (!validate(S.edits[sku]).length) edits[sku] = S.edits[sku].price; });
  try { localStorage.setItem(previewKey(), JSON.stringify(edits)); } catch (e) { /* preview then shows saved drafts only */ }
  const q = new URLSearchParams();
  if (S.cafeId !== 'default') q.set('cafe', S.cafeId);
  q.set('preview', '1');
  window.open('/?' + q.toString(), 'menu-preview');
}

function openPublish() {
  const skus = pendingSkus();
  if (!skus.length || unsavedSkus().length) return;
  const who = S.cafeId === 'default' ? 'the default menu' : 'cafe ' + S.cafeId;
  $('publishTitle').textContent = `Publish ${skus.length} change${skus.length > 1 ? 's' : ''} to ${who}?`;
  $('publishWarn').textContent = `This goes live. Every screen showing ${who} will change within about a minute. ` +
    'There is no undo button — to reverse it, change the prices back, save, and publish again.';
  const ul = $('publishList');
  ul.replaceChildren();
  skus.forEach((sku) => {
    const li = document.createElement('li');
    const d = S.draft[sku], l = S.live[sku];
    li.textContent = `${d.name} (${sku}): ${l ? money(l.price) : 'not live'} → ${money(d.price)}` +
      (l && l.name !== d.name ? ` · name “${l.name}” → “${d.name}”` : '');
    ul.append(li);
  });
  $('publishConfirm').value = '';
  $('publishGo').disabled = true;
  $('publishDlg').showModal();
  $('publishConfirm').focus();
}

async function doPublish() {
  if ($('publishConfirm').value.trim() !== 'PUBLISH') return;
  const skus = pendingSkus();
  const items = skus.map((sku) => ({ sku, ...S.draft[sku] }));
  $('publishGo').disabled = true;
  try {
    await api.publish(S.cafeId, items);
    items.forEach((it) => { S.live[it.sku] = { name: it.name, price: it.price }; });
    $('publishDlg').close();
    showMsg(`Published ${items.length} change${items.length > 1 ? 's' : ''}. The live menu board updates within about a minute.`, 'good');
  } catch (err) {
    $('publishDlg').close();
    showMsg(friendly(err), 'err', true);
  }
  render();
}

/* ------------------------------------------------------------------- boot */

async function loadBoardSkus() {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    boardSkus = new Set([...html.matchAll(/data-brink-id="([^"]+)"/g)].map((m) => m[1]));
  } catch (e) { boardSkus = new Set(); }
  if (!boardSkus.size) { $('onlyBoard').checked = false; $('onlyBoard').disabled = true; }
}

function wire() {
  $('signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('signinBtn').disabled = true;
    try { await api.signIn($('email').value.trim(), $('password').value); showMsg(''); }
    catch (err) { showMsg(friendly(err), 'err', true); }
    $('signinBtn').disabled = false;
  });
  $('signOut').addEventListener('click', async () => {
    if (unsavedSkus().length && !confirm('Sign out and lose your unsaved changes?')) return;
    S.edits = {};
    await api.signOut();
  });
  $('cafeOpen').addEventListener('click', () => openCafe($('cafeInput').value));
  $('cafeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') openCafe($('cafeInput').value); });
  $('search').addEventListener('input', render);
  $('onlyBoard').addEventListener('change', render);
  $('saveBtn').addEventListener('click', save);
  $('discardBtn').addEventListener('click', discard);
  $('previewBtn').addEventListener('click', preview);
  $('publishBtn').addEventListener('click', openPublish);
  $('publishCancel').addEventListener('click', () => $('publishDlg').close());
  $('publishConfirm').addEventListener('input', () => { $('publishGo').disabled = $('publishConfirm').value.trim() !== 'PUBLISH'; });
  $('publishGo').addEventListener('click', doPublish);
  $('publishForm').addEventListener('submit', (e) => { e.preventDefault(); doPublish(); });
  window.addEventListener('beforeunload', (e) => { if (unsavedSkus().length) { e.preventDefault(); e.returnValue = ''; } });
}

async function boot() {
  wire();
  try {
    api = MOCK ? mockBackend() : await firebaseBackend();
  } catch (err) {
    showMsg(friendly(err), 'err', true);
    return;
  }
  if (MOCK) showMsg('Practice mode: made-up data, nothing is saved to the real database.', 'info', true);
  await loadBoardSkus();

  api.onUser(async (email) => {
    const signedIn = !!email;
    $('signin').classList.toggle('hidden', signedIn);
    $('editor').classList.toggle('hidden', !signedIn);
    $('actions').classList.toggle('hidden', !signedIn);
    $('who').classList.toggle('hidden', !signedIn);
    $('whoEmail').textContent = email || '';
    if (!signedIn) { Object.assign(S, { cafeId: null, isNew: false, live: {}, draft: {}, edits: {} }); return; }
    try { knownCafes = (await api.listCafes()).sort(); } catch (err) { knownCafes = []; showMsg(friendly(err), 'err', true); }
    renderCafeList();
    let last = 'default';
    try { last = localStorage.getItem('menuEditor:lastCafe') || 'default'; } catch (e) { /* ignore */ }
    if (last !== 'default' && !knownCafes.includes(last)) last = 'default';
    await openCafe(last);
  });
}

boot();
