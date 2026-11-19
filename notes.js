/* ==========================================================================
   MARS JARVIS - Notes system: create / edit / delete / search
   Spoken numbers ("note 2") refer to the position in list() (newest first).
   ========================================================================== */
'use strict';

Mars.Notes = (() => {
  const M = Mars.Memory, U = Mars.util;

  const stamp = (n) => n.updatedAt || n.createdAt || '';
  const list = () => M.all('notes').slice().sort((a, b) => stamp(b).localeCompare(stamp(a)));

  function titleFrom(text) {
    const words = String(text).trim().replace(/\s+/g, ' ').split(' ');
    let t = words.slice(0, 6).join(' ');
    if (t.length > 48) t = t.slice(0, 47) + '…';
    else if (words.length > 6) t += '…';
    return U.capitalize(t);
  }

  function create(content, title) {
    const body = U.capitalize(content);
    return M.add('notes', { title: (title && title.trim()) || titleFrom(body), content: body, updatedAt: U.now() });
  }

  function update(id, { title, content }) {
    const patch = {};
    if (content != null) patch.content = content.trim();
    if (title != null) patch.title = title.trim();
    if (!patch.title && patch.content) patch.title = titleFrom(patch.content);
    return M.edit('notes', id, patch);
  }

  const remove = (id) => M.remove('notes', id);

  function search(query) {
    const q = U.tokens(query);
    if (!q.length) return list();
    const hay = (n) => (n.title + ' ' + n.content).toLowerCase();
    const all = list().filter((n) => q.every((w) => hay(n).includes(w)));
    if (all.length) return all;
    return list().filter((n) => q.some((w) => hay(n).includes(w)));
  }

  /** "2" | "two" | "last" | "buy milk" -> note or null */
  function resolve(ref) {
    const l = list();
    const r = String(ref || '').trim().toLowerCase();
    if (!l.length || !r) return null;
    if (/^(?:the\s+)?(?:last|latest|newest|recent)(?:\s+note)?$/.test(r)) return l[0];
    const n = U.parseNumber(r);
    if (n != null) return l[n - 1] || null;
    return U.fuzzyFind(l, r, (x) => x.title + ' ' + x.content);
  }

  return { list, create, update, remove, search, resolve, titleFrom };
})();
