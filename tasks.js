/* ==========================================================================
   MARS JARVIS - Task system: add / complete / delete / priority
   Spoken numbers ("task 2") refer to the position in sorted():
   open tasks by priority (high first), then completed tasks.
   ========================================================================== */
'use strict';

Mars.Tasks = (() => {
  const M = Mars.Memory, U = Mars.util;
  const RANK = { high: 0, medium: 1, low: 2 };
  const SYNONYM = {
    high: 'high', urgent: 'high', important: 'high', critical: 'high',
    medium: 'medium', normal: 'medium', low: 'low', minor: 'low'
  };

  const normPriority = (p) => SYNONYM[String(p || '').toLowerCase()] || 'medium';

  function sorted() {
    const all = M.all('tasks');
    const open = all.filter((t) => !t.done).sort((a, b) =>
      (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const done = all.filter((t) => t.done).sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
    return open.concat(done);
  }

  function add(title, priority) {
    return M.add('tasks', { title: U.capitalize(title), priority: normPriority(priority), done: false });
  }

  function setDone(id, done) {
    return M.edit('tasks', id, { done: !!done, completedAt: done ? U.now() : null });
  }
  const complete = (id) => setDone(id, true);
  const toggle = (id) => { const t = M.get('tasks', id); return t ? setDone(id, !t.done) : null; };

  const setPriority = (id, p) => M.edit('tasks', id, { priority: normPriority(p) });
  function cyclePriority(id) {
    const t = M.get('tasks', id);
    if (!t) return null;
    const next = { high: 'medium', medium: 'low', low: 'high' }[t.priority] || 'high';
    return setPriority(id, next);
  }

  const remove = (id) => M.remove('tasks', id);

  /** "2" | "two" | "last" | "pay rent" -> task or null */
  function resolve(ref) {
    const l = sorted();
    const r = String(ref || '').trim().toLowerCase();
    if (!l.length || !r) return null;
    if (/^(?:the\s+)?(?:last|latest|newest|recent)(?:\s+task)?$/.test(r)) {
      return M.all('tasks').slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    }
    const n = U.parseNumber(r);
    if (n != null) return l[n - 1] || null;
    return U.fuzzyFind(l, r, (t) => t.title);
  }

  function counts() {
    const all = M.all('tasks');
    const open = all.filter((t) => !t.done);
    return { total: all.length, open: open.length, done: all.length - open.length, high: open.filter((t) => t.priority === 'high').length };
  }

  return { sorted, add, complete, toggle, setPriority, cyclePriority, remove, resolve, counts, normPriority };
})();
