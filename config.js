/* ==========================================================================
   MARS JARVIS - config, event bus and shared helpers
   Everything hangs off one global namespace: window.Mars
   ========================================================================== */
'use strict';

const Mars = (window.Mars = {});

Mars.CONST = {
  DATA_FILE: 'jarvis-data.json',
  // drive.file = the app can only see/modify files it created itself.
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
  // Only tiny, non-personal UI hints live in localStorage. All user DATA lives in Google Drive.
  LS: {
    clientId: 'mars.clientId',
    fileId: 'mars.fileId',
    hint: 'mars.hint',
    signedIn: 'mars.signedIn',
    theme: 'mars.theme',
    autoStart: 'mars.autoStart'
  },
  MAX_CONVERSATIONS: 300,
  SAVE_DEBOUNCE_MS: 1500
};

/* ---------- tiny pub/sub ---------- */
Mars.bus = (() => {
  const handlers = {};
  return {
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit(evt, data) {
      (handlers[evt] || []).slice().forEach((fn) => {
        try { fn(data); } catch (err) { console.error('[bus]', evt, err); }
      });
    }
  };
})();

/* ---------- helpers ---------- */
Mars.util = (() => {
  const NUMBER_WORDS = {
    zero: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3
  };
  const STOP = new Set(['the', 'a', 'an', 'my', 'to', 'of', 'for', 'and', 'on', 'in', 'is', 'that', 'this', 'note', 'task']);

  const U = {
    uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    now() { return new Date().toISOString(); },

    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    lsSet(key, val) {
      try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) { /* ignore */ }
    },

    debounce(fn, ms) {
      let t;
      const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
      d.cancel = () => clearTimeout(t);
      return d;
    },

    capitalize(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; },

    /** "3", "three", "number 3", "#3" -> 3 ; anything else -> null */
    parseNumber(s) {
      const t = String(s || '').toLowerCase().trim().replace(/^(?:number|no\.?|#)\s*/, '');
      if (/^\d{1,4}$/.test(t)) return parseInt(t, 10);
      return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, t) ? NUMBER_WORDS[t] : null;
    },

    tokens(s) {
      return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
    },

    /** Best fuzzy match of `ref` against items. Returns an item or null. */
    fuzzyFind(items, ref, textOf) {
      const want = U.tokens(ref);
      if (!want.length) return null;
      let best = null, bestScore = 0;
      items.forEach((item) => {
        const hay = String(textOf(item) || '').toLowerCase();
        const words = new Set(U.tokens(hay));
        let hit = 0;
        want.forEach((w) => { if (words.has(w) || (w.length >= 3 && hay.includes(w))) hit++; });
        const score = hit / want.length;
        if (score > bestScore) { best = item; bestScore = score; }
      });
      return bestScore >= 0.5 ? best : null;
    },

    timeAgo(iso) {
      if (!iso) return '';
      const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 45) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      if (s < 604800) return Math.round(s / 86400) + ' d ago';
      return new Date(iso).toLocaleDateString();
    },

    fmtDateTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    },

    withTimeout(promise, ms, msg) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(msg || 'Timed out')), ms);
        promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
      });
    }
  };
  return U;
})();
