/* ==========================================================================
   MARS JARVIS - Memory core
   One JSON document in Google Drive (jarvis-data.json):
   { notes: [], tasks: [], research: [], settings: {}, conversations: [] }
   Provides: loadMemory, saveMemory, editMemory, deleteMemory (+ add / restore).
   ========================================================================== */
'use strict';

Mars.Memory = (() => {
  const U = Mars.util, C = Mars.CONST, D = Mars.Drive, bus = Mars.bus;
  const COLLECTIONS = ['notes', 'tasks', 'research', 'conversations'];

  const DEFAULT_SETTINGS = {
    wakeWord: 'jarvis',
    lang: 'en-US',
    speak: true,
    autoStart: true,
    voiceURI: '',
    rate: 1,
    pitch: 0.9,
    volume: 1,
    awakeSeconds: 8,
    theme: 'mars'
  };

  let data = null;
  let fileId = null;
  let dirty = false;
  let saving = false;
  let status = 'offline';        // offline | loading | synced | saving | error
  let lastSync = null;
  let lastError = null;
  let retryTimer = null;
  let pendingSettings = {};      // settings changed before Drive was connected

  const blank = () => ({
    version: 1,
    createdAt: U.now(),
    updatedAt: U.now(),
    notes: [],
    tasks: [],
    research: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    conversations: []
  });

  function normalize(raw) {
    const out = blank();
    const src = raw && typeof raw === 'object' ? raw : {};
    COLLECTIONS.forEach((c) => { out[c] = Array.isArray(src[c]) ? src[c] : []; });
    out.settings = Object.assign({}, DEFAULT_SETTINGS, src.settings || {});
    out.createdAt = src.createdAt || out.createdAt;
    out.updatedAt = src.updatedAt || out.updatedAt;
    return out;
  }

  function setStatus(s) { status = s; bus.emit('memory:status', s); }
  const need = () => { if (!data) throw new Error('Memory is offline. Connect Google Drive first.'); };

  /* ---------------- load ---------------- */
  async function load() {
    setStatus('loading');
    try {
      fileId = await D.findFile();
      if (fileId) {
        data = normalize(await D.readFile(fileId));
      } else {
        data = blank();
        fileId = await D.createFile(data);
      }
      if (Object.keys(pendingSettings).length) {
        Object.assign(data.settings, pendingSettings);
        pendingSettings = {};
        dirty = true;
      }
      lastSync = U.now();
      lastError = null;
      setStatus('synced');
      bus.emit('memory:loaded', data);
      if (dirty) schedule();
      return data;
    } catch (err) {
      console.error('[memory] load failed', err);
      lastError = err;
      setStatus('error');
      bus.emit('memory:error', err);
      throw err;
    }
  }

  function unload() {
    data = null; fileId = null; dirty = false; lastSync = null; lastError = null;
    clearTimeout(retryTimer);
    setStatus('offline');
    bus.emit('memory:unloaded');
  }

  /* ---------------- save ---------------- */
  const schedule = U.debounce(() => flush(), C.SAVE_DEBOUNCE_MS);

  async function flush() {
    if (!data || !dirty || saving || !D.isSignedIn()) return;
    saving = true;
    dirty = false;
    setStatus('saving');
    try {
      data.updatedAt = U.now();
      await D.updateFile(fileId, data);
      lastSync = U.now();
      lastError = null;
      setStatus('synced');
    } catch (err) {
      console.error('[memory] save failed', err);
      dirty = true;
      lastError = err;
      setStatus('error');
      bus.emit('memory:error', err);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, 20000);
    } finally {
      saving = false;
      if (dirty && status !== 'error') schedule();
    }
  }

  /** saveMemory: persist right now (used by the Save button and "save memory"). */
  async function save() {
    need();
    dirty = true;
    schedule.cancel();
    clearTimeout(retryTimer);
    await flush();
    if (status === 'error') throw lastError || new Error('Save failed');
  }

  function changed() {
    if (data.conversations.length > C.MAX_CONVERSATIONS) {
      data.conversations.splice(0, data.conversations.length - C.MAX_CONVERSATIONS);
    }
    dirty = true;
    bus.emit('memory:changed');
    schedule();
  }

  /* ---------------- CRUD ---------------- */
  const all = (col) => (data && data[col]) || [];
  const get = (col, id) => all(col).find((x) => x.id === id) || null;

  function add(col, item) {
    need();
    const rec = Object.assign({ id: U.uid(), createdAt: U.now() }, item);
    data[col].push(rec);
    changed();
    return rec;
  }

  /** editMemory */
  function edit(col, id, patch) {
    need();
    const rec = get(col, id);
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: U.now() });
    changed();
    return rec;
  }

  /** Replace a whole record (raw JSON editor). */
  function replace(col, id, obj) {
    need();
    const i = data[col].findIndex((x) => x.id === id);
    if (i < 0) return null;
    data[col][i] = Object.assign({}, obj, { id, updatedAt: U.now() });
    changed();
    return data[col][i];
  }

  /** deleteMemory - returns { item, index } so callers can offer Undo. */
  function remove(col, id) {
    need();
    const i = data[col].findIndex((x) => x.id === id);
    if (i < 0) return null;
    const item = data[col].splice(i, 1)[0];
    changed();
    return { item, index: i };
  }

  function restore(col, item, index) {
    need();
    data[col].splice(Math.min(index, data[col].length), 0, item);
    changed();
  }

  function clear(col) {
    need();
    data[col] = [];
    changed();
  }

  /* ---------------- settings ---------------- */
  function getSettings() {
    return data ? data.settings : Object.assign({}, DEFAULT_SETTINGS, pendingSettings);
  }

  function setSettings(patch) {
    if (data) { Object.assign(data.settings, patch); changed(); }
    else Object.assign(pendingSettings, patch);
    bus.emit('settings:changed', patch);
  }

  /* ---------------- misc ---------------- */
  function exportJSON() { need(); return JSON.stringify(data, null, 2); }

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  bus.on('auth:token', () => { if (dirty) schedule(); });

  return {
    COLLECTIONS, DEFAULT_SETTINGS,
    load, unload, save, flush,
    all, get, add, edit, replace, remove, restore, clear,
    getSettings, setSettings, exportJSON,
    isReady: () => !!data,
    isDirty: () => dirty,
    getStatus: () => status,
    getLastSync: () => lastSync,
    getLastError: () => lastError,
    getFileId: () => fileId,
    size: () => (data ? JSON.stringify(data).length : 0)
  };
})();
