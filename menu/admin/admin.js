/* Menu Price Editor — menu.pivotdevshop.com/admin
 *
 * Three stages per cafe, never skipped:
 *   edit     in this page only (yellow rows); Preview can show them
 *   Save     writes the edits to that cafe's *draft* collection — not live
 *   Publish  copies the saved drafts to the *live* collection the screens read,
 *            behind a typed confirmation, and records what each price was
 *            before in the cafe's publish log
 *   Discard saved  deletes the cafe's drafts that aren't live, so each item
 *            goes back to its live price. Never touches live.
 *   Undo     puts the last not-yet-undone publish's "before" prices back, live
 *            and draft, and marks that log entry undone — so pressing it again
 *            steps back one more publish
 *
 * Where each cafe's prices live (keep in step with cafePath() in ../index.html):
 *   default   live menuItems          draft menuItemsDraft   log menuPublishes
 *   <cafeId>  live cafes/<id>/items   draft cafes/<id>/draft log cafes/<id>/publishes
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
  const names = { live: ['menuItems', 'items'], draft: ['menuItemsDraft', 'draft'], log: ['menuPublishes', 'publishes'] }[kind];
  return cafeId === 'default' ? [names[0]] : ['cafes', cafeId, names[1]];
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
  const { collection, getDocs, doc, writeBatch, query, orderBy, limit, serverTimestamp } = fsMod;

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
    // One batch: the live prices and the log entry that can undo them land
    // together or not at all. A cafe's list is a few dozen items, well under
    // Firestore's 500 writes per batch.
    publish: async (cafeId, items, changes) => {
      const batch = writeBatch(db);
      items.forEach((it) => batch.set(doc(db, ...cafePath(cafeId, 'live'), it.sku), { name: it.name, sku: it.sku, price: it.price }));
      batch.set(doc(collection(db, ...cafePath(cafeId, 'log'))),
        { at: serverTimestamp(), by: auth.currentUser.email, changes, undone: false });
      await batch.commit();
    },
    discardDrafts: async (cafeId, skus) => {
      const batch = writeBatch(db);
      skus.forEach((sku) => batch.delete(doc(db, ...cafePath(cafeId, 'draft'), sku)));
      await batch.commit();
    },
    lastPublish: async (cafeId) => {
      const snap = await getDocs(query(collection(db, ...cafePath(cafeId, 'log')), orderBy('at', 'desc'), limit(20)));
      const d = snap.docs.find((x) => !x.data().undone);
      if (!d) return null;
      const v = d.data();
      return { id: d.id, at: v.at ? v.at.toDate() : null, by: v.by, changes: v.changes };
    },
    // Puts the "before" prices back in live *and* draft (so they don't show up
    // as a pending change), and marks the log entry undone — one batch.
    undoPublish: async (cafeId, entry) => {
      const batch = writeBatch(db);
      entry.changes.forEach((c) => {
        const data = { name: c.before.name, sku: c.sku, price: c.before.price };
        batch.set(doc(db, ...cafePath(cafeId, 'live'), c.sku), data);
        batch.set(doc(db, ...cafePath(cafeId, 'draft'), c.sku), data);
      });
      batch.update(doc(db, ...cafePath(cafeId, 'log'), entry.id),
        { undone: true, undoneAt: serverTimestamp(), undoneBy: auth.currentUser.email });
      await batch.commit();
    },
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
  const logs = {};
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
    publish: async (id, items, changes) => {
      items.forEach((it) => { store[id].live[it.sku] = { name: it.name, price: it.price }; });
      (logs[id] = logs[id] || []).unshift({ id: String(Date.now()), at: new Date(), by: 'mock@example.com', changes, undone: false });
    },
    discardDrafts: async (id, skus) => { skus.forEach((sku) => { delete store[id].draft[sku]; }); },
    lastPublish: async (id) => { const e = (logs[id] || []).find((x) => !x.undone); return e ? { ...clone(e), at: e.at } : null; },
    undoPublish: async (id, entry) => {
      entry.changes.forEach((c) => { store[id].live[c.sku] = { ...c.before }; store[id].draft[c.sku] = { ...c.before }; });
      logs[id].find((e) => e.id === entry.id).undone = true;
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
  lastPub: null,     // the publish Undo would reverse, or null
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
  $('discardSavedBtn').disabled = !p || u > 0;
  $('discardSavedBtn').title = u ? 'Save or discard your unsaved changes first' : p ? '' : 'No saved changes waiting to go live';
  $('publishBtn').disabled = !p || u > 0;
  $('publishBtn').title = u ? 'Save your changes first' : p ? '' : 'Nothing saved is waiting to go live';
  const L = S.lastPub;
  $('undoBtn').disabled = !L || u > 0 || p > 0;
  $('undoBtn').title = !L ? 'No publish to undo (only publishes made in this editor can be undone)'
    : u || p ? 'Save and publish, or discard, your other changes first' : '';
  $('lastPub').textContent = L ? `Last publish: ${fmtWhen(L.at)} by ${L.by} (${L.changes.length} change${L.changes.length > 1 ? 's' : ''})` : '';
}

function fmtWhen(d) {
  if (!d) return 'just now';
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

  // What customers see right now: the plain board, no preview, no drafts.
  if (!Object.keys(S.live).length) {
    const note = document.createElement('span');
    note.className = 'hint'; note.style.margin = '0';
    note.textContent = 'No live board yet — this cafe goes live on its first Publish.';
    bar.append(note);
  } else {
    const live = document.createElement('a');
    live.id = 'liveLink';
    live.className = 'btn'; live.href = url; live.target = '_blank'; live.rel = 'noopener';
    live.textContent = 'Open live menu board ↗';
    bar.append(live);
  }
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
      Object.assign(S, { cafeId, isNew: true, live: {}, draft: {}, edits: start, lastPub: null });
    } else {
      const [{ live, draft }, lastPub] = await Promise.all([api.loadCafe(cafeId), api.lastPublish(cafeId).catch(() => null)]);
      Object.assign(S, { cafeId, isNew: false, live, draft, edits: {}, lastPub });
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
    if (S.isNew) { knownCafes.push(S.cafeId); renderCafeList(); S.isNew = false; renderCafebar(); }
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

async function discardSaved() {
  const skus = pendingSkus();
  if (!skus.length || unsavedSkus().length) return;
  const lines = skus.slice(0, 15).map((sku) => {
    const d = S.draft[sku], l = S.live[sku];
    return `• ${d.name}: ${money(d.price)} → ${l ? money(l.price) + ' (live price)' : 'removed (never went live)'}`;
  });
  if (skus.length > 15) lines.push(`…and ${skus.length - 15} more`);
  if (!confirm(`Throw away ${skus.length} saved change${skus.length > 1 ? 's' : ''} that ${skus.length > 1 ? "haven't" : "hasn't"} been published?\n\n` +
    lines.join('\n') + '\n\nThe live menu board is not affected.')) return;
  $('discardSavedBtn').disabled = true;
  try {
    await api.discardDrafts(S.cafeId, skus);
    skus.forEach((sku) => { delete S.draft[sku]; });
    clearPreview();
    showMsg(`Discarded ${skus.length} saved change${skus.length > 1 ? 's' : ''}. Those items are back to their live prices.`, 'good');
  } catch (err) {
    showMsg(friendly(err), 'err', true);
  }
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
    'If it\'s wrong, "Undo last publish" puts the previous prices back — but screens will have shown these until you do.';
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
  // What each item was before, so this publish can be undone. An item that
  // wasn't live at all (a new cafe's first publish) has nothing to go back to.
  const changes = items.map((it) => ({ sku: it.sku, before: S.live[it.sku] ? { ...S.live[it.sku] } : null, after: { name: it.name, price: it.price } }));
  $('publishGo').disabled = true;
  try {
    await api.publish(S.cafeId, items, changes);
    items.forEach((it) => { S.live[it.sku] = { name: it.name, price: it.price }; });
    S.lastPub = await api.lastPublish(S.cafeId).catch(() => null);
    renderCafebar();
    $('publishDlg').close();
    showMsg(`Published ${items.length} change${items.length > 1 ? 's' : ''}. The live menu board updates within about a minute.`, 'good');
  } catch (err) {
    $('publishDlg').close();
    showMsg(friendly(err), 'err', true);
  }
  render();
}

function openUndo() {
  const L = S.lastPub;
  if (!L || unsavedSkus().length || pendingSkus().length) return;
  const who = S.cafeId === 'default' ? 'the default menu' : 'cafe ' + S.cafeId;
  const back = L.changes.filter((c) => c.before);
  const noPrev = L.changes.length - back.length;
  $('undoTitle').textContent = `Undo the publish from ${fmtWhen(L.at)}?`;
  $('undoWarn').textContent = `This goes live. Every screen showing ${who} goes back to the prices below within about a minute.` +
    (noPrev ? ` ${noPrev} item${noPrev > 1 ? 's were' : ' was'} published for the first time then and ${noPrev > 1 ? 'have' : 'has'} no earlier price, so ${noPrev > 1 ? 'they stay' : 'it stays'} as ${noPrev > 1 ? 'they are' : 'it is'}.` : '');
  const ul = $('undoList');
  ul.replaceChildren();
  back.forEach((c) => {
    const li = document.createElement('li');
    const now = S.live[c.sku];
    li.textContent = `${c.before.name} (${c.sku}): ${now ? money(now.price) : 'not live'} → ${money(c.before.price)}` +
      (now && now.price !== c.after.price ? ' (changed again since that publish)' : '');
    ul.append(li);
  });
  $('undoConfirm').value = '';
  $('undoGo').disabled = true;
  $('undoGo').dataset.none = back.length ? '' : '1';
  $('undoDlg').showModal();
  $('undoConfirm').focus();
}

async function doUndo() {
  if ($('undoConfirm').value.trim() !== 'UNDO') return;
  const L = S.lastPub;
  const entry = { ...L, changes: L.changes.filter((c) => c.before) };
  $('undoGo').disabled = true;
  try {
    await api.undoPublish(S.cafeId, entry);
    entry.changes.forEach((c) => { S.live[c.sku] = { ...c.before }; S.draft[c.sku] = { ...c.before }; });
    S.lastPub = await api.lastPublish(S.cafeId).catch(() => null);
    $('undoDlg').close();
    showMsg(`Undone. ${entry.changes.length} price${entry.changes.length > 1 ? 's are' : ' is'} back to what ${entry.changes.length > 1 ? 'they were' : 'it was'} before that publish; screens update within about a minute.`, 'good');
  } catch (err) {
    $('undoDlg').close();
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
  $('discardSavedBtn').addEventListener('click', discardSaved);
  $('previewBtn').addEventListener('click', preview);
  $('publishBtn').addEventListener('click', openPublish);
  $('publishCancel').addEventListener('click', () => $('publishDlg').close());
  $('publishConfirm').addEventListener('input', () => { $('publishGo').disabled = $('publishConfirm').value.trim() !== 'PUBLISH'; });
  $('publishGo').addEventListener('click', doPublish);
  $('publishForm').addEventListener('submit', (e) => { e.preventDefault(); doPublish(); });
  $('undoBtn').addEventListener('click', openUndo);
  $('undoCancel').addEventListener('click', () => $('undoDlg').close());
  $('undoConfirm').addEventListener('input', () => { $('undoGo').disabled = $('undoConfirm').value.trim() !== 'UNDO' || $('undoGo').dataset.none === '1'; });
  $('undoGo').addEventListener('click', doUndo);
  $('undoForm').addEventListener('submit', (e) => { e.preventDefault(); doUndo(); });
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
