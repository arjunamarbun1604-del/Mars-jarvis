/* ==========================================================================
   MARS JARVIS - Command interpreter
   run(text) -> { reply, ok, listen? }
   Rules are tried in order; the first match wins.
   ========================================================================== */
'use strict';

Mars.Commands = (() => {
  const U = Mars.util, M = Mars.Memory, N = Mars.Notes, T = Mars.Tasks;
  const OFFLINE = 'Memory is offline. Please connect your Google Drive in Settings first.';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  let awaiting = null;     // e.g. { kind: 'note', until: <ms> } after "add note" with no text
  let lastDeleted = null;  // for "undo"

  const ui = () => Mars.UI;

  /** Strip wake word, politeness and trailing punctuation. */
  function cleanInput(s) {
    return String(s || '')
      .replace(/\s+/g, ' ').trim()
      .replace(/^(?:(?:hey|ok|okay)\s+)?(?:jarvis\b[\s,.:;!?-]*)?/i, '')
      .replace(/^(?:please|can you|could you|would you)\s+/i, '')
      .replace(/[.!?,\s]+$/, '')
      .trim();
  }

  /* ---------------- actions ---------------- */
  function createNote(text) {
    const n = N.create(text);
    ui().toast('Note saved: ' + n.title);
    return 'I have saved your note.';
  }

  function addTask(rawTitle, priority) {
    let title = rawTitle.trim();
    let pri = priority;
    const tail = /^(.*?)[,\s]+(?:with\s+|as\s+|at\s+)?(high|medium|low|urgent|important|critical|normal|minor)\s+priority$/i.exec(title);
    if (tail && tail[1]) { title = tail[1]; pri = pri || tail[2]; }
    if (!title) return { reply: 'What should the task be?', listen: true };
    const t = T.add(title, pri);
    ui().toast('Task added: ' + t.title);
    return `Task added: ${t.title}${t.priority !== 'medium' ? ', ' + t.priority + ' priority' : ''}.`;
  }

  function noteNotFound(ref) { return `I couldn't find a note matching "${ref}". Try its number from the list.`; }
  function taskNotFound(ref) { return `I couldn't find a task matching "${ref}". Try its number from the list.`; }

  function listNotes() {
    ui().go('notes');
    const l = N.list();
    if (!l.length) return 'You have no notes yet.';
    const top = l.slice(0, 3).map((n, i) => `${i + 1}, ${n.title}`).join('. ');
    return `You have ${plural(l.length, 'note')}. Latest: ${top}.`;
  }

  function listTasks(filter) {
    ui().go('tasks');
    let l = T.sorted();
    if (/done|completed/i.test(filter || '')) l = l.filter((t) => t.done);
    else if (/high/i.test(filter || '')) l = l.filter((t) => !t.done && t.priority === 'high');
    else l = l.filter((t) => !t.done);
    if (!l.length) return 'You have no matching tasks.';
    const top = l.slice(0, 4).map((t, i) => `${i + 1}, ${t.title}${t.priority === 'high' ? ', high priority' : ''}`).join('. ');
    return `You have ${plural(l.length, 'task')}. ${top}.`;
  }

  function rememberDeleted(col, res) { lastDeleted = res ? { col, item: res.item, index: res.index } : null; }

  /* ---------------- rules ---------------- */
  const RULES = [
    // ----- help / small talk / info -----
    { re: /^(?:help|what can you do|what are your commands|commands)$/i, run() {
      ui().go('voice');
      return 'You can say: add note, show notes, search notes, edit note, delete note, add task, complete task, delete task, set priority, or open any section. The full list is in the Voice Console.';
    } },
    { re: /^(?:hello|hi|hey|good (?:morning|afternoon|evening))\b.*$/i, run() {
      const h = new Date().getHours();
      const g = h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good night';
      return `${g}. How can I help?`;
    } },
    { re: /^(?:what(?:'s| is)?(?: the)? time(?: is it)?(?: now)?|what time is it|tell me the time|time)$/i, run() {
      return 'It is ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
    } },
    { re: /^(?:what(?:'s| is)?(?: the)? (?:date|day)(?: today)?|what day is it|today'?s date|date)$/i, run() {
      return 'Today is ' + new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '.';
    } },
    { re: /^(?:who are you|what are you|what is your name|what'?s your name)$/i, run() {
      return 'I am Mars Jarvis, your personal AI operating system. Phase one is online.';
    } },
    { re: /^(?:thanks|thank you|thank you very much|cheers)$/i, run: () => 'You are welcome.' },

    // ----- control -----
    { re: /^(?:stop|be quiet|quiet|silence|shut up|stop talking)$/i, run() { Mars.Voice.cancelSpeech(); return { reply: '', silent: true }; } },
    { re: /^(?:mute|mute (?:the )?(?:mic|microphone))$/i, run() { Mars.Voice.setMuted(true); return { reply: 'Microphone muted. Press the mute button to wake me.', noSpeak: true }; } },
    { re: /^(?:stop listening|go to sleep|sleep)$/i, run() { Mars.Voice.stopListening(); return 'Going to standby. Press Start listening when you need me.'; } },
    { re: /^(?:undo|undo (?:that|delete|last|the last (?:delete|deletion)))$/i, mem: true, run() {
      if (!lastDeleted) return 'There is nothing to undo.';
      const { col, item, index } = lastDeleted;
      M.restore(col, item, index);
      lastDeleted = null;
      return 'Restored.';
    } },
    { re: /^(?:save|sync)(?: my)? (?:memory|data|everything)$/i, mem: true, async run() {
      await M.save();
      return 'Memory saved to Google Drive.';
    } },
    { re: /^(?:clear|erase|delete) (?:the |my )?(?:command )?(?:history|conversations?)$/i, mem: true, run() {
      M.clear('conversations');
      return 'Command history cleared.';
    } },
    { re: /^(?:delete|remove|erase|clear) (?:all|every) (?:of )?(?:my )?(notes?|tasks?)$/i, run: (m) =>
      `For safety I won't delete all ${m[1].replace(/s?$/, 's')} by voice. Remove them one at a time, or say delete ${m[1].replace(/s$/, '')} followed by its number.` },

    // ----- notes: create -----
    { re: /^(?:add|save|create|make|take|write|new)\s+(?:a\s+|an\s+)?(?:new\s+)?note$/i, mem: true,
      run() { awaiting = { kind: 'note', until: Date.now() + 30000 }; return { reply: 'What should the note say?', listen: true }; } },
    { re: /^(?:add|save|create|make|take|write|new)\s+(?:a\s+|an\s+)?(?:new\s+)?note(?:\s+(?:that|saying|to say|about|which says|:))?\s+(.+)$/i, mem: true,
      run: (m) => createNote(m[1]) },
    { re: /^note(?:\s+down)?(?:\s+that)?\s+(?!\d+\b)(.+)$/i, mem: true, run: (m) => createNote(m[1]) },

    // ----- notes: search / read / list -----
    { re: /^(?:search|find|look up|look for)\s+(?:my\s+)?notes?\s+(?:for|about|on|with|containing)?\s*(.+)$/i, mem: true, run(m) {
      const q = m[1].trim();
      ui().go('notes'); ui().setNoteSearch(q);
      const r = N.search(q);
      if (!r.length) return `I found no notes about ${q}.`;
      return `I found ${plural(r.length, 'note')} about ${q}. ` + r.slice(0, 3).map((n) => n.title).join('. ') + '.';
    } },
    { re: /^(?:search|find)\s+(?:for\s+)?(.+?)\s+in\s+(?:my\s+)?notes?$/i, mem: true, run(m) {
      const q = m[1].trim();
      ui().go('notes'); ui().setNoteSearch(q);
      const r = N.search(q);
      if (!r.length) return `I found no notes about ${q}.`;
      return `I found ${plural(r.length, 'note')} about ${q}. ` + r.slice(0, 3).map((n) => n.title).join('. ') + '.';
    } },
    { re: /^(?:show|list|read|open|display|view|what are)\s+(?:me\s+)?(?:my\s+|all\s+|the\s+)*notes?$/i, mem: true, run() { ui().setNoteSearch(''); return listNotes(); } },
    { re: /^(?:show|read|open|display|view)\s+(?:the\s+)?note\s+(.+)$/i, mem: true, run(m) {
      const n = N.resolve(m[1]);
      if (!n) return noteNotFound(m[1]);
      ui().go('notes'); ui().setNoteSearch('');
      return `${n.title}. ${n.content}`;
    } },

    // ----- notes: edit / delete -----
    { re: /^(?:edit|update|change|rewrite)\s+note\s+(.+?)\s+(?:to|with|so it says|saying|:)\s+(.+)$/i, mem: true, run(m) {
      const n = N.resolve(m[1]);
      if (!n) return noteNotFound(m[1]);
      N.update(n.id, { content: U.capitalize(m[2]), title: '' });
      return 'Note updated.';
    } },
    { re: /^(?:delete|remove|erase)\s+(?:the\s+)?note\s+(.+)$/i, mem: true, run(m) {
      const n = N.resolve(m[1]);
      if (!n) return noteNotFound(m[1]);
      rememberDeleted('notes', N.remove(n.id));
      ui().toast('Note deleted');
      return `Deleted note: ${n.title}. Say undo to restore it.`;
    } },

    // ----- tasks: add -----
    { re: /^(?:add|create|make|new)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:(high|medium|low|urgent|important|critical|normal|minor)\s+priority\s+)?task$/i, mem: true,
      run(m) { awaiting = { kind: 'task', priority: m[1], until: Date.now() + 30000 }; return { reply: 'What is the task?', listen: true }; } },
    { re: /^(?:add|create|make|new)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:(high|medium|low|urgent|important|critical|normal|minor)\s+priority\s+)?task(?:\s+(?:to|called|named|that|:))?\s+(.+)$/i, mem: true,
      run: (m) => addTask(m[2], m[1]) },
    { re: /^add\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(?:tasks?|to-?do)(?:\s+list)?$/i, mem: true, run: (m) => addTask(m[1]) },

    // ----- tasks: complete / delete / priority -----
    { re: /^mark\s+(?:task\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i, mem: true, run(m) {
      const t = T.resolve(m[1]);
      if (!t) return taskNotFound(m[1]);
      T.complete(t.id);
      return `Marked as done: ${t.title}.`;
    } },
    { re: /^(?:complete|finish|finished|check off|tick off)\s+(?:the\s+)?(?:task\s+)?(.+)$/i, mem: true, run(m) {
      const t = T.resolve(m[1]);
      if (!t) return taskNotFound(m[1]);
      T.complete(t.id);
      return `Task completed: ${t.title}.`;
    } },
    { re: /^(?:delete|remove|erase)\s+(?:the\s+)?task\s+(.+)$/i, mem: true, run(m) {
      const t = T.resolve(m[1]);
      if (!t) return taskNotFound(m[1]);
      rememberDeleted('tasks', T.remove(t.id));
      ui().toast('Task deleted');
      return `Deleted task: ${t.title}. Say undo to restore it.`;
    } },
    { re: /^(?:set|change|make|mark)\s+(?:the\s+)?(?:priority\s+(?:of\s+)?)?task\s+(.+?)\s+(?:to|as|at)\s+(high|medium|low|urgent|important|critical|normal|minor)(?:\s+priority)?$/i, mem: true, run(m) {
      const t = T.resolve(m[1]);
      if (!t) return taskNotFound(m[1]);
      const u = T.setPriority(t.id, m[2]);
      return `${t.title} is now ${u.priority} priority.`;
    } },
    { re: /^(?:set|change)\s+(?:the\s+)?priority\s+(?:of\s+)?(?:task\s+)?(.+?)\s+(?:to|as)\s+(high|medium|low|urgent|important|critical|normal|minor)$/i, mem: true, run(m) {
      const t = T.resolve(m[1]);
      if (!t) return taskNotFound(m[1]);
      const u = T.setPriority(t.id, m[2]);
      return `${t.title} is now ${u.priority} priority.`;
    } },
    { re: /^priority\s+(high|medium|low|urgent|important|critical|normal|minor)\s+(?:for\s+)?(?:task\s+)?(.+)$/i, mem: true, run(m) {
      const t = T.resolve(m[2]);
      if (!t) return taskNotFound(m[2]);
      const u = T.setPriority(t.id, m[1]);
      return `${t.title} is now ${u.priority} priority.`;
    } },
    { re: /^prioriti[sz]e\s+(?:task\s+)?(.+)$/i, mem: true, run(m) {
      const t = T.resolve(m[1]);
      if (!t) return taskNotFound(m[1]);
      T.setPriority(t.id, 'high');
      return `${t.title} is now high priority.`;
    } },

    // ----- tasks: list -----
    { re: /^(?:show|list|read|open|display|view)\s+(?:me\s+)?(?:my\s+|all\s+|the\s+)*(?:(open|pending|high priority|completed|done)\s+)?(?:tasks?|to-?do(?:\s+list)?)$/i, mem: true, run: (m) => listTasks(m[1]) },
    { re: /^what(?:'s| is| are)?\s+(?:on\s+)?my\s+(?:tasks?|to-?do(?:\s+list)?)$/i, mem: true, run: () => listTasks('') },

    // ----- navigation -----
    { re: /^(?:open|go to|go|show|switch to|take me to)\s+(?:the\s+|my\s+)?(home|dashboard|memory|voice(?: console)?|console|settings)$/i, run(m) {
      const k = m[1].toLowerCase();
      const view = k === 'dashboard' ? 'home' : k.startsWith('voice') || k === 'console' ? 'voice' : k;
      ui().go(view);
      return `Opening ${view === 'voice' ? 'the voice console' : view}.`;
    } }
  ];

  /* ---------------- runner ---------------- */
  async function run(input) {
    const raw = cleanInput(input);
    if (!raw) return { reply: 'I am listening.', ok: true };

    // follow-up for "add note" / "add task" with no text
    if (awaiting && Date.now() < awaiting.until) {
      const a = awaiting; awaiting = null;
      if (/^(?:cancel|never mind|nevermind|forget it)$/i.test(raw)) return { reply: 'Cancelled.', ok: true };
      if (!M.isReady()) return { reply: OFFLINE, ok: false };
      const out = a.kind === 'note' ? createNote(raw) : addTask(raw, a.priority);
      return typeof out === 'string' ? { reply: out, ok: true } : Object.assign({ ok: true }, out);
    }
    awaiting = null;

    for (const rule of RULES) {
      const m = rule.re.exec(raw);
      if (!m) continue;
      if (rule.mem && !M.isReady()) return { reply: OFFLINE, ok: false };
      try {
        const out = await rule.run(m, raw);
        return Object.assign({ ok: true }, typeof out === 'string' ? { reply: out } : out);
      } catch (err) {
        console.error('[commands]', err);
        return { reply: 'Something went wrong: ' + err.message, ok: false };
      }
    }
    return { reply: `Sorry, I didn't understand "${raw}". Say help to see what I can do.`, ok: false, unknown: true };
  }

  return { run, cleanInput };
})();
