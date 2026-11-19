# MARS JARVIS — Phase 1 (Foundation)

A browser-based personal AI operating system inspired by Tony Stark's Jarvis.
**Stack:** HTML, CSS, vanilla JavaScript. No framework, no backend, no database.
All persistent data lives in **your Google Drive** in one file: `jarvis-data.json`.

## What Phase 1 includes

| Area | Details |
|---|---|
| UI | Dark futuristic dashboard, glassmorphism panels, animated HUD (reactor orb, scanline, grid), sidebar navigation, responsive (bottom bar on phones) |
| Sections | Home, Notes, Tasks, Memory, Voice Console, Settings |
| Voice | Web Speech API: continuous listening, wake word **"Jarvis"**, listening indicator, push-to-talk, mute, spoken replies, command history |
| Auth | Google Sign-In (Google Identity Services) + Drive access |
| Memory | `jarvis-data.json` with `notes`, `tasks`, `research`, `settings`, `conversations`; load / save / edit / delete |
| Notes | Create, edit, delete, search |
| Tasks | Add, complete, delete, priority (high / medium / low) |

## Run it

The app is static files, but Google sign-in and the microphone need a real origin, so do **not** open `index.html` by double-clicking (`file://` will not work).

**Option A — on your computer (fastest)**

```
cd MarsJarvis
python3 -m http.server 8000
```
Open **http://localhost:8000** in Chrome or Edge.

**Option B — GitHub Pages (works on your phone too)**
Upload this folder to a GitHub repository, then Settings → Pages → deploy from the `main` branch. Your origin will be `https://YOUR-NAME.github.io`.

## One-time Google setup (about 3 minutes)

1. Go to <https://console.cloud.google.com/> and create a project (any name).
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** → choose *External* → fill in the app name and your email → Save.
   - Under **Audience / Test users**, add your own Google account while the app is in *Testing* mode.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
5. Under **Authorized JavaScript origins**, add the exact origin you will use, for example:
   - `http://localhost:8000`
   - `https://YOUR-NAME.github.io`
   (origin only, no path, no trailing slash)
6. Copy the **Client ID** (ends with `.apps.googleusercontent.com`).
7. Open Mars Jarvis → **Settings** → paste the Client ID → **Save Client ID** → **Connect Google Drive**.
8. In the Google popup, tick the Drive permission. Mars Jarvis creates `jarvis-data.json` in your Drive.

Mars Jarvis uses the narrow `drive.file` scope, so it can only see files it created itself, never the rest of your Drive.
There is no client secret to protect; the Client ID is public by design.

## Voice commands

Say **"Jarvis"** then the command. If you say only "Jarvis", it answers "Yes?" and listens for 8 seconds.
You can also hold the **Hold to talk** button (or hold **Space** in the Voice Console) and speak without the wake word, or type commands in the box.

| Notes | |
|---|---|
| `Jarvis, add note blockchain idea` | → "I have saved your note." |
| `Jarvis, save note …` · `Jarvis, add note` (it asks what to write) | |
| `Jarvis, show notes` · `read note 2` | |
| `Jarvis, search notes blockchain` | |
| `Jarvis, edit note 2 to new text` | |
| `Jarvis, delete note 2` | |

| Tasks | |
|---|---|
| `Jarvis, add task call the bank` | |
| `Jarvis, add high priority task pay rent` · `add task book flights with low priority` | |
| `Jarvis, show tasks` | |
| `Jarvis, complete task 1` · `complete task pay rent` | |
| `Jarvis, delete task 2` | |
| `Jarvis, set task 2 to high priority` · `prioritize task 3` | |

| General | |
|---|---|
| `open home / memory / settings / voice console` | |
| `undo` (restores the last deleted note or task) | |
| `save memory` · `clear history` · `what time is it` · `help` · `stop` · `mute` | |

Numbers refer to the order shown on screen: notes newest-first, tasks by priority with completed ones last.

## Data file

```json
{
  "version": 1,
  "notes":         [{ "id": "", "title": "", "content": "", "createdAt": "", "updatedAt": "" }],
  "tasks":         [{ "id": "", "title": "", "priority": "high|medium|low", "done": false, "createdAt": "", "completedAt": null }],
  "research":      [],
  "settings":      { "wakeWord": "jarvis", "lang": "en-US", "speak": true, "voiceURI": "", "rate": 1, "pitch": 0.9, "volume": 1, "theme": "mars" },
  "conversations": [{ "id": "", "user": "", "reply": "", "source": "voice|text|ptt", "ts": "" }]
}
```

Memory API (`js/memory.js`): `load()`, `save()`, `edit(col, id, patch)`, `remove(col, id)`, plus `add`, `restore`, `replace`.
Changes autosave about 1.5 seconds after your last edit. The **Memory** page lets you inspect, edit raw JSON, delete, export and force-save.

## Project layout

```
index.html          page structure
css/styles.css      glassmorphism + HUD styling
js/config.js        namespace, event bus, helpers
js/drive.js         Google Sign-In + Drive REST calls
js/memory.js        jarvis-data.json store (load/save/edit/delete)
js/notes.js         notes system
js/tasks.js         task system
js/voice.js         speech recognition, wake word, push-to-talk, speech synthesis
js/commands.js      command interpreter (add new commands here)
js/ui.js            navigation, rendering, HUD orb, dialogs
js/app.js           wiring
```

To add a command, append a rule `{ re: /…/i, mem: true, run(match) { … return 'reply'; } }` to `RULES` in `js/commands.js`.
This is the intended extension point for Phase 2 intelligence modules.

## Known limits (Phase 1)

- **Voice input needs Chrome, Edge or Safari.** Firefox has no speech recognition; typed commands and spoken replies still work.
- Chrome's recognizer sends audio to Google's speech service, so it needs an internet connection.
- **The microphone only works while this tab is open.** Browsers do not allow a web page to listen in the background.
- Browsers block speech output until you click or press a key on the page once. A banner tells you when that is needed.
- The Google sign-in token lasts about an hour. After that, Mars Jarvis shows **Reconnect**; one click renews it. Unsaved changes are kept in memory and saved right after you reconnect.
- One device at a time: if two browsers edit at once, the last save wins.
- Commands are pattern-based (no AI language model yet). Natural-language understanding is a later phase.
