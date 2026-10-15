<div align="center">

<img src="assets/icon.png" alt="FocusLine" width="88" />

# FocusLine

**Plan your day, stay focused, capture what you learn, and share ideas with friends.**

A Windows desktop app that brings a calendar-based task list, a Pomodoro timer, project notes, shared idea spaces and workout tracking together in one place.

![Platform](https://img.shields.io/badge/platform-Windows-6c5ce7)
![Electron](https://img.shields.io/badge/Electron-33-47848f?logo=electron&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-ffca28?logo=firebase&logoColor=black)
![Language](https://img.shields.io/badge/UI-Turkish-e05561)
![License](https://img.shields.io/badge/license-MIT-2ea36c)

<img src="docs/screenshots/gorevler.png" alt="FocusLine tasks screen" width="860" />

</div>

> **Note:** The app's user interface is in Turkish.

---

## Features

### 📋 Tasks & calendar
- Day-by-day task list with a weekly strip and a monthly calendar (with ISO week numbers)
- Optional start/end times; the task happening right now is highlighted
- Days with tasks or workouts are marked with dots on the calendar
- See the selected day's focus time and workouts at a glance

### ⏱️ Focus (Pomodoro)
- Pomodoro, short break, long break and an open-ended **free session** mode
- Pause → resume keeps adding to the same session until you finish it
- Daily goal, weekly hours chart and session history
- The timer keeps running in the system tray when the window is closed

### 📚 Notes
- Projects → topics → plain-text notes, like writing in a text file
- Autosave while typing, search within a project, word/character counter
- `Tab` for indentation, `Ctrl+S` to save instantly

### 💡 Ideas
- **Personal** ideas stay on your computer only
- **Shared spaces**: email + password sign-in, email invitations, real-time sync
  - Only the author can edit an idea; everyone can add notes to it
  - Only the author or the space owner can delete an idea
  - The member list shows who is online and everyone's focus time for today

### 🏃 Workouts
- Log workouts (activity, duration, note) with a weekly minutes chart and history

### 🌗 And more
- Light / dark theme with a circular reveal transition
- System tray, Windows notifications, single window, undo for deletions

## Screenshots

| Focus | Notes |
| :---: | :---: |
| <img src="docs/screenshots/odak.png" alt="Focus screen" /> | <img src="docs/screenshots/bilgiler.png" alt="Notes screen" /> |
| **Shared ideas** | **Dark theme** |
| <img src="docs/screenshots/ortak-fikirler.png" alt="Shared ideas screen" /> | <img src="docs/screenshots/karanlik-tema.png" alt="Dark theme" /> |

<details>
<summary>Workouts screen</summary>

<img src="docs/screenshots/spor.png" alt="Workouts screen" width="760" />

</details>

## Keyboard shortcuts

| Shortcut | Where | What it does |
| --- | --- | --- |
| `Ctrl+N` | Every tab | New item (task, idea, workout, topic) |
| `Space` | Focus | Start / pause the timer |
| `Ctrl+S` | Notes | Save the note immediately |
| `Tab` | Notes | Insert indentation |
| `Esc` | Forms | Cancel editing |

## Development

Requirements: [Node.js](https://nodejs.org) 20 or later, Windows.

```bash
git clone https://github.com/Yavuzgmus/focusline.git
cd focusline
npm install
npm start
```

### Building the installer

```bash
npm run dist
```

Two files are created in `dist/`:

| File | Description |
| --- | --- |
| `FocusLine-Kurulum-<version>.exe` | Standard installer (recommended) |
| `FocusLine-Tasinabilir-<version>.exe` | Portable, runs without installation |

Bump `version` in `package.json` before each release. Do not change `build.appId`: Windows uses it to recognize that a new installer replaces the previous installation.

## Project structure

```
src/
├── main.js                Main process: window, system tray, file storage, theme
├── preload.js             Secure bridge between the main process and the UI
├── renderer/
│   ├── index.html         UI markup
│   ├── styles.css         Styles (light and dark theme)
│   └── renderer.js        Application logic
└── shared/
    ├── shared.js          Shared spaces: Firebase sign-in + Firestore sync
    └── firebase-config.js Firebase project settings
assets/                    App icon
docs/screenshots/          README images
firestore.rules            Firestore security rules
```

`src/shared/shared.js` is bundled with [esbuild](https://esbuild.github.io) into `src/renderer/shared.bundle.js`. That file is generated automatically by `npm start` / `npm run dist` and is not committed.

## Tech stack

- [Electron](https://www.electronjs.org): desktop application framework
- Plain HTML, CSS and JavaScript (no UI framework)
- [Firebase Authentication](https://firebase.google.com/docs/auth) and [Cloud Firestore](https://firebase.google.com/docs/firestore): shared spaces
- [electron-builder](https://www.electron.build): Windows installer
- [Outfit](https://fonts.google.com/specimen/Outfit) typeface (bundled locally)

## Data & privacy

- **Stored on your computer:** tasks, focus sessions, workouts, personal ideas and notes. Location: `%APPDATA%\todo-uygulama\data.json`
- **Stored in Firebase:** only shared spaces (shared ideas, notes on them, member list, invitations) and, if you choose to share it, your focus time for today.
- Access rules are enforced server-side by [`firestore.rules`](firestore.rules): only invited users with a verified email address can join a space.

## Running with your own Firebase project

1. Create a new project in the [Firebase console](https://console.firebase.google.com).
2. Under **Authentication → Sign-in method**, enable the *Email/Password* provider.
3. Create a **Firestore Database**, paste the contents of `firestore.rules` into the **Rules** tab and publish.
4. Under **Project settings → Your apps → Web**, add a web app and copy its configuration into `src/shared/firebase-config.js`.

> Firebase web configuration values are not secrets; access is controlled by the security rules.

## License

[MIT](LICENSE) © Yavuz Gümüş
