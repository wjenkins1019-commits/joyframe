# JOYFRAME

**Every Game. One Universe.**

JOYFRAME is a desktop gaming launcher and entertainment frontend: a Netflix-style library for everything you own —
Steam titles, installed PC games, emulated ROM collections and manual entries — with real scanning, launching,
playtime tracking, artwork caching and a controller-first Console Mode.

Built as an Electron + React + TypeScript application with a local SQLite database and modular main-process services.

---

## Quick start

```bash
npm install
npm run dev      # Vite + Electron with hot reload
```

Electron 45 no longer downloads its binary from a package install script, so installs that skip
lifecycle scripts (`npm ci --ignore-scripts`, some CI images and npm 11 install-script policies)
leave `node_modules/electron/dist` empty and `npm run verify:pad` fails on `electron.exe ENOENT`.
This project's `postinstall` runs Electron's installer for you; if you skipped scripts, run
`npx install-electron` once before `npm run dev`.

Production build and run:

```bash
npm run build
npm start
```

Package a Windows installer (requires electron-builder download access):

```bash
npm run dist
```

Backend smoke test (real fixtures, real process launch, no network):

```bash
npm run smoke
```

---

## What is implemented

### Brand & interface

- Original geometric **J + play** emblem as a vector logo, wordmark, monochrome lockup, application icon, splash/loading
  artwork and PNG/ICO exports (`resources/`, generated with `npm run icons`).
- Red / white / charcoal dark theme (`#D71935`, `#A90F27`, `#15171B`, `#202329`, `#292D34`, `#A5A9B2`) with an accent
  colour setting applied through CSS custom properties.
- Smoked-glass look: a lit, grainy backdrop stage under translucent panels, poster mounts with accent glow and a lit
  rule on every row heading — editorial rather than flat dark-mode grey.
- A full-screen Console Mode hand-off: glass wipe, expanding accent halo and a short focus-in on the console shell,
  skipped automatically when Reduce motion is on.
- Custom draggable window chrome with native Windows controls, sidebar navigation and global search.

### Dashboard

- Cinematic featured hero with automatic rotation, logo/title treatment, metadata chips and Play / Resume / Trailer.
- Nineteen built-in rows (Continue Playing, Recently Played, Recently Added, Most Played, Favorites, Trending,
  Retro Classics, Steam, Nintendo, PlayStation, Xbox, Arcade, RPG, Action, Racing, Fighting, Hidden Gems,
  Never Played, Recently Completed), all populated from the database.
- Rows can be hidden, renamed, reordered, limited and reset, and custom collections can become rows.
- Hover shows a card trailer after the configured delay (muted by default) and crossfades the app backdrop.
- Full-screen trailer playback with volume controls and YouTube embed support.

### Universal library

- One library across Steam, PC folder scans, ROM scans and manual entries.
- Search by title, developer, publisher, genre, platform, year; filters for platform, genre, source, install state,
  played state and favorites; six sort modes with direction.
- Favorites, hidden games, per-game completion status, personal notes, playtime, last played, install state.
- Duplicate detection on title + platform + install folder; manual merge (keeps artwork, launch methods and sessions).
- Multiple launch methods per game with a default selector.
- Manual game entry and full editing, custom cover/background/logo/screenshot import (copied into the artwork cache).

### Steam

- Locates Steam through the Windows registry (`SteamPath`) or a configured folder.
- Parses `libraryfolders.vdf` and every `appmanifest_*.acf` across library folders.
- Detects installed vs uninstalled apps, reads local playtime and last-played from `userdata/<id>/config/localconfig.vdf`.
- Imports CDN cover/hero/logo art, refreshes metadata from the public Steam Store API (descriptions, developers,
  publishers, genres, release date, Metacritic score, screenshots, MP4/WebM trailers) with artwork either streamed
  from the CDN or cached locally, depending on the artwork storage setting.
- Launches with `steam://rungameid/<appid>`; Steam keeps handling authentication, DRM and updates.

### Emulation

- Detects 30+ emulators in common install locations and maps each to its platforms, core folder, argument template
  and save-state folder.
- RetroArch core mapping per platform, `{rom}` / `{core}` / `{game}` / `{dir}` / `{stateSlot}` placeholders.
- ROM scanning with extension mapping, folder-name hints for ambiguous `.iso`/`.chd`/`.cue`, CUE/BIN grouping,
  BIOS/firmware exclusion, duplicate protection and automatic emulator assignment.
- One file per game: when a title exists in several formats in the same folder only the preferred one imports —
  Switch keeps `.xci` → `.nsp` → `.nsz`, PS2 keeps `.chd` → `.iso`, disc sets keep `.m3u`/`.cue` over `.bin`,
  archives sort last. The scan reports how many duplicate formats it skipped.
- Configuration validation checks the executable, core file and placeholders without launching a game.
- Per-game emulator, core, arguments, controller profile, resolution, display mode and save-state preferences.

### Saves, resume and playtime

- Universal resume: last played game drives the hero Resume button and the Continue Playing row.
- Session tracking for spawned processes; Steam protocol launches are attributed by watching for a process inside the
  install folder (best effort, clearly reported).
- Playtime, play count and last played persist to SQLite; manual playtime entry for anything untracked.
- Save-state indexing for RetroArch, Dolphin, PCSX2, PPSSPP and sidecar emulator files, with timestamps, slots and
  sizes. JOYFRAME is strictly read-only with save files and never overwrites them.
- Honest safety notes in the UI about emulator-specific state compatibility.

### Controller, Console Mode and statistics

- Gamepad polling (Xbox/PlayStation/XInput-compatible) with geometry-based spatial navigation over every interactive
  element, so the whole app works without a mouse.
- Hotkeys: D-pad/stick navigate, A select, B back, Y favorite, LB/RB switch sections, Start toggles Console Mode.
- Controller prompts adapt to the detected pad; connection notifications.
- Console Mode: full-screen dashboard, large cards, on-screen keyboard search, clock, quick shelves, controller hints
  and optional launch-on-startup.
- Statistics: totals, stored playtime, favorites, completion mix, 30-day activity chart, most played, recently played,
  platform and genre breakdowns, source distribution and monthly additions.

### Data, reliability and security

- SQLite (Node's built-in `node:sqlite`, no native compilation) with WAL and a migration-safe schema.
- Automatic consistent startup backups through SQLite's backup API, manual backups and restore with a pre-restore
  safety copy + relaunch.
- Artwork is streamed from the provider by default (nothing stored) or cached on disk and served through the
  `jf-art://` protocol for offline browsing — switchable in Settings → Metadata & artwork.
- All startup data loaded from SQLite; internet is only required for fresh metadata, trailers and remote artwork.
- `contextIsolation`, sandboxed renderer, no Node in the renderer, a strict CSP and a narrow preload bridge.
- Launch validation: only http(s)/Steam/mail protocols are opened; missing executables and cores are reported instead of
  being executed.
- Modular services: `db`, `repo`, `scanner`, `steam`, `emulators`, `launcher`, `metadata`, `artwork`, `saves`,
  `library`, `backup`, `settings` — each replaceable without touching the UI. Extending platforms is a data change in
  `src/main/services/platforms.ts`.

---

## Architecture

```
src/
  main/
    index.ts            Electron bootstrap, window, jf-art protocol, backups
    ipc.ts              Typed IPC surface (library, scans, Steam, launch, metadata, saves, settings, system)
    services/           Independent backend services (see list above)
  preload/index.ts      contextBridge API — the only main/renderer contact
  renderer/             React 19 + Tailwind v4 UI
    components/         Shell, hero, rows, cards, detail, editors, console mode
    state/store.ts      Zustand store + IPC orchestration
    lib/navigation.ts   Controller/keyboard spatial navigation
  shared/types.ts       Shared contracts
resources/              Logo, icon, wordmark, splash (SVG + generated PNG/ICO)
scripts/                gen-icons.mjs, smoke.ts
```

Data lives in Electron's `userData` folder (`%APPDATA%/JOYFRAME` on Windows):

- `joyframe.db` — library, collections, settings, sessions, saves index
- `artwork/` — cached covers, hero art, logos, screenshots
- `backups/` — automatic and manual database backups
- `logs/joyframe.log` — startup failures, renderer crashes and uncaught errors

---

## Verification performed

`npm run smoke` executes **27 checks against the real services** and passes:

- PC folder scan importing one game per folder, filtering installers/redistributables/crash handlers, choosing the
  executable that matches the folder, and skipping duplicates on rescan.
- ROM scan detecting NES/SNES/GBA/PS2/PS1 from extensions and folder hints, grouping CUE/BIN, ignoring BIOS files and
  non-ROM files, remaining idempotent across rescans.
- Emulator configuration validation (valid core, missing core) and `{rom}`/`{core}` substitution in the launch command.
- VDF parsing, Steam detection via a synthetic library, manifest import with installed state and 120 minutes of local
  playtime, plus uninstalled apps.
- Collections, favorites/completion rows, home sections, search/filters, statistics.
- Save-state indexing with real timestamps.
- A **real launch** of a spawned process through the launcher, returning to idle and persisting playtime, play count
  and last played.
- Settings persistence, provider status, consistent SQLite backups, and data surviving a database reopen.
- A **1.0.0 profile upgrade**: `scripts/fixtures/schema-1.0.0.sql` is the exact schema the shipped build created,
  a database is built from it and filled like a used library, then opened with the current code — the library,
  launch methods, saves, collections, home rows and settings all load, and every column the current schema expects is
  present. Adding a column to `db.ts` without a migration fails this check.

The packaged `release/win-unpacked/JOYFRAME.exe` was also booted in throwaway `--user-data-dir` profiles, and this is
repeatable: `npm run verify:dist` seeds two disposable profiles, boots the packaged app on each, and checks what
renders — the 15-game demo library (home rows, hero, decoded artwork, Console Mode shelves) and a **1.0.0 profile**
built from `scripts/fixtures/schema-1.0.0.sql` (home rows plus the Library view, with the old hidden game still
hidden). It fails on any renderer console error and removes both profiles afterwards. `npm run verify:dist-pad`
runs the virtual-gamepad suite against the same packaged exe on a seeded demo profile, covering controller navigation,
Console Mode and modal back-stack behaviour in the shipped build rather than only dev Electron. Both packaged checks
refuse to run when `out/` is newer than `release/win-unpacked/resources/app.asar`, so run `npm run dist` after rebuilding.
`npm run verify:first-run` complements them: it boots the packaged exe on a **clean** throwaway profile and checks the
first-run experience — the welcome screen, zero home cards/rows, an empty Library view, zero games/collections/
emulators/scan paths through the preload API, and a newly created database with no library rows (platforms and
settings only, empty artwork and backups). It passes `--user-data-dir` to a workspace-local profile, refuses to run
if that path ever resolves inside the real `%APPDATA%/JOYFRAME`, and asserts the real `joyframe.db` size and mtime are
unchanged before reporting success. A DOM probe over the remote debugging port found 142 focusable navigation elements, 107 game cards and
17 populated dashboard rows (Continue Playing through Recently Completed), with the hero fully rendered (Chrono Trigger,
1995, Super Nintendo) and its artwork — plus the first shelf's cards — decoded through the packaged `jf-art://` handler.
No renderer console errors or warnings were emitted.

The interface was **not** clicked through manually and no visual/screenshot review was performed, so layout polish and
every interaction path remain unverified by eye.

The Windows installer now builds, installs and launches: `npm run dist` produced
`release/JOYFRAME Setup 1.0.0.exe`, which installed silently into a clean folder, opened from the installed copy
(Home view, 14 navigable controls) and uninstalled cleanly. The installer is unsigned — no code-signing certificate is
configured — so Windows SmartScreen warns on first run.

The Windows icon (`resources/icon.ico`) is assembled from unique sizes of 256px and below: NSIS rejects duplicate or
oversized ICO entries, so the 512px render is used only where a plain PNG is accepted (macOS, Linux, in-app artwork).

Still not verified in this environment: live Steam artwork/downloads (requires network), IGDB responses (requires
credentials), launching a real Steam title, a real emulator/ROM, a physical controller and Console Mode on a TV.

---

## Deliberate limitations

- **No game content is bundled.** ROMs, BIOS/firmware, ISOs and Steam games must be provided by the user.
- **Steam** integration reads local files only. JOYFRAME does not implement Steam login, purchasing or DRM, and cannot
  track playtime for games launched outside JOYFRAME beyond the imported snapshot.
- **Save states** are indexed and displayed; resuming directly from a state depends on the emulator's documented CLI.
  JOYFRAME never assumes this works and never rewrites saves.
- **Metadata providers:** Steam Store (keyless) and IGDB (Twitch client ID/secret in Settings) are implemented.
  ScreenScraper requires developer credentials issued by that project and is listed but not enabled. Manual artwork
  import always works and is cached locally.
- **Platform support** depends on emulator availability and the user's firmware; Switch/PS3/PS2/etc. are not shipped
  with anything.
- **Themes** offer a dark UI with accent colours (no light theme), by design.
- Controller support uses the browser Gamepad API; unusual DirectInput-only pads may appear as generic devices.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Electron + Vite with hot reload |
| `npm run build` | Production bundles in `out/` |
| `npm start` | Run the production build |
| `npm run typecheck` | TypeScript checks for main and renderer |
| `npm run smoke` | Backend integration smoke test |
| `npm run verify:pad` | Drive the controller suite in dev Electron with a virtual pad |
| `npm run verify:dist` | Boot the packaged build against seeded demo and 1.0.0 profiles; check Home, Console Mode and the upgraded library |
| `npm run verify:dist-pad` | Run the controller suite against the packaged build on a seeded demo profile |
| `npm run verify:first-run` | Boot the packaged build on a throwaway empty profile; check the welcome screen, empty library and fresh database |
| `npm run verify:freshness` | Exercise the packaged-build staleness guard with fixture files, without touching `release/` |
| `npm run icons` | Regenerate PNG/ICO brand assets from SVG |
| `npm run dist` | Build a Windows NSIS installer |
