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
    'menu-board':     { name: 'Menu Board', site: 'https://menu.pivotdevshop.com', blurb: 'Cafe menu screen and price editor' },
    'pivot-dev-shop': { name: 'Pivot Dev Shop website', site: 'https://pivotdevshop.com', blurb: 'The company site' },
  };
  const KIND_LABEL = { feature: 'Feature', fix: 'Fix', behind: 'Behind the scenes' };

  let config = null;   // { apiKey, projectId }
  let session = null;  // { email, refreshToken, idToken, expires }
  let rows = [];

  const kinds = new Set(['feature', 'fix']);
  const open = new Set();
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (v) { kinds.clear(); v.kinds.forEach((k) => kinds.add(k)); v.open.forEach((g) => open.add(g)); }
  } catch (e) { /* storage blocked: defaults are fine */ }
  const rememberView = () => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ kinds: [...kinds], open: [...open] })); } catch (e) { /* ignore */ }
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
  const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    });
    kids.forEach((c) => c && n.append(c));
    return n;
  }

  function render() {
    document.querySelectorAll('.chip').forEach((c) => {
      const k = c.dataset.kind;
      c.setAttribute('aria-pressed', String(kinds.has(k)));
      c.querySelector('.n').textContent = rows.filter((r) => r.kind === k).length || '';
    });

    const groupsEl = $('groups');
    groupsEl.replaceChildren();
    $('summary').hidden = !rows.length;
    $('lede').hidden = !!rows.length;
    if (!rows.length) {
      groupsEl.append(el('div', { class: 'card empty', text: 'Nothing in the log yet. Entries appear here as pull requests are merged.' }));
      return;
    }

    const bySol = new Map();
    rows.forEach((r) => { if (!bySol.has(r.solution)) bySol.set(r.solution, []); bySol.get(r.solution).push(r); });
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
        el('span', { class: 'meta', text: `${info.blurb ? info.blurb + ' · ' : ''}last shipped ${fmtDay.format(new Date(g.latest))}` }),
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
    $('sum-changes').textContent = String(rows.length);
    $('sum-solutions').textContent = String(groups.length);
    $('sum-checked').textContent = `Checked for new releases ${checkedAt ? fmtChecked.format(checkedAt) : 'just now'}. Tap a solution to see its list.`;
  }

  /* ------------------------------------------------------------ wiring */

  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
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
