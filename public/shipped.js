/* What's shipped — pivotdevshop.com/shipped
 *
 * Braden's private list of every pull request merged into main across his
 * repos, grouped by solution. The entries are the `releases` collection in
 * Firestore, written by the Release log workflow (release-log.js); this page
 * only reads them.
 *
 * Private means locked, not just unlisted: firestore.rules lets only the
 * addresses in isEditor() read `releases`, so without signing in this page has
 * nothing to show. Same email/password accounts as the menu price editor.
 *
 * No Firebase SDK. Sign-in and the read are three plain REST calls, so the
 * site-wide CSP only needs those hosts in connect-src and script-src stays
 * 'self'. The refresh token is kept in localStorage so a return visit doesn't
 * ask for the password again; Sign out forgets it.
 */

(() => {
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'shipped:session';
  const VIEW_KEY = 'shipped:view';

  const SOLUTIONS = {
    'garage':         { name: 'Garage', site: 'https://garage.pivotdevshop.com', blurb: 'Car maintenance and costs' },
    'organized':      { name: 'Organized', site: 'https://organized.pivotdevshop.com', blurb: 'Household mail and paperwork' },
    'famous-people':  { name: 'Famous People', site: 'https://playfamouspeople.com', blurb: 'The party game, its admin and website' },
    'my-doodles':     { name: 'My Doodles', site: 'https://mydoodles.pivotdevshop.com', blurb: 'A gallery of sketchbook doodles' },
    'menu-board':     { name: 'Menu Board', site: 'https://menu.pivotdevshop.com', blurb: 'Cafe menu screen and price editor' },
    'pivot-dev-shop': { name: 'Pivot Dev Shop website', site: 'https://pivotdevshop.com', blurb: 'The company site' },
  };
  // The short name on a result's project pill, when the list is by date.
  const SHORT = { 'pivot-dev-shop': 'Website' };
  const KIND_LABEL = { feature: 'Feature', fix: 'Fix', behind: 'Behind the scenes' };
  // The entries the Project filter lets through; everything below reads these.
  const inProject = () => rows.filter((r) => project === 'all' || r.solution === project);

  let config = null;   // { apiKey, projectId }
  let session = null;  // { email, refreshToken, idToken, expires }
  let rows = [];

  const kinds = new Set(['feature', 'fix']);
  const open = new Set();
  // When: 'all' shows the solution groups; anything else shows one list by date.
  let range = 'all';
  // Which chart the By project card draws: 'bars', 'tiles' or 'days'.
  let viz = 'bars';
  // Project: 'all', or one solution id, narrowing every view to that project.
  let project = 'all';
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (v) { kinds.clear(); v.kinds.forEach((k) => kinds.add(k)); v.open.forEach((g) => open.add(g)); }
    if (v && v.range) range = v.range;
    if (v && ['bars', 'tiles', 'days'].includes(v.viz)) viz = v.viz;
    if (v && typeof v.project === 'string') project = v.project;
  } catch (e) { /* storage blocked: defaults are fine */ }
  const rememberView = () => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ kinds: [...kinds], open: [...open], range, viz, project })); } catch (e) { /* ignore */ }
  };

  /* ------------------------------------------------------------ backend */

  async function loadConfig() {
    const res = await fetch('/__/firebase/init.json');
    if (!res.ok) throw new Error("This site's Firebase settings couldn't be loaded, so sign-in isn't available here.");
    const c = await res.json();
    return { apiKey: c.apiKey, projectId: c.projectId };
  }

  async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data.error && data.error.message) || `HTTP ${res.status}`);
      err.code = err.message;
      throw err;
    }
    return data;
  }

  async function signIn(email, password) {
    const d = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`,
      { email, password, returnSecureToken: true });
    return { email: d.email, refreshToken: d.refreshToken, idToken: d.idToken, expires: Date.now() + (Number(d.expiresIn) - 60) * 1000 };
  }

  async function refresh(s) {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken }),
    });
    if (!res.ok) throw new Error('SESSION_EXPIRED');
    const d = await res.json();
    return { ...s, refreshToken: d.refresh_token, idToken: d.id_token, expires: Date.now() + (Number(d.expires_in) - 60) * 1000 };
  }

  async function idToken() {
    if (!session.idToken || Date.now() > session.expires) {
      session = await refresh(session);
      saveSession();
    }
    return session.idToken;
  }

  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ email: session.email, refreshToken: session.refreshToken })); } catch (e) { /* ignore */ }
  }
  function forgetSession() {
    session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  // Firestore REST returns typed values: { stringValue }, { integerValue }, …
  const plain = (v) => v.stringValue ?? (v.integerValue != null ? Number(v.integerValue) : v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? null);

  async function loadReleases() {
    const out = [];
    let pageToken = '';
    do {
      const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/releases?pageSize=300`
        + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${await idToken()}` } });
      if (res.status === 403) throw new Error('NOT_ALLOWED');
      if (!res.ok) throw new Error(`The release log couldn't be read (HTTP ${res.status}).`);
      const d = await res.json();
      (d.documents || []).forEach((doc) => {
        const r = {};
        Object.entries(doc.fields || {}).forEach(([k, v]) => { r[k] = plain(v); });
        if (r.mergedAt && r.title) out.push(r);
      });
      pageToken = d.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  /* ------------------------------------------------------------ screens */

  function show(which) {
    $('signin').hidden = which !== 'signin';
    $('log').hidden = which !== 'log';
    $('who').hidden = which !== 'log';
  }
  function status(text) { $('status').textContent = text || ''; $('status').hidden = !text; }
  function signinMsg(text, isError) { const m = $('signin-msg'); m.textContent = text || ''; m.classList.toggle('err', !!isError); }

  function friendly(code) {
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(code)) return "That email and password don't match. Check them and try again.";
    if (/TOO_MANY_ATTEMPTS/.test(code)) return 'Too many tries in a row. Wait a few minutes, or reset your password below.';
    if (/USER_DISABLED/.test(code)) return 'This account has been switched off in Firebase Authentication.';
    if (/MISSING_PASSWORD/.test(code)) return 'Enter your password.';
    return `Sign-in didn't work (${code}).`;
  }

  async function openLog() {
    show('log');
    $('who-email').textContent = session.email;
    status('Loading…');
    try {
      rows = await loadReleases();
      checkedAt = new Date();
      status('');
      render();
    } catch (err) {
      if (err.message === 'NOT_ALLOWED') {
        forgetSession();
        show('signin');
        status('');
        signinMsg('That account is signed in but isn\'t allowed to see the release log. Use the address listed in isEditor() in firestore.rules.', true);
      } else if (err.message === 'SESSION_EXPIRED') {
        forgetSession();
        show('signin');
        status('');
        signinMsg('Your sign-in has expired. Sign in again.', true);
      } else {
        status(err.message);
      }
    }
  }

  /* ------------------------------------------------------------ render */

  const fmtDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const fmtChecked = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  let checkedAt = null; // when the list was last read, for the summary line
  const fmtDayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    });
    kids.forEach((c) => c && n.append(c));
    return n;
  }

  // A merge's calendar day where Braden is, as YYYY-MM-DD (what a date input holds).
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
  // "Today" / "Yesterday" by the browser's calendar day, else "Oct 26".
  const lastShipped = (iso) => {
    const d = new Date(iso), now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : fmtDay.format(d);
  };
  const fmtKey = (k) => fmtDay.format(new Date(`${k}T12:00:00`));

  // The from/to days (inclusive) the When filter picks, and how to say it.
  // Null when the dates it needs haven't been filled in yet.
  function pickedDays() {
    if (range === 'today') return { from: daysAgo(0), to: daysAgo(0), words: 'today' };
    if (range === '7') return { from: daysAgo(6), to: daysAgo(0), words: 'in the last 7 days' };
    if (range === '30') return { from: daysAgo(29), to: daysAgo(0), words: 'in the last 30 days' };
    const a = $('from').value, b = $('to').value;
    if (range === 'day') return a ? { from: a, to: a, words: `on ${fmtKey(a)}` } : null;
    if (!a && !b) return null;
    const [from, to] = [a || b, b || a].sort();
    return { from, to, words: from === to ? `on ${fmtKey(from)}` : `between ${fmtKey(from)} and ${fmtKey(to)}` };
  }

  function renderResults() {
    const box = $('results');
    box.replaceChildren();
    const w = pickedDays();
    if (!w) {
      box.append(el('p', { class: 'note', text: range === 'day' ? 'Pick a date above.' : 'Pick the dates above.' }));
      return;
    }
    const shown = inProject()
      .filter((r) => kinds.has(r.kind))
      .filter((r) => { const k = dayKey(new Date(r.mergedAt)); return k >= w.from && k <= w.to; })
      .sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
    box.append(el('h2', { text: `${shown.length} ${shown.length === 1 ? 'change' : 'changes'} shipped ${w.words}` }));
    if (!shown.length && range === 'today') {
      box.append(el('p', { class: 'note', text: kinds.size < 3 ? 'Nothing shipped yet today, or nothing of the types turned on above.' : 'Nothing shipped yet today.' }));
      return;
    }
    if (!shown.length) {
      box.append(el('p', { class: 'note', text: kinds.size < 3 ? 'Nothing here. Try a wider range, or turn on another filter above.' : 'Nothing here. Try a wider range.' }));
      return;
    }
    // One block per day, each with its own heading and count, so days read as
    // separate groups rather than one long run of rows.
    const perDay = new Map();
    shown.forEach((r) => { const k = dayKey(new Date(r.mergedAt)); perDay.set(k, (perDay.get(k) || 0) + 1); });
    let day = '', ul = null;
    shown.forEach((r) => {
      const k = dayKey(new Date(r.mergedAt));
      if (k !== day) {
        day = k;
        const n = perDay.get(k);
        const block = el('div', { class: 'day' },
          el('div', { class: 'day-head' },
            el('span', { class: 'day-name', text: fmtDayLong.format(new Date(`${k}T12:00:00`)) }),
            el('span', { class: 'day-count', text: `${n} ${n === 1 ? 'change' : 'changes'}` })));
        ul = el('ul');
        block.append(ul);
        box.append(block);
      }
      const info = SOLUTIONS[r.solution] || { name: r.solution };
      const title = el('span', { class: 'title', text: r.title });
      if (r.solution === 'famous-people' && r.part) title.append(el('span', { class: 'part', text: r.part }));
      const right = el('span', { class: 'right' },
        el('span', { class: 'pill proj', text: SHORT[r.solution] || info.name }),
        el('span', { class: `pill ${r.kind}`, text: KIND_LABEL[r.kind] || r.kind }));
      if (r.url) right.append(el('a', { class: 'pr', href: r.url, target: '_blank', rel: 'noopener', text: r.number ? `#${r.number}` : 'commit' }));
      ul.append(el('li', {}, title, right));
    });
  }


  /* ------------------------------------------------------------ by project */

  // Day keys are YYYY-MM-DD; move one by n calendar days.
  const shiftKey = (k, n) => { const d = new Date(`${k}T12:00:00`); d.setDate(d.getDate() + n); return dayKey(d); };
  const spanDays = (from, to) => Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000) + 1;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const KIND_ORDER = ['feature', 'fix', 'behind'];
  const KIND_SHORT = { feature: ['feature', 'features'], fix: ['fix', 'fixes'], behind: ['behind the scenes', 'behind the scenes'] };

  // The columns of the By day chart: single days up to a month, then weeks,
  // then months, so a long range still fits on a phone.
  function buckets(from, to) {
    const n = spanDays(from, to);
    const out = [];
    out.unit = n <= 31 ? 'day' : n <= 26 * 7 ? 'week' : 'month';
    if (n <= 31) {
      for (let k = from; k <= to; k = shiftKey(k, 1)) out.push({ from: k, to: k });
    } else if (n <= 26 * 7) {
      for (let k = from; k <= to; k = shiftKey(k, 7)) out.push({ from: k, to: [shiftKey(k, 6), to].sort()[0] });
    } else {
      let k = from;
      while (k <= to) {
        const d = new Date(`${k}T12:00:00`);
        const end = dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        out.push({ from: k, to: [end, to].sort()[0] });
        k = shiftKey(end, 1);
      }
    }
    return out;
  }

  // Per solution, for the picked dates and the same number of days just before.
  function projectStats(w) {
    const n = spanDays(w.from, w.to);
    const prev = { from: shiftKey(w.from, -n), to: shiftKey(w.from, -1) };
    const cols = buckets(w.from, w.to);
    const stats = new Map();
    const stat = (id) => {
      if (!stats.has(id)) stats.set(id, { id, total: 0, prev: 0, feature: 0, fix: 0, behind: 0, cols: cols.map(() => 0), last: null });
      return stats.get(id);
    };
    const pool = inProject();
    pool.forEach((r) => stat(r.solution)); // every project shows, even a quiet one
    pool.filter((r) => kinds.has(r.kind)).forEach((r) => {
      const k = dayKey(new Date(r.mergedAt));
      const s = stat(r.solution);
      if (k >= prev.from && k <= prev.to) s.prev += 1;
      if (k < w.from || k > w.to) return;
      s.total += 1;
      s[r.kind] = (s[r.kind] || 0) + 1;
      const i = cols.findIndex((c) => k >= c.from && k <= c.to);
      if (i >= 0) s.cols[i] += 1;
      if (!s.last || r.mergedAt > s.last) s.last = r.mergedAt;
    });
    const list = [...stats.values()].sort((a, b) => b.total - a.total || b.prev - a.prev
      || (SOLUTIONS[a.id] || { name: a.id }).name.localeCompare((SOLUTIONS[b.id] || { name: b.id }).name));
    return { list, cols, n };
  }

  // "the 7 days before", "yesterday", … — what the comparison is against.
  function prevWords(n) {
    if (range === 'today') return 'yesterday';
    if (n === 1) return 'the day before';
    return `the ${n} days before`;
  }

  // "+3 on the 7 days before" with the number coloured; nothing when both are 0.
  function delta(s, n) {
    if (!s.total && !s.prev) return null;
    const d = s.total - s.prev;
    const span = el('span');
    if (d === 0) { span.textContent = `Same as ${prevWords(n)}`; return span; }
    span.append(el('span', { class: d > 0 ? 'up' : 'down', text: `${d > 0 ? '+' : '−'}${Math.abs(d)}` }), ` vs ${prevWords(n)}`);
    return span;
  }

  const splitText = (s) => KIND_ORDER.filter((k) => kinds.has(k) && s[k])
    .map((k) => plural(s[k], ...KIND_SHORT[k])).join(' · ') || 'Nothing shipped';
  const nameOf = (id) => SHORT[id] || (SOLUTIONS[id] || { name: id }).name;

  function legend() {
    const box = el('div', { class: 'bp-legend' });
    KIND_ORDER.filter((k) => kinds.has(k)).forEach((k) => box.append(el('span', {}, el('i', { class: `sw ${k}` }), KIND_LABEL[k])));
    return box;
  }

  function drawBars({ list, n }) {
    const max = Math.max(1, ...list.map((s) => s.total));
    const box = el('div', { class: 'bars' });
    list.forEach((s) => {
      const track = el('div', { class: 'track', role: 'img', 'aria-label': `${nameOf(s.id)}: ${splitText(s)}` });
      KIND_ORDER.filter((k) => kinds.has(k) && s[k]).forEach((k) => {
        const seg = el('span', { class: `seg-${k}` });
        seg.style.width = `${(s[k] / max) * 100}%`;
        track.append(seg);
      });
      const sub = el('div', { class: 'bp-sub', text: splitText(s) });
      const d = delta(s, n);
      if (d) sub.append(' · ', d);
      box.append(el('div', { class: s.total ? '' : 'bp-quiet' },
        el('div', { class: 'bar-top' }, el('span', { class: 'bar-name', text: nameOf(s.id) }), el('span', { class: 'bar-n', text: String(s.total) })),
        track, sub));
    });
    return [legend(), box];
  }

  function drawTiles({ list, n }) {
    const box = el('div', { class: 'tiles' });
    list.forEach((s) => {
      const peak = Math.max(1, ...s.cols);
      const spark = el('div', { class: 'spark', 'aria-hidden': 'true' });
      if (s.cols.length > 1) {
        s.cols.forEach((c) => {
          const b = el('span', { class: c ? '' : 'zero' });
          b.style.height = c ? `${Math.max(12, (c / peak) * 100)}%` : '2px';
          spark.append(b);
        });
      }
      const d = delta(s, n);
      box.append(el('div', { class: `tile${s.total ? '' : ' bp-quiet'}` },
        el('span', { class: 'bar-name', text: nameOf(s.id) }),
        el('span', { class: 'bar-n', text: String(s.total) }),
        kindCounts(s),
        d ? el('span', { class: 'bp-sub' }, d) : null,
        s.cols.length > 1 ? spark : null,
        s.last ? el('span', { class: 'bp-sub', text: `Last ${lastShipped(s.last)}` }) : null));
    });
    return [legend(), box];
  }

  // "● 23  ● 2  ● 6" — the tile's split, coloured to match the legend.
  function kindCounts(s) {
    const shownKinds = KIND_ORDER.filter((k) => kinds.has(k) && s[k]);
    if (!shownKinds.length) return el('span', { class: 'bp-sub', text: 'Nothing shipped' });
    const box = el('span', { class: 'kinds', 'aria-label': splitText(s) });
    shownKinds.forEach((k) => box.append(el('span', {}, el('i', { class: `sw ${k}` }), String(s[k]))));
    return box;
  }

  function drawDays({ list, cols }) {
    const peak = Math.max(1, ...list.flatMap((s) => s.cols));
    const { unit } = cols;
    const label = (c) => (unit === 'month' ? fmtMonth.format(new Date(`${c.from}T12:00:00`)) : fmtKey(c.from));
    const readout = el('p', { class: 'bp-readout', 'aria-live': 'polite' });
    const grid = el('div', { class: 'heat' });
    // A title shows on hover; a phone has no hover, so a tap writes the same line under the chart.
    const say = (cell, text) => {
      grid.querySelectorAll('.cell.on').forEach((c) => c.classList.remove('on'));
      cell.classList.add('on');
      readout.textContent = text;
    };
    list.forEach((s) => {
      const cells = el('div', { class: 'cells' });
      cells.style.gridTemplateColumns = `repeat(${cols.length}, minmax(0, 1fr))`;
      s.cols.forEach((c, i) => {
        const when = unit === 'day' ? fmtKey(cols[i].from) : unit === 'week' ? `Week of ${fmtKey(cols[i].from)}` : label(cols[i]);
        const text = `${nameOf(s.id)} · ${when} · ${plural(c, 'change', 'changes')}`;
        const cell = el('span', { class: 'cell', title: text });
        if (c) { cell.style.background = 'var(--violet-500)'; cell.style.opacity = String(0.3 + 0.7 * (c / peak)); }
        cell.addEventListener('click', () => say(cell, text));
        cells.append(cell);
      });
      grid.append(el('div', { class: s.total ? '' : 'bp-quiet' },
        el('div', { class: 'bar-top' }, el('span', { class: 'bar-name', text: nameOf(s.id) }), el('span', { class: 'bar-n small', text: String(s.total) })),
        cells));
    });
    grid.append(el('div', { class: 'axis' }, el('span', { text: label(cols[0]) }), el('span', { text: cols.length > 1 ? label(cols[cols.length - 1]) : '' })));
    const note = el('div', { class: 'bp-legend', text: `One square per ${unit}, darker means more shipped. Tap one for its count.` });
    return [note, grid, readout];
  }

  function renderByProject() {
    const card = $('byproj');
    const w = pickedDays();
    if (!w || range === 'all') { card.hidden = true; return; }
    card.hidden = false;
    document.querySelectorAll('.seg [data-viz]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viz === viz)));
    const data = projectStats(w);
    $('bp-title').textContent = 'By project';
    const draw = viz === 'tiles' ? drawTiles : viz === 'days' ? drawDays : drawBars;
    $('bp-body').replaceChildren(...draw(data));
  }

  // One chip per project in the log, in the SOLUTIONS order, after All projects.
  function renderProjectChips() {
    const ids = [...new Set([...Object.keys(SOLUTIONS), ...rows.map((r) => r.solution)])]
      .filter((id) => rows.some((r) => r.solution === id));
    if (project !== 'all' && !ids.includes(project) && rows.length) project = 'all';
    const box = $('projects');
    box.querySelectorAll('.chip[data-project]:not([data-project="all"])').forEach((c) => c.remove());
    ids.forEach((id) => {
      const n = rows.filter((r) => r.solution === id).length;
      const chip = el('button', { class: 'chip', type: 'button', 'data-project': id }, nameOf(id), ' ', el('span', { class: 'n', text: String(n) }));
      chip.addEventListener('click', () => pickProject(id));
      box.append(chip);
    });
    box.querySelectorAll('.chip[data-project]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.project === project)));
  }

  // Picking a project opens its group, since it's then the only one listed.
  function pickProject(id) {
    project = id;
    if (id !== 'all') open.add(id);
    rememberView(); render();
  }

  function render() {
    renderProjectChips();
    document.querySelectorAll('.chip[data-range]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.range === range)));
    const byDate = range !== 'all' && rows.length > 0;
    $('dates').hidden = range !== 'day' && range !== 'between';
    $('to-wrap').hidden = range !== 'between';
    $('from-label').textContent = range === 'day' ? 'Date' : 'From';
    $('results').hidden = !byDate;
    $('groups').hidden = byDate;
    if (byDate) renderResults();
    $('byproj').hidden = !byDate;
    if (byDate) renderByProject();

    document.querySelectorAll('.chip[data-kind]').forEach((c) => {
      const k = c.dataset.kind;
      c.setAttribute('aria-pressed', String(kinds.has(k)));
      c.querySelector('.n').textContent = inProject().filter((r) => r.kind === k).length || '';
    });

    const groupsEl = $('groups');
    groupsEl.replaceChildren();
    $('summary').hidden = !rows.length;
    $('lede').hidden = !!rows.length;
    if (!rows.length) {
      groupsEl.append(el('div', { class: 'card empty', text: 'Nothing in the log yet. Entries appear here as pull requests are merged.' }));
      return;
    }

    const shownRows = inProject();
    const bySol = new Map();
    shownRows.forEach((r) => { if (!bySol.has(r.solution)) bySol.set(r.solution, []); bySol.get(r.solution).push(r); });
    const groups = [...bySol.entries()].map(([id, list]) => {
      list.sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
      return { id, list, latest: list[0].mergedAt };
    }).sort((a, b) => String(b.latest).localeCompare(String(a.latest)));

    groups.forEach((g) => {
      const info = SOLUTIONS[g.id] || { name: g.id, blurb: '' };
      const shown = g.list.filter((r) => kinds.has(r.kind));
      const isOpen = open.has(g.id);
      const bodyId = `body-${g.id}`;

      const head = el('button', { class: 'head', type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': bodyId },
        el('span', { class: 'name', text: info.name }),
        info.blurb ? el('span', { class: 'meta', text: info.blurb }) : '',
        el('span', { class: 'last', text: `Last shipped ${lastShipped(g.latest)}` }),
        el('span', { class: 'count' },
          el('b', { text: String(shown.length) }),
          el('span', { class: 'caret', 'aria-hidden': 'true' })));
      head.addEventListener('click', () => {
        if (open.has(g.id)) open.delete(g.id); else open.add(g.id);
        rememberView(); render();
      });

      const section = el('section', { class: `card group${isOpen ? ' open' : ''}` }, head);
      if (isOpen) {
        const body = el('div', { class: 'body', id: bodyId });
        if (info.site) body.append(el('a', { class: 'site', href: info.site, target: '_blank', rel: 'noopener', text: `Open ${info.name} ↗` }));
        if (!shown.length) body.append(el('p', { class: 'note', text: 'Nothing of the selected types. Turn on another filter above.' }));
        let month = '', ul = null;
        shown.forEach((r) => {
          const d = new Date(r.mergedAt);
          const m = fmtMonth.format(d);
          if (m !== month) { month = m; body.append(el('div', { class: 'month', text: m })); ul = el('ul'); body.append(ul); }
          const title = el('span', { class: 'title', text: r.title });
          if (g.id === 'famous-people' && r.part) title.append(el('span', { class: 'part', text: r.part }));
          const right = el('span', { class: 'right' }, el('span', { class: `pill ${r.kind}`, text: KIND_LABEL[r.kind] || r.kind }));
          if (r.url) right.append(el('a', { class: 'pr', href: r.url, target: '_blank', rel: 'noopener', text: r.number ? `#${r.number}` : 'commit' }));
          ul.append(el('li', {}, el('span', { class: 'date', text: fmtDay.format(d) }), title, right));
        });
        section.append(body);
      }
      groupsEl.append(section);
    });

    // The page reads the log fresh every time it's opened or returned to, so
    // "checked" is that read — the artifact this replaced said the same of its refresh.
    $('sum-changes').textContent = String(shownRows.length);
    $('sum-solutions').textContent = String(groups.length);
    $('sum-sol-word').textContent = groups.length === 1 ? 'solution' : 'solutions';
    $('sum-checked').textContent = `Checked for new releases ${checkedAt ? fmtChecked.format(checkedAt) : 'just now'}. Tap a solution to see its list.`;
  }

  /* ------------------------------------------------------------ wiring */

  // Start the date boxes somewhere sensible rather than empty.
  function fillDates() {
    if (range === 'day' && !$('from').value) $('from').value = daysAgo(0);
    if (range === 'between') {
      if (!$('from').value) $('from').value = daysAgo(6);
      if (!$('to').value) $('to').value = daysAgo(0);
    }
  }
  fillDates();
  document.querySelectorAll('.chip[data-range]').forEach((c) => c.addEventListener('click', () => {
    range = c.dataset.range;
    fillDates();
    rememberView(); render();
  }));
  ['from', 'to'].forEach((id) => $(id).addEventListener('change', render));

  document.querySelector('.chip[data-project="all"]').addEventListener('click', () => pickProject('all'));

  document.querySelectorAll('.seg [data-viz]').forEach((b) => b.addEventListener('click', () => {
    viz = b.dataset.viz;
    rememberView(); render();
  }));

  document.querySelectorAll('.chip[data-kind]').forEach((c) => c.addEventListener('click', () => {
    const k = c.dataset.kind;
    if (kinds.has(k)) kinds.delete(k); else kinds.add(k);
    rememberView(); render();
  }));

  $('signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email) { signinMsg('Enter your email.', true); return; }
    $('signin-btn').disabled = true;
    signinMsg('Signing in…');
    try {
      session = await signIn(email, password);
      saveSession();
      $('password').value = '';
      signinMsg('');
      await openLog();
    } catch (err) {
      signinMsg(friendly(err.code || err.message), true);
    } finally {
      $('signin-btn').disabled = false;
    }
  });

  $('forgot').addEventListener('click', async () => {
    const email = $('email').value.trim();
    if (!email) { signinMsg('Enter your email above first, then press this again.', true); return; }
    try {
      await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${config.apiKey}`, { requestType: 'PASSWORD_RESET', email });
      signinMsg(`If ${email} has an account, a reset link is on its way. Check your inbox.`);
    } catch (err) {
      signinMsg(`The reset email couldn't be sent (${err.code || err.message}).`, true);
    }
  });

  $('signout').addEventListener('click', () => {
    forgetSession();
    rows = [];
    $('groups').replaceChildren();
    $('summary').hidden = true;
    $('lede').hidden = false;
    show('signin');
    signinMsg('Signed out.');
  });

  // Coming back to the tab reloads the list, so a merge made while it sat open shows up.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session && !$('log').hidden) openLog();
  });

  (async () => {
    try {
      config = await loadConfig();
    } catch (err) {
      status(err.message);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (saved && saved.refreshToken) session = { email: saved.email, refreshToken: saved.refreshToken, idToken: null, expires: 0 };
    } catch (e) { /* storage blocked: sign in each visit */ }
    if (session) {
      await openLog();
    } else {
      status('');
      show('signin');
      $('email').focus();
    }
  })();
})();
