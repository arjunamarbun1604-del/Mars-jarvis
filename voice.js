/* ==========================================================================
   MARS JARVIS - Voice engine (Web Speech API)
   - SpeechRecognition : continuous listening + wake word + push-to-talk
   - SpeechSynthesis   : spoken responses
   States: off | idle | awake | ptt | processing | speaking | muted | unsupported
   ========================================================================== */
'use strict';

Mars.Voice = (() => {
  const U = Mars.util, C = Mars.CONST, bus = Mars.bus;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis || null;
  const supported = !!SR;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let rec = null;
  let recRunning = false;
  let wantListening = false;
  let muted = false;
  let speaking = false;
  let busy = false;
  let awakeUntil = 0;
  let awakeTimer = null;
  let ptt = false;
  let pttRelease = false;
  let pttBuf = [];
  let pttTimer = null;
  let restartTimer = null;
  let flaps = 0;            // consecutive recognizer sessions that died on their own, very quickly
  let recStartAt = 0;
  let selfStopped = false;  // we stopped it (speaking, mute, ptt) - not an engine fault
  let voices = [];
  let deferred = null;
  let lastWakeFlash = 0;
  let state = 'off';
  let audio = { ctx: null, an: null, data: null, stream: null, lvl: 0, starting: false };

  const S = () => Mars.Memory.getSettings();
  const shouldRun = () => supported && !muted && !speaking && (wantListening || ptt);

  /* ---------------- state ---------------- */
  function compute() {
    if (!supported) return 'unsupported';
    if (muted) return 'muted';
    if (speaking) return 'speaking';
    if (busy) return 'processing';
    if (ptt) return 'ptt';
    if (awakeUntil > Date.now()) return 'awake';
    return wantListening ? 'idle' : 'off';
  }
  function setState() {
    const s = compute();
    if (s !== state) { state = s; bus.emit('voice:state', s); }
  }

  /* ---------------- wake word ---------------- */
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function wakeRegex() {
    const w = (S().wakeWord || 'jarvis').trim().toLowerCase();
    const alts = w === 'jarvis' ? ['jarvis', 'jarvus', 'jervis', 'jarvice', 'jarviss'] : [w];
    return new RegExp('\\b(?:(?:hey|ok|okay)\\s+)?(?:' + alts.map(escapeRe).join('|') + ')\\b[\\s,.:;!?-]*', 'i');
  }
  function extractWake(text) {
    const m = wakeRegex().exec(text);
    if (!m) return null;
    return { rest: text.slice(m.index + m[0].length).trim() };
  }

  function openWindow() {
    const secs = Math.max(3, Number(S().awakeSeconds) || 8);
    awakeUntil = Date.now() + secs * 1000;
    clearTimeout(awakeTimer);
    awakeTimer = setTimeout(setState, secs * 1000 + 60);
    setState();
  }

  function flashWake() {
    const now = Date.now();
    if (now - lastWakeFlash < 1500) return;
    lastWakeFlash = now;
    bus.emit('voice:wake');
  }

  /* ---------------- recognition ---------------- */
  function build() {
    if (!SR || rec) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = S().lang || 'en-US';
    rec.onstart = () => { recRunning = true; recStartAt = Date.now(); selfStopped = false; setState(); };
    rec.onend = () => {
      recRunning = false;
      if (selfStopped) { /* intentional */ }
      else if (Date.now() - recStartAt < 1200) flaps++;
      else flaps = 0;
      if (pttRelease) finishPtt();
      setState();
      if (shouldRun()) scheduleRestart();
    };
    rec.onerror = onError;
    rec.onresult = onResult;
  }

  function startRec() {
    if (!SR) return;
    if (!rec) build();
    if (recRunning) return;
    try { rec.lang = S().lang || 'en-US'; rec.start(); } catch (e) { /* already starting */ }
  }

  function stopRec(abort) {
    clearTimeout(restartTimer);
    if (rec && recRunning) { selfStopped = true; try { abort ? rec.abort() : rec.stop(); } catch (e) { /* ignore */ } }
  }

  function scheduleRestart() {
    clearTimeout(restartTimer);
    const delay = flaps > 3 ? 2500 : 250; // back off only if the engine keeps dying by itself
    restartTimer = setTimeout(() => { if (shouldRun()) startRec(); }, delay);
  }

  function onError(e) {
    switch (e.error) {
      case 'not-allowed':
      case 'service-not-allowed':
        wantListening = false; ptt = false;
        stopRec(true);
        bus.emit('voice:error', 'Microphone access is blocked. Allow the microphone for this site, then press Start listening.');
        break;
      case 'audio-capture':
        wantListening = false;
        bus.emit('voice:error', 'No microphone was found.');
        break;
      case 'network':
        bus.emit('voice:error', 'The speech service could not be reached. Retrying…');
        break;
      case 'language-not-supported':
        wantListening = false;
        bus.emit('voice:error', 'That recognition language is not supported by this browser.');
        break;
      default: break; // no-speech / aborted are normal
    }
    setState();
  }

  function onResult(e) {
    let interim = '';
    const finals = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r[0].transcript;
      if (r.isFinal) finals.push(t.trim()); else interim += t;
    }
    if (speaking || muted) return;
    if (interim) {
      bus.emit('voice:interim', interim.trim());
      if (!ptt && extractWake(interim)) flashWake();
    }
    finals.forEach(processFinal);
  }

  function processFinal(text) {
    if (!text || speaking || muted) return;
    bus.emit('voice:heard', text);
    if (ptt || pttRelease) { pttBuf.push(text); return; }

    const w = extractWake(text);
    if (w) {
      flashWake();
      if (w.rest) { awakeUntil = 0; dispatch(w.rest, 'voice'); }
      else { openWindow(); bus.emit('voice:awake'); }
      return;
    }
    if (awakeUntil > Date.now()) { awakeUntil = 0; dispatch(text, 'voice'); }
  }

  function dispatch(text, source) {
    setState();
    bus.emit('voice:command', { text, source });
  }

  /* ---------------- push to talk ---------------- */
  function pttStart() {
    if (!supported) { bus.emit('voice:error', 'Voice input is not supported in this browser. Use Chrome, Edge or Safari.'); return; }
    if (muted) setMuted(false);
    cancelSpeech();
    clearTimeout(pttTimer);
    ptt = true; pttRelease = false; pttBuf = [];
    startAnalyser();
    startRec();
    setState();
  }

  function pttEnd() {
    if (!ptt) return;
    ptt = false; pttRelease = true;
    if (!wantListening && recRunning) { selfStopped = true; try { rec.stop(); } catch (e) { /* ignore */ } }
    clearTimeout(pttTimer);
    pttTimer = setTimeout(finishPtt, 1600);
    setState();
  }

  function finishPtt() {
    if (!pttRelease) return;
    clearTimeout(pttTimer);
    pttRelease = false;
    const text = pttBuf.join(' ').trim();
    pttBuf = [];
    if (!wantListening) stopAnalyser();
    setState();
    if (text) {
      // allow "Jarvis ..." inside push-to-talk too
      const w = extractWake(text);
      dispatch(w && w.rest ? w.rest : text, 'ptt');
    }
  }

  /* ---------------- listening controls ---------------- */
  function startListening() {
    if (!supported) { bus.emit('voice:error', 'Voice input is not supported in this browser. Use Chrome, Edge or Safari.'); return; }
    wantListening = true;
    if (muted) setMuted(false);
    startAnalyser();
    startRec();
    setState();
    bus.emit('voice:listening', true);
  }

  function stopListening() {
    wantListening = false;
    awakeUntil = 0;
    stopRec(true);
    if (!ptt) stopAnalyser();
    setState();
    bus.emit('voice:listening', false);
  }

  function setMuted(m) {
    muted = !!m;
    if (muted) { stopRec(true); cancelSpeech(); stopAnalyser(); awakeUntil = 0; }
    else { if (wantListening) startAnalyser(); if (shouldRun()) startRec(); }
    setState();
    bus.emit('voice:muted', muted);
  }

  function setBusy(b) { busy = !!b; setState(); }

  /* ---------------- speech output ---------------- */
  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices() || [];
    bus.emit('voice:voices', voices);
  }

  function pickVoice() {
    const st = S();
    if (st.voiceURI) {
      const v = voices.find((x) => x.voiceURI === st.voiceURI);
      if (v) return v;
    }
    const lang = String(st.lang || 'en-US').slice(0, 2).toLowerCase();
    const pool = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
    const male = pool.find((v) => /daniel|google uk english male|guy|david|ryan|thomas|alex|male/i.test(v.name));
    return male || pool[0] || voices[0] || null;
  }

  const clean = (t) => String(t).replace(/[*_`#>]/g, ' ').replace(/\s+/g, ' ').trim();

  function speak(text) {
    return new Promise((resolve) => {
      const st = S();
      if (!synth || !st.speak || !text) return resolve();
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
        deferred = text;            // the browser would silently block it; say it after the first click
        bus.emit('voice:needsActivation');
        return resolve();
      }
      try { synth.cancel(); } catch (e) { /* ignore */ }

      const u = new SpeechSynthesisUtterance(clean(text));
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = st.lang || 'en-US'; }
      u.rate = Number(st.rate) || 1;
      u.pitch = Number(st.pitch) || 1;
      const vol = Number(st.volume);
      u.volume = isNaN(vol) ? 1 : Math.min(1, Math.max(0, vol));

      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        speaking = false;
        if (awakeUntil > Date.now()) openWindow();   // give a fresh window after "Yes?"
        setState();
        if (shouldRun()) scheduleRestart();
        resolve();
      };
      const watchdog = setTimeout(end, Math.max(4000, u.text.length * 95) + 3000);
      u.onstart = () => { speaking = true; setState(); };
      u.onend = end;
      u.onerror = end;

      speaking = true;
      stopRec(true);               // do not let the mic hear Jarvis talking
      setState();
      setTimeout(() => {
        try { synth.speak(u); } catch (e) { end(); }
      }, 60);
    });
  }

  function cancelSpeech() {
    if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
  }

  /** Speak anything that was held back until the first user interaction. */
  function onFirstInteraction() {
    if (deferred) { const t = deferred; deferred = null; speak(t); }
  }

  /* ---------------- audio level (for the HUD) ---------------- */
  async function startAnalyser() {
    if (isMobile || audio.stream || audio.starting || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    audio.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!(wantListening || ptt) || muted) { stream.getTracks().forEach((t) => t.stop()); return; }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      audio = { ctx, an, data: new Uint8Array(an.fftSize), stream, lvl: 0, starting: false };
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) { /* the HUD falls back to a simulated waveform */ }
    finally { audio.starting = false; }
  }

  function stopAnalyser() {
    if (audio.stream) audio.stream.getTracks().forEach((t) => t.stop());
    if (audio.ctx) audio.ctx.close().catch(() => {});
    audio = { ctx: null, an: null, data: null, stream: null, lvl: 0, starting: false };
  }

  /** 0..1, or -1 when no real microphone level is available. */
  function level() {
    if (!audio.an) return -1;
    audio.an.getByteTimeDomainData(audio.data);
    let sum = 0;
    for (let i = 0; i < audio.data.length; i++) { const v = (audio.data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / audio.data.length);
    audio.lvl = audio.lvl * 0.7 + Math.min(1, rms * 5) * 0.3;
    return audio.lvl;
  }

  /* ---------------- init ---------------- */
  function init() {
    if (synth) {
      loadVoices();
      if ('onvoiceschanged' in synth) synth.onvoiceschanged = loadVoices;
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach((evt) =>
      window.addEventListener(evt, onFirstInteraction, { once: true, passive: true }));

    bus.on('settings:changed', (patch) => {
      if (rec && patch && 'lang' in patch) { rec.lang = patch.lang; if (recRunning) stopRec(true); }
    });

    setState();
    const auto = U.lsGet(C.LS.autoStart);
    if (supported && auto !== '0') startListening();
  }

  return {
    init, supported,
    startListening, stopListening, setMuted, pttStart, pttEnd,
    speak, cancelSpeech, setBusy, openWindow, level,
    getVoices: () => voices,
    getState: () => state,
    isListening: () => wantListening,
    isMuted: () => muted,
    isSpeaking: () => speaking
  };
})();
