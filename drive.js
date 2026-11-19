/* ==========================================================================
   MARS JARVIS - Google sign-in (Google Identity Services) + Drive REST API
   No backend: the browser talks to Google directly with an OAuth access token.
   ========================================================================== */
'use strict';

Mars.Drive = (() => {
  const C = Mars.CONST, U = Mars.util, bus = Mars.bus;
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  let tokenClient = null;
  let token = null;
  let expiresAt = 0;
  let user = null;
  let inflight = null;      // one token request at a time
  let silent = false;       // true while trying to restore a previous session

  /* ---------------- configuration ---------------- */
  const getClientId = () => (U.lsGet(C.LS.clientId) || '').trim();

  function setClientId(id) {
    U.lsSet(C.LS.clientId, (id || '').trim() || null);
    tokenClient = null; // rebuild with the new id
  }

  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);

  function whenGis(maxMs = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        if (gisReady()) return resolve(true);
        if (Date.now() - start > maxMs) return resolve(false);
        setTimeout(poll, 150);
      })();
    });
  }

  function build() {
    const id = getClientId();
    if (!id || !gisReady()) return false;
    if (tokenClient) return true;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: C.SCOPE,
      callback: onTokenResponse,
      error_callback: (err) => {
        const e = new Error((err && (err.message || err.type)) || 'Sign-in failed');
        e.type = err && err.type;
        if (inflight) { inflight.reject(e); inflight = null; }
        if (!silent) bus.emit('auth:error', e);
      }
    });
    return true;
  }

  /* ---------------- tokens ---------------- */
  function onTokenResponse(resp) {
    if (!resp || resp.error) {
      const e = new Error((resp && (resp.error_description || resp.error)) || 'Sign-in failed');
      if (inflight) { inflight.reject(e); inflight = null; }
      if (!silent) bus.emit('auth:error', e);
      return;
    }
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, C.SCOPE)) {
      const e = new Error('Google Drive permission was not granted. Please tick the Drive checkbox when signing in.');
      if (inflight) { inflight.reject(e); inflight = null; }
      bus.emit('auth:error', e);
      return;
    }
    token = resp.access_token;
    expiresAt = Date.now() + Math.max(60, (Number(resp.expires_in) || 3600) - 90) * 1000;
    U.lsSet(C.LS.signedIn, '1');
    if (inflight) { inflight.resolve(token); inflight = null; }
    bus.emit('auth:token');
  }

  function requestToken(prompt) {
    if (inflight) return inflight.promise;
    if (!build()) return Promise.reject(new Error('Add your Google OAuth Client ID in Settings first.'));
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    inflight = { promise, resolve, reject };
    const opts = { prompt };
    const hint = U.lsGet(C.LS.hint);
    if (hint) opts.hint = hint;
    try { tokenClient.requestAccessToken(opts); } catch (e) { inflight = null; return Promise.reject(e); }
    return U.withTimeout(promise, 120000, 'Sign-in timed out').catch((e) => { inflight = null; throw e; });
  }

  function ensureToken() {
    if (token && Date.now() < expiresAt) return Promise.resolve(token);
    if (!U.lsGet(C.LS.signedIn)) return Promise.reject(new Error('Not signed in to Google.'));
    return requestToken('');
  }

  /* ---------------- sign in / out ---------------- */
  async function init() {
    const ok = await whenGis();
    if (!ok) { bus.emit('auth:unavailable'); return; }
    if (!getClientId()) { bus.emit('auth:needsconfig'); return; }
    build();
    if (U.lsGet(C.LS.signedIn) === '1') {
      silent = true;
      try {
        await requestToken('');
        await afterToken();
      } catch (e) {
        bus.emit('auth:reconnect');   // popups are usually blocked without a click
      } finally {
        silent = false;
      }
    }
  }

  async function signIn() {
    if (!getClientId()) throw new Error('Add your Google OAuth Client ID in Settings first.');
    if (!gisReady()) {
      if (!(await whenGis(5000))) throw new Error('Google sign-in script could not load. Check your connection or ad blocker.');
    }
    await requestToken('');
    await afterToken();
  }

  async function afterToken() {
    try {
      const res = await api(`${API}/about?fields=user(displayName,emailAddress,photoLink)`);
      const data = await res.json();
      user = data.user || null;
    } catch (e) {
      user = user || { displayName: 'Google user' };
    }
    if (user && user.emailAddress) U.lsSet(C.LS.hint, user.emailAddress);
    bus.emit('auth:signedin', user);
  }

  function signOut() {
    const t = token;
    token = null; expiresAt = 0; user = null; inflight = null;
    U.lsSet(C.LS.signedIn, null);
    U.lsSet(C.LS.fileId, null);
    U.lsSet(C.LS.hint, null);
    if (t && gisReady()) { try { google.accounts.oauth2.revoke(t, () => {}); } catch (e) { /* ignore */ } }
    bus.emit('auth:signedout');
  }

  /* ---------------- Drive REST ---------------- */
  async function api(url, opts = {}, retry = true) {
    const t = await ensureToken();
    const res = await fetch(url, Object.assign({}, opts, {
      headers: Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + t })
    }));
    if (res.status === 401 && retry) { token = null; expiresAt = 0; return api(url, opts, false); }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Drive error ${res.status}${body ? ': ' + body.slice(0, 180) : ''}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /** Find jarvis-data.json (remembered id first, then search by name). */
  async function findFile() {
    const remembered = U.lsGet(C.LS.fileId);
    if (remembered) {
      try {
        const res = await api(`${API}/files/${encodeURIComponent(remembered)}?fields=id,trashed`);
        const f = await res.json();
        if (f && !f.trashed) return f.id;
      } catch (e) {
        if (e.status !== 404 && e.status !== 403) throw e;
      }
      U.lsSet(C.LS.fileId, null);
    }
    const q = `name='${C.DATA_FILE}' and trashed=false`;
    const res = await api(`${API}/files?q=${encodeURIComponent(q)}&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)`);
    const data = await res.json();
    const id = data.files && data.files[0] ? data.files[0].id : null;
    if (id) U.lsSet(C.LS.fileId, id);
    return id;
  }

  async function readFile(id) {
    const res = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    const text = await res.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
  }

  async function createFile(obj) {
    const boundary = 'mars' + U.uid();
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: C.DATA_FILE, mimeType: 'application/json' }) +
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(obj, null, 2) +
      `\r\n--${boundary}--`;
    const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const data = await res.json();
    U.lsSet(C.LS.fileId, data.id);
    return data.id;
  }

  async function updateFile(id, obj) {
    await api(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(obj, null, 2)
    });
  }

  return {
    init, signIn, signOut, setClientId, getClientId,
    findFile, readFile, createFile, updateFile,
    isSignedIn: () => !!(token && Date.now() < expiresAt) || U.lsGet(C.LS.signedIn) === '1',
    hasToken: () => !!(token && Date.now() < expiresAt),
    getUser: () => user
  };
})();
