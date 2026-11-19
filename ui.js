/* ==========================================================================
   MARS JARVIS - UI layer: navigation, rendering, HUD orb, dialogs, toasts
   ========================================================================== */
'use strict';

Mars.UI = (() => {
  const U = Mars.util, C = Mars.CONST, M = Mars.Memory, D = Mars.Drive, V = Mars.Voice, N = Mars.Notes, T = Mars.Tasks, bus = Mars.bus;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const VIEWS = ['home', 'notes', 'tasks', 'memory', 'voice', 'settings'];
  const TITLES = { home: 'Command Center', notes: 'Notes', tasks: 'Tasks', memory: 'Memory Core', voice: 'Voice Console', settings: 'Settings' };
  const STATE_LABEL = {
    off: 'STANDBY', idle: 'LISTENING FOR “JARVIS”', awake: 'AWAKE · SPEAK NOW', ptt: 'LISTENING…',
    processing: 'PROCESSING', speaking: 'SPEAKING', muted: 'MIC MUTED', unsupported: 'VOICE INPUT UNAVAILABLE'
  };

  let current = 'home';
  let noteQuery = '';
  let taskFilter = 'all';
  let memCol = 'notes';
  let editingNoteId = null;
  let editingRec = null;      // { col, id|null }
  const session = [];         // command history while Drive is not connected

  /* ======================= toast ======================= */
  function toast(msg, opts = {}) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (opts.kind === 'err' ? ' err' : '');
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (opts.action) {
      const b = document.createElement('button');
      b.textContent = opts.action.label;
      b.onclick = () => { opts.action.fn(); el.remove(); };
      el.appendChild(b);
    }
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();   // never pile up
    setTimeout(() => el.remove(), opts.ms || 4000);
  }

  /* ======================= navigation ======================= */
  function go(view) {
    if (!VIEWS.includes(view)) view = 'home';
    current = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-btn').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#viewTitle').textContent = TITLES[view];
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* file:// etc. */ }
    renderView(view);
    window.scrollTo({ top: 0 });
  }

  function renderView(v) {
    switch (v) {
      case 'home': renderHome(); break;
      case 'notes': renderNotes(); break;
      case 'tasks': renderTasks(); break;
      case 'memory': renderMemory(); break;
      case 'voice': renderHistory(); break;
      case 'settings': renderSettings(); break;
      default: break;
    }
  }

  function renderAll() { renderStatus(); renderView(current); renderHistoryMini(); }

  /* ======================= status chips ======================= */
  function driveState() {
    if (!D.getClientId()) return { cls: 'bad', text: 'Drive not configured' };
    if (!D.isSignedIn() && !M.isReady()) return { cls: '', text: 'Drive offline' };
    switch (M.getStatus()) {
      case 'loading': return { cls: 'warn live', text: 'Syncing…' };
      case 'saving': return { cls: 'warn live', text: 'Saving…' };
      case 'error': return { cls: 'bad', text: 'Sync error' };
      case 'synced': return { cls: 'on', text: 'Synced' + (M.getLastSync() ? ' · ' + U.timeAgo(M.getLastSync()) : '') };
      default: return { cls: '', text: 'Drive offline' };
    }
  }

  function micState() {
    const s = V.getState();
    if (s === 'unsupported') return { cls: 'bad', text: 'Mic unsupported' };
    if (s === 'muted') return { cls: 'warn', text: 'Mic muted' };
    if (s === 'off') return { cls: '', text: 'Mic standby' };
    if (s === 'speaking') return { cls: 'on live', text: 'Speaking' };
    return { cls: 'on live', text: 'Listening' };
  }

  function setDot(el, cls) { el.className = 'dot ' + cls; }

  function renderStatus() {
    const d = driveState(), m = micState();
    setDot($('#chipDrive .dot'), d.cls); $('#chipDrive span:last-child').textContent = d.text;
    setDot($('#chipMic .dot'), m.cls); $('#chipMic span:last-child').textContent = m.text;
    setDot($('#sideDriveDot'), d.cls); $('#sideDriveText').textContent = d.text;
    setDot($('#sideMicDot'), m.cls); $('#sideMicText').textContent = m.text;
    $('#chipWake span:last-child').textContent = 'Wake word: ' + (M.getSettings().wakeWord || 'jarvis');

    // user chip
    const user = D.getUser();
    const connected = M.isReady();
    $('#userName').textContent = connected ? (user && user.displayName) || 'Connected' : D.isSignedIn() && D.getClientId() ? 'Reconnect' : 'Connect Drive';
    const av = $('#userAvatar');
    if (connected && user && user.photoLink) {
      av.textContent = '';
      const img = document.createElement('img');
      img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = user.photoLink;
      img.onerror = () => { av.textContent = (user.displayName || '?').charAt(0).toUpperCase(); };
      av.appendChild(img);
    } else {
      av.textContent = connected && user ? (user.displayName || '?').charAt(0).toUpperCase() : '?';
    }

    // connect buttons
    const label = D.isSignedIn() && D.getClientId() && !M.isReady() ? 'Reconnect Google Drive' : 'Connect Google Drive';
    $('#btnConnectHero span').textContent = label;
    $('#btnConnectHero').hidden = connected;
    $('#btnConnectSettings').textContent = label;
    $('#btnConnectSettings').hidden = connected;
    $('#btnDisconnect').hidden = !(connected || D.isSignedIn());

    // listening / mute buttons
    const listening = V.isListening();
    $$('.listen-text').forEach((el) => { el.textContent = listening ? 'Stop listening' : 'Start listening'; });
    $('#topMicText').textContent = listening ? 'Listening' : 'Listen';
    $('#topMic').classList.toggle('active-state', listening && !V.isMuted());
    $('#btnListen').classList.toggle('active-state', listening);
    $('#btnMute').classList.toggle('active-state', V.isMuted());
    $('#btnMute .mute-text').textContent = V.isMuted() ? 'Unmute' : 'Mute';

    const hint = $('#voiceSupportHint');
    if (!V.supported) {
      hint.hidden = false;
      hint.textContent = 'This browser does not support voice recognition. Use Chrome, Edge or Safari for voice input. Typing commands and spoken replies still work.';
    }
  }

  function renderVoiceState(s) {
    document.body.dataset.voice = s;
    $$('[data-voice-label]').forEach((el) => { el.textContent = STATE_LABEL[s] || ''; });
    renderStatus();
  }

  /* ======================= HOME ======================= */
  function greetingText() {
    const h = new Date().getHours();
    const g = h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good evening';
    const u = D.getUser();
    const first = u && u.displayName ? u.displayName.split(' ')[0] : '';
    return first ? `${g}, ${first}` : g;
  }

  function renderHome() {
    $('#greeting').textContent = greetingText();
    const ready = M.isReady();
    const tc = ready ? T.counts() : { open: 0, high: 0 };
    $('#statNotes').textContent = ready ? M.all('notes').length : '–';
    $('#statTasks').textContent = ready ? tc.open : '–';
    $('#statHigh').textContent = ready ? tc.high : '–';
    $('#statSync').textContent = M.getLastSync() ? U.timeAgo(M.getLastSync()) : '—';

    $('#heroSub').textContent = ready
      ? 'Memory online. Say “Jarvis, add note…” or “Jarvis, add task…”.'
      : D.getClientId()
        ? 'Connect your Google Drive to unlock memory, notes and tasks.'
        : 'Open Settings and paste your Google OAuth Client ID to get started.';

    const tasks = ready ? T.sorted().filter((t) => !t.done).slice(0, 5) : [];
    $('#homeTasks').innerHTML = tasks.length
      ? tasks.map((t) => `<li><span class="prio p-${t.priority}">${t.priority}</span><span class="t">${U.esc(t.title)}</span></li>`).join('')
      : `<li class="empty">${ready ? 'No open tasks. Say “add task…”.' : 'Connect Drive to see tasks.'}</li>`;

    const notes = ready ? N.list().slice(0, 4) : [];
    $('#homeNotes').innerHTML = notes.length
      ? notes.map((n) => `<li><span class="t">${U.esc(n.title)}</span><span class="m">${U.timeAgo(n.updatedAt || n.createdAt)}</span></li>`).join('')
      : `<li class="empty">${ready ? 'No notes yet. Say “add note…”.' : 'Connect Drive to see notes.'}</li>`;
    renderHistoryMini();
  }

  function historyItems() {
    const src = M.isReady() ? M.all('conversations') : session;
    return src.slice().reverse();
  }

  function renderHistoryMini() {
    const l = historyItems().slice(0, 5);
    $('#homeActivity').innerHTML = l.length
      ? l.map((h) => `<li><span class="t">${U.esc(h.user)}</span><span class="m">${U.timeAgo(h.ts || h.createdAt)}</span></li>`).join('')
      : '<li class="empty">No commands yet.</li>';
  }

  /* ======================= NOTES ======================= */
  function setNoteSearch(q) {
    noteQuery = q || '';
    $('#noteSearch').value = noteQuery;
    if (current === 'notes') renderNotes();
  }

  function renderNotes() {
    const grid = $('#notesGrid');
    if (!M.isReady()) { grid.innerHTML = '<div class="empty-state">Connect Google Drive to use notes.</div>'; return; }
    const all = N.list();
    const shown = noteQuery ? N.search(noteQuery) : all;
    if (!shown.length) {
      grid.innerHTML = `<div class="empty-state">${noteQuery ? 'No notes match your search.' : 'No notes yet. Press “New note” or say “Jarvis, add note…”.'}</div>`;
      return;
    }
    grid.innerHTML = shown.map((n) => {
      const idx = all.indexOf(n) + 1;
      return `<article class="panel hud note-card" role="button" tabindex="0" data-action="note-open" data-id="${n.id}">
        <h4><span class="n">#${idx}</span>${U.esc(n.title)}</h4>
        <p>${U.esc(n.content)}</p>
        <div class="meta"><span>${U.timeAgo(n.updatedAt || n.createdAt)}</span>
          <button class="icon-btn" data-action="note-del" data-id="${n.id}" aria-label="Delete note"><svg class="ic"><use href="#i-trash"/></svg></button></div>
      </article>`;
    }).join('');
  }

  function openNoteDialog(id) {
    if (!M.isReady()) return toast('Connect Google Drive first.', { kind: 'err' });
    editingNoteId = id || null;
    const note = id ? M.get('notes', id) : null;
    $('#noteDialogTitle').textContent = note ? 'Edit note' : 'New note';
    $('#noteTitleInput').value = note ? note.title : '';
    $('#noteContentInput').value = note ? note.content : '';
    $('#noteDelete').hidden = !note;
    $('#noteDialog').showModal();
    setTimeout(() => (note ? $('#noteContentInput') : $('#noteTitleInput')).focus(), 30);
  }

  function deleteNote(id) {
    const res = M.remove('notes', id);
    if (!res) return;
    toast('Note deleted', { action: { label: 'Undo', fn: () => M.restore('notes', res.item, res.index) } });
  }

  /* ======================= TASKS ======================= */
  function renderTasks() {
    const list = $('#taskList');
    if (!M.isReady()) { list.innerHTML = '<li class="empty-state">Connect Google Drive to use tasks.</li>'; return; }
    const all = T.sorted();
    let shown = all.map((t, i) => ({ t, n: i + 1 }));
    if (taskFilter === 'open') shown = shown.filter((x) => !x.t.done);
    if (taskFilter === 'done') shown = shown.filter((x) => x.t.done);
    if (!shown.length) {
      list.innerHTML = `<li class="empty-state">${taskFilter === 'done' ? 'No completed tasks yet.' : 'Nothing here. Add a task above or say “Jarvis, add task…”.'}</li>`;
      return;
    }
    list.innerHTML = shown.map(({ t, n }) => `
      <li class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
        <button class="check" data-action="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}"></button>
        <span class="num">${n}</span>
        <span class="t-title">${U.esc(t.title)}</span>
        <button class="prio p-${t.priority}" data-action="task-prio" data-id="${t.id}" title="Change priority">${t.priority}</button>
        <button class="icon-btn" data-action="task-del" data-id="${t.id}" aria-label="Delete task"><svg class="ic"><use href="#i-trash"/></svg></button>
      </li>`).join('');
  }

  /* ======================= MEMORY ======================= */
  function recTitle(col, r) {
    if (col === 'conversations') return r.user || '(empty)';
    return r.title || r.topic || r.name || r.id;
  }
  function recSub(col, r) {
    if (col === 'conversations') return (r.source || '') + ' · ' + (r.reply || '');
    if (col === 'tasks') return `${r.priority || 'medium'} · ${r.done ? 'done' : 'open'}`;
    const t = r.content || r.summary || '';
    return String(t).replace(/\s+/g, ' ');
  }

  function renderMemory() {
    const ready = M.isReady();
    $('#memColTitle').textContent = memCol.charAt(0).toUpperCase() + memCol.slice(1);
    $$('#memTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.col === memCol));
    $('#memNew').hidden = memCol === 'settings' || memCol === 'conversations';

    const fid = M.getFileId();
    $('#memFile').textContent = C.DATA_FILE;
    const open = $('#memOpen');
    open.hidden = !(ready && fid);
    if (fid) open.href = 'https://drive.google.com/file/d/' + encodeURIComponent(fid) + '/view';

    const st = M.getStatus();
    $('#memMeta').textContent = !ready
      ? 'Not connected. Connect Google Drive in Settings.'
      : `${st === 'error' ? 'Sync error: ' + ((M.getLastError() || {}).message || 'unknown') : st === 'saving' ? 'Saving…' : M.isDirty() ? 'Unsaved changes' : 'All changes saved'} · ${(M.size() / 1024).toFixed(1)} KB · last sync ${U.timeAgo(M.getLastSync()) || '—'}`;

    const ul = $('#memList');
    if (!ready) { ul.innerHTML = '<li class="empty">Nothing loaded.</li>'; return; }

    if (memCol === 'settings') {
      const s = M.getSettings();
      ul.innerHTML = Object.keys(s).map((k) =>
        `<li class="rec"><div class="r-main"><div class="r-title">${U.esc(k)}</div><div class="r-sub">${U.esc(JSON.stringify(s[k]))}</div></div></li>`).join('');
      return;
    }
    const items = M.all(memCol).slice().reverse();
    ul.innerHTML = items.length
      ? items.map((r) => `<li class="rec">
          <div class="r-main"><div class="r-title">${U.esc(recTitle(memCol, r))}</div><div class="r-sub">${U.esc(recSub(memCol, r))}</div></div>
          <div class="r-actions">
            <button class="btn ghost sm" data-action="rec-edit" data-id="${r.id}">Edit</button>
            <button class="icon-btn" data-action="rec-del" data-id="${r.id}" aria-label="Delete record"><svg class="ic"><use href="#i-trash"/></svg></button>
          </div></li>`).join('')
      : '<li class="empty">No records.</li>';
  }

  function openRecordDialog(col, id) {
    if (!M.isReady()) return toast('Connect Google Drive first.', { kind: 'err' });
    editingRec = { col, id: id || null };
    const rec = id ? M.get(col, id) : { title: '', content: '' };
    $('#recordDialogTitle').textContent = (id ? 'Edit ' : 'New ') + col + ' record';
    $('#recordJson').value = JSON.stringify(rec, null, 2);
    $('#recordErr').textContent = '';
    $('#recordDialog').showModal();
  }

  /* ======================= HISTORY ======================= */
  function addHistory(entry) {
    const rec = Object.assign({ ts: U.now() }, entry);
    if (M.isReady()) M.add('conversations', rec); else { session.push(Object.assign({ id: U.uid() }, rec)); if (session.length > 100) session.shift(); }
    renderHistory(); renderHistoryMini();
  }

  function renderHistory() {
    const l = historyItems().slice(0, 100);
    $('#historyList').innerHTML = l.length
      ? l.map((h) => `<li class="h-item ${h.ok === false ? 'bad' : ''}">
          <div class="h-meta"><span>${U.fmtDateTime(h.ts || h.createdAt)}</span><span>${U.esc(h.source || 'text').toUpperCase()}</span></div>
          <div class="h-user">“${U.esc(h.user)}”</div>
          ${h.reply ? `<div class="h-reply">${U.esc(h.reply)}</div>` : ''}</li>`).join('')
      : '<li class="empty" style="color:var(--muted)">No commands yet. Say “Jarvis, help”.</li>';
  }

  function showReply(text) { $('#liveReply').textContent = text || ''; }
  function showTranscript(text, interim) {
    const el = $('#liveTranscript');
    el.textContent = text ? (interim ? text : '“' + text + '”') : 'Say “Jarvis” and then your command.';
    el.classList.toggle('interim', !!interim);
  }

  /* ======================= SETTINGS ======================= */
  function renderSettings() {
    $('#originText').textContent = location.origin === 'null' || location.protocol === 'file:'
      ? 'Serve the app over http(s) first; file:// cannot be used'
      : location.origin;
    if (document.activeElement !== $('#clientId')) $('#clientId').value = D.getClientId();
    const s = M.getSettings();
    $$('[data-setting]').forEach((el) => {
      if (document.activeElement === el) return;
      const key = el.dataset.setting;
      const v = s[key];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.tagName === 'SELECT' && key === 'voiceURI') el.value = v || '';
      else el.value = v == null ? '' : v;
    });
    $$('[data-out]').forEach((o) => { o.textContent = Number(s[o.dataset.out]).toFixed(2).replace(/0$/, ''); });
    renderAuthStatus();
  }

  function renderAuthStatus(msg) {
    let t = msg;
    if (!t) {
      if (M.isReady()) { const u = D.getUser(); t = 'Connected' + (u && u.emailAddress ? ' as ' + u.emailAddress : '') + '. Data file: ' + C.DATA_FILE; }
      else if (!D.getClientId()) t = 'Paste your OAuth Client ID above, save it, then connect. See README for the 2-minute Google Cloud setup.';
      else t = 'Not connected.';
    }
    $('#authStatus').textContent = t;
  }

  function fillVoices() {
    const sel = $('#voiceSelect');
    const cur = M.getSettings().voiceURI || '';
    const voices = V.getVoices();
    sel.innerHTML = '<option value="">Automatic</option>' + voices.map((v) =>
      `<option value="${U.esc(v.voiceURI)}">${U.esc(v.name)} (${U.esc(v.lang)})</option>`).join('');
    sel.value = cur;
  }

  /* ======================= HUD orb canvas ======================= */
  const orbs = [];
  let rgb = '255,106,61';
  let rgbAt = 0;

  function initOrbs() {
    $$('[data-orb] .orb-canvas').forEach((cv) => orbs.push(cv));
    requestAnimationFrame(frame);
  }

  function resizeCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h };
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = ts / 1000;
    if (ts - rgbAt > 800) {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
      if (v) rgb = v;
      rgbAt = ts;
    }
    const state = V.getState();
    const lv = V.level();
    orbs.forEach((cv) => { if (cv.offsetParent !== null) drawOrb(cv, t, state, lv); });
  }

  function drawOrb(cv, t, state, realLevel) {
    const { w, h } = resizeCanvas(cv);
    if (!w) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, base = Math.min(w, h) * 0.31;
    const N_BARS = 72;

    // overall amplitude by state
    let amp;
    switch (state) {
      case 'speaking': amp = 0.55 + 0.35 * Math.sin(t * 9) * Math.sin(t * 3.1); break;
      case 'ptt':
      case 'idle':
      case 'awake': amp = realLevel >= 0 ? 0.12 + realLevel * 1.2 : (state === 'idle' ? 0.12 : 0.35 + 0.15 * Math.sin(t * 6)); break;
      case 'processing': amp = 0.25; break;
      default: amp = 0.05;
    }
    amp = Math.max(0.04, Math.min(1.2, amp));

    const spin = state === 'processing' ? t * 3 : t * 0.3;
    const sweep = (t * 2) % 1;

    for (let i = 0; i < N_BARS; i++) {
      const f = i / N_BARS;
      const ang = f * Math.PI * 2 - Math.PI / 2 + spin * 0.2;
      const noise = 0.5 + 0.5 * Math.sin(i * 1.7 + t * 6 + Math.sin(i * 0.3 + t) * 3);
      let len = base * (0.06 + amp * 0.5 * noise);
      let alpha = 0.35 + 0.5 * noise * Math.min(1, amp * 1.5);
      if (state === 'processing') {
        const d = Math.abs(((f - sweep + 1.5) % 1) - 0.5);
        const hit = Math.max(0, 1 - d * 6);
        len = base * (0.06 + 0.35 * hit);
        alpha = 0.25 + 0.75 * hit;
      }
      const r0 = base * 1.03, r1 = r0 + len;
      ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, w * 0.006);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${rgb},0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, base, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ======================= events ======================= */
  function showFormInput(form) { return form.querySelector('input'); }

  function bindEvents() {
    // navigation
    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    window.addEventListener('hashchange', () => {
      const v = location.hash.replace('#', '');
      if (VIEWS.includes(v) && v !== current) go(v);
    });

    // typed commands (home + console)
    $$('[data-cmd-form]').forEach((form) => form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = showFormInput(form);
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      Mars.handleInput(text, 'text');
    }));

    // notes
    $('#noteSearch').addEventListener('input', (e) => { noteQuery = e.target.value; renderNotes(); });
    $('#noteForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = $('#noteTitleInput').value, content = $('#noteContentInput').value.trim();
      if (!content) return;
      if (editingNoteId) N.update(editingNoteId, { title, content });
      else N.create(content, title);
      $('#noteDialog').close();
    });
    $('#noteDelete').addEventListener('click', () => { if (editingNoteId) deleteNote(editingNoteId); $('#noteDialog').close(); });

    // tasks
    $('#taskForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!M.isReady()) return toast('Connect Google Drive first.', { kind: 'err' });
      const input = $('#taskTitle');
      const title = input.value.trim();
      if (!title) return;
      T.add(title, $('#taskPriority').value);
      input.value = '';
      input.focus();
    });
    $('#taskTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      taskFilter = b.dataset.filter;
      $$('#taskTabs .tab').forEach((x) => x.classList.toggle('active', x === b));
      renderTasks();
    });

    // memory
    $('#memTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-col]');
      if (!b) return;
      memCol = b.dataset.col;
      renderMemory();
    });
    $('#recordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      let obj;
      try { obj = JSON.parse($('#recordJson').value); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Record must be a JSON object.'); }
      catch (err) { $('#recordErr').textContent = 'Invalid JSON: ' + err.message; return; }
      if (editingRec.id) M.replace(editingRec.col, editingRec.id, obj);
      else M.add(editingRec.col, obj);
      $('#recordDialog').close();
    });

    // dialogs: close buttons + backdrop click
    $$('dialog').forEach((dlg) => {
      dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
    });

    // settings (generic)
    $$('[data-setting]').forEach((el) => {
      const evt = el.type === 'range' ? 'input' : 'change';
      el.addEventListener(evt, () => {
        const key = el.dataset.setting;
        let val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'range' || el.type === 'number') val = Number(el.value);
        else val = el.value.trim();
        if (key === 'wakeWord' && !val) val = 'jarvis';
        if (key === 'awakeSeconds') val = Math.min(30, Math.max(3, val || 8));
        M.setSettings({ [key]: val });
        if (key === 'theme') applyTheme(val);
        if (key === 'autoStart') U.lsSet(C.LS.autoStart, val ? '1' : '0');
        renderStatus();
        if (current === 'settings') {
          $$('[data-out]').forEach((o) => { o.textContent = Number(M.getSettings()[o.dataset.out]).toFixed(2).replace(/0$/, ''); });
        }
        // keep the duplicated "Spoken responses" switches in sync
        if (el.type === 'checkbox') $$(`[data-setting="${key}"]`).forEach((o) => { o.checked = val; });
      });
    });

    // push-to-talk (pointer + Space key)
    const ptt = $('#btnPtt');
    const down = (e) => { e.preventDefault(); ptt.classList.add('holding'); V.pttStart(); };
    const up = () => { ptt.classList.remove('holding'); V.pttEnd(); };
    ptt.addEventListener('pointerdown', down);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => ptt.addEventListener(evt, up));
    ptt.addEventListener('contextmenu', (e) => e.preventDefault());
    let spaceHeld = false;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || spaceHeld) return;
      if (current !== 'voice' || /input|textarea|select|button/i.test(document.activeElement.tagName)) return;
      e.preventDefault(); spaceHeld = true; down(e);
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space' && spaceHeld) { spaceHeld = false; up(); } });

    // global click delegation
    document.addEventListener('click', onAction);
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.note-card')) { e.preventDefault(); openNoteDialog(e.target.dataset.id); }
    });

    // activation banner
    bus.on('voice:needsActivation', () => { $('#activationBanner').hidden = false; });
    ['pointerdown', 'keydown'].forEach((evt) => window.addEventListener(evt, () => { $('#activationBanner').hidden = true; }, { once: true, passive: true }));
  }

  async function onAction(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = el.dataset.id;
    const act = el.dataset.action;
    if (el.closest('.note-card') && act === 'note-del') e.stopPropagation();

    switch (act) {
      case 'connect': return Mars.connect();
      case 'disconnect': return Mars.disconnect();
      case 'save-client': {
        D.setClientId($('#clientId').value);
        toast(D.getClientId() ? 'Client ID saved.' : 'Client ID cleared.');
        bus.emit('client:changed');
        renderAll();
        return;
      }
      case 'listen-toggle': V.isListening() ? V.stopListening() : V.startListening(); U.lsSet(C.LS.autoStart, V.isListening() ? '1' : '0'); return renderStatus();
      case 'mute-toggle': V.setMuted(!V.isMuted()); return renderStatus();
      case 'test-voice': return V.speak('Mars Jarvis online. All systems nominal.');
      case 'clear-history':
        if (M.isReady()) M.clear('conversations'); else session.length = 0;
        return renderHistory();
      case 'note-new': return openNoteDialog(null);
      case 'note-open': return openNoteDialog(id);
      case 'note-del': e.preventDefault(); return deleteNote(id);
      case 'task-toggle': return T.toggle(id);
      case 'task-prio': return T.cyclePriority(id);
      case 'task-del': {
        const res = T.remove(id);
        if (res) toast('Task deleted', { action: { label: 'Undo', fn: () => M.restore('tasks', res.item, res.index) } });
        return;
      }
      case 'mem-save':
        try { await M.save(); toast('Saved to Google Drive.'); } catch (err) { toast('Save failed: ' + err.message, { kind: 'err' }); }
        return renderMemory();
      case 'mem-reload':
        try { await M.save().catch(() => {}); await M.load(); toast('Reloaded from Google Drive.'); } catch (err) { toast('Reload failed: ' + err.message, { kind: 'err' }); }
        return;
      case 'mem-export': {
        if (!M.isReady()) return toast('Connect Google Drive first.', { kind: 'err' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([M.exportJSON()], { type: 'application/json' }));
        a.download = C.DATA_FILE;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return;
      }
      case 'rec-new': return openRecordDialog(memCol, null);
      case 'rec-edit': return openRecordDialog(memCol, id);
      case 'rec-del': {
        const res = M.remove(memCol, id);
        if (res) toast('Record deleted', { action: { label: 'Undo', fn: () => M.restore(memCol, res.item, res.index) } });
        return;
      }
      default: return undefined;
    }
  }

  function applyTheme(theme) {
    const t = theme === 'stark' ? 'stark' : 'mars';
    document.documentElement.dataset.theme = t;
    U.lsSet(C.LS.theme, t);
    rgbAt = 0;
  }

  /* ======================= init ======================= */
  function init() {
    applyTheme(U.lsGet(C.LS.theme) || 'mars');
    bindEvents();
    initOrbs();

    bus.on('voice:state', renderVoiceState);
    bus.on('voice:voices', fillVoices);
    bus.on('voice:listening', renderStatus);
    bus.on('voice:muted', renderStatus);
    bus.on('voice:error', (m) => toast(m, { kind: 'err', ms: 7000 }));
    bus.on('voice:interim', (t) => showTranscript(t, true));
    bus.on('voice:heard', (t) => showTranscript(t, false));
    bus.on('voice:wake', () => {
      document.body.classList.add('wake-flash');
      setTimeout(() => document.body.classList.remove('wake-flash'), 900);
    });

    bus.on('memory:loaded', () => { applyTheme(M.getSettings().theme); fillVoices(); renderAll(); });
    bus.on('memory:unloaded', renderAll);
    bus.on('memory:changed', () => { renderStatus(); renderView(current); renderHistoryMini(); });
    bus.on('memory:status', () => { renderStatus(); if (current === 'memory') renderMemory(); if (current === 'home') renderHome(); });
    bus.on('auth:signedin', () => { renderStatus(); renderAuthStatus(); });
    bus.on('auth:signedout', () => { renderAll(); renderAuthStatus('Disconnected.'); });
    bus.on('auth:reconnect', () => { renderAll(); toast('Session expired. Press Reconnect to continue.'); });
    bus.on('auth:error', (err) => { toast('Google sign-in: ' + err.message, { kind: 'err', ms: 8000 }); renderAuthStatus('Sign-in failed: ' + err.message); });
    bus.on('auth:needsconfig', () => { renderAll(); });
    bus.on('auth:unavailable', () => toast('Google sign-in script could not load (offline or blocked).', { kind: 'err', ms: 8000 }));
    bus.on('memory:error', (err) => { toast('Drive: ' + err.message, { kind: 'err', ms: 8000 }); });

    const start = location.hash.replace('#', '');
    go(VIEWS.includes(start) ? start : 'home');
    renderVoiceState(V.getState());
    setInterval(() => { if (current === 'home' || current === 'memory') renderStatus(); }, 30000);
  }

  return { init, go, toast, setNoteSearch, addHistory, showReply, showTranscript, renderAll };
})();
