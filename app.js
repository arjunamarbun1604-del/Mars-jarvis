/* ==========================================================================
   MARS JARVIS - bootstrap: wires voice -> commands -> memory -> UI
   ========================================================================== */
'use strict';

(() => {
  const { bus, util: U } = Mars;
  let greeted = false;

  /** Run one command (typed or spoken), log it, show it and speak the reply. */
  Mars.handleInput = async function handleInput(text, source) {
    Mars.Voice.setBusy(true);
    let res;
    try { res = await Mars.Commands.run(text); }
    catch (err) { res = { reply: 'Something went wrong: ' + err.message, ok: false }; }
    Mars.Voice.setBusy(false);

    Mars.UI.addHistory({ user: text, reply: res.reply || '', source: source || 'text', ok: res.ok !== false });
    Mars.UI.showReply(res.reply);
    Mars.UI.showTranscript(text, false);

    if (res.reply && !res.silent && !res.noSpeak) await Mars.Voice.speak(res.reply);
    if (res.listen) Mars.Voice.openWindow();
  };

  Mars.connect = async function connect() {
    if (!Mars.Drive.getClientId()) {
      Mars.UI.toast('Paste your Google OAuth Client ID first.', { kind: 'err' });
      Mars.UI.go('settings');
      return;
    }
    try {
      await Mars.Drive.signIn();   // -> 'auth:signedin' -> memory load
    } catch (err) {
      Mars.UI.toast(err.message, { kind: 'err', ms: 8000 });
    }
  };

  Mars.disconnect = function disconnect() {
    Mars.Drive.signOut();
    Mars.Memory.unload();
    Mars.UI.toast('Disconnected from Google Drive. Your data stays in your Drive.');
  };

  function greetOnce() {
    if (greeted) return;
    greeted = true;
    const h = new Date().getHours();
    const g = h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good evening';
    const u = Mars.Drive.getUser();
    const name = u && u.displayName ? ', ' + u.displayName.split(' ')[0] : '';
    Mars.Voice.speak(`${g}${name}. Mars Jarvis is online.`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    Mars.UI.init();
    Mars.Voice.init();

    // voice events
    bus.on('voice:command', ({ text, source }) => Mars.handleInput(text, source));
    bus.on('voice:awake', () => Mars.Voice.speak('Yes?'));

    // auth -> memory
    bus.on('auth:signedin', async () => {
      try {
        await Mars.Memory.load();
        Mars.UI.toast('Memory online. Loaded from Google Drive.');
        greetOnce();
      } catch (err) {
        Mars.UI.toast('Could not load memory: ' + err.message, { kind: 'err', ms: 9000 });
      }
    });
    bus.on('client:changed', () => { Mars.Drive.init(); });

    // settings that affect the engine
    bus.on('settings:changed', (patch) => {
      if (patch && 'theme' in patch) document.documentElement.dataset.theme = patch.theme;
    });

    Mars.Drive.init();
  });
})();
