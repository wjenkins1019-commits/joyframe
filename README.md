# JOYFRAME

**Every Game. One Universe.**

JOYFRAME is a desktop gaming launcher and entertainment frontend: a Netflix-style library for everything you own —
Steam titles, installed PC games, emulated ROM collections and manual entries — with real scanning, launching,
playtime tracking, artwork caching and a controller-first Console Mode.

Built as an Electron + React + TypeScript application with a local SQLite database and modular main-process services.

---

## Download and install (Windows)

**[Download the latest JOYFRAME installer](https://github.com/wjenkins1019-commits/joyframe/releases/latest)** — look for the
`JOYFRAME.Setup.*.exe` asset under **Assets**; the filename includes the version.

1. Download the `.exe` and run it.
2. Choose an install folder (the default is fine) and finish the wizard.
3. Launch **JOYFRAME** from the Start menu or the desktop shortcut.

Windows 10/11 (x64). No account and no internet connection are needed to open the app; an internet connection is only
used for metadata, trailers and remote artwork.

The installer is unsigned, so Windows SmartScreen may warn on first run. Choose **More info → Run anyway** if you trust
the download. JOYFRAME does not bundle games, ROMs, BIOS files or emulators — point it at the games you already own.

---

## Quick start

Requires **Node 26**: the services import `node:sqlite` and the probes use the built-in `WebSocket`, both of
which fail mid-run on an older Node. `package.json` declares it in `engines`, `.nvmrc` pins it for version
managers, and `.npmrc` sets `engine-strict=true` — so an install on the wrong version stops with `EBADENGINE`
and the required range instead of failing later inside a test.

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
- Titles added manually or through a folder scan (GOG, Epic, itch) are matched to an App ID through Steam's keyless
  store search when the title is close enough, so the same Store metadata and artwork fills them; the resolution is
  remembered per game so later refreshes skip the lookup.

### Emulation

- Detects 30+ emulators in common install locations and maps each to its platforms, core folder, argument template
  and save-state folder.
- RetroArch core mapping per platform, `{rom}` / `{core}` / `{game}` / `{dir}` / `{stateSlot}` placeholders. When a game's
  arguments never mention `{rom}` the ROM is appended anyway, so the emulator opens the game rather than an empty window;
  each game can switch that off with “Launch the ROM directly”, and Settings → Emulation sets the default for every game.
- ROM scanning with extension mapping, folder-name hints for ambiguous `.iso`/`.chd`/`.cue`, CUE/BIN grouping,
  BIOS/firmware exclusion, duplicate protection and automatic emulator assignment. Every extension a platform
  advertises is importable — including bare `.rom` Jaguar dumps — and a smoke check keeps the platform catalogue and
  the scanner's filter from drifting apart (only DOSBox `.conf`/`.bat` launch files are deliberately excluded).
- One file per game: when a title exists in several formats in the same folder only the preferred one imports.
  A folder named after its game (ROM plus update/DLC/track sidecars) imports once — the disc sheet when there is
  one, otherwise the largest file. A multi-disc set (`(Disc 1)`, `(Disc 2)` … in the same folder) is one library
  entry with a launch method per disc, so cover, playtime and metadata are shared; re-scanning a library that was
  imported one-card-per-disc folds the discs into the first entry instead of duplicating it.
  Before the first such fold, the scan saves a `pre-merge` database backup, so a mis-grouped set can be restored
  from Settings → Data, backups & recovery; if the backup itself fails the scan stops before changing anything.
  Rescanning folds stale sidecar entries from older scans into the surviving game, keeping playtime and metadata.
  A ROM that is no longer on disk is marked **ROM missing** (never deleted — playtime, metadata and notes stay) and its
  launch is refused with the path, while a file that returns clears the mark on the next scan.
- Fullscreen launch presets: emulators with a verified fullscreen switch (RetroArch, PCSX2, DuckStation, PPSSPP, mGBA,
  Snes9x, Ryujinx, Eden, Cemu, MAME, DOSBox-X, Stella, ares, BizHawk, Mednafen, xemu, Dolphin, melonDS, Kega Fusion,
  Xenia and more) open straight into the
  game. Companion flags are included where the emulator demands them (RPCS3 needs `--no-gui`). Each emulator has a
  per-entry switch in Settings → Emulators, and an emulator without a verified flag launches unchanged rather than
  risking an unknown argument. Any emulator can set its own fullscreen arguments instead; a non-empty custom field
  replaces the built-in preset, and clearing it falls back to the preset.
  Each platform's order is editable in Settings → Library & scanning → ROM format preference (defaults: Switch
  `.xci` → `.nsp` → `.nsz`, PS2 `.chd` → `.iso`, disc sets keep `.m3u`/`.cue` over `.bin`, archives sort last).
  The scan reports how many duplicate formats it skipped.
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

`npm run smoke` executes **47 checks against the real services** and passes:

- PC folder scan importing one game per folder, filtering installers/redistributables/crash handlers, choosing the
  executable that matches the folder, and skipping duplicates on rescan.
- ROM scan detecting NES/SNES/GBA/PS2/PS1 from extensions and folder hints, grouping CUE/BIN, ignoring BIOS files and
  non-ROM files, remaining idempotent across rescans.
- Emulator configuration validation (valid core, missing core), `{rom}`/`{core}` substitution, and the ROM being
  appended when a template omits it (with the per-game opt-out) — proven at runtime by a stub emulator that records
  the argument list it is actually launched with.
- VDF parsing, Steam detection via a synthetic library, manifest import with installed state and 120 minutes of local
  playtime, plus uninstalled apps.
- Collections, favorites/completion rows, home sections, search/filters, statistics.
- Save-state indexing with real timestamps.
- A **real launch** of a spawned process through the launcher, returning to idle and persisting playtime, play count
  and last played.
- Settings persistence, provider status, consistent SQLite backups, and data surviving a database reopen.
- Refresh-summary wording for every outcome (combined failure sentences, a plain no-match staying informational, an
  error outranking it, and nothing attempted), checked purely offline against `describeRefresh`.
- A **real bulk refresh** on its own Steam-only profile: a three-request allowance processes three games, stops, and
  the toast reads `Updated 0 of 3 games. 3 used up this run's request budget — refresh again later. 2 skipped after
  the budget ran out.` — so the skipped count comes from the run, not a hand-built summary.
- A **1.0.0 profile upgrade**: `scripts/fixtures/schema-1.0.0.sql` is the exact schema the shipped build created,
  a database is built from it and filled like a used library, then opened with the current code — the library,
  launch methods, saves, collections, home rows and settings all load, and every column the current schema expects is
  present. Adding a column to `db.ts` without a migration fails this check.

The packaged `release/win-unpacked/JOYFRAME.exe` was also booted in throwaway `--user-data-dir` profiles, and this is
repeatable: `npm run verify:dist` seeds five disposable profiles, boots the packaged app on each, and checks what
renders — the 15-game demo library (home rows, hero, decoded artwork, Console Mode shelves), a **1.0.0 profile**
built from `scripts/fixtures/schema-1.0.0.sql` (home rows plus the Library view, with the old hidden game still
hidden), a **ROM-launch profile** whose stub emulator records the argv it receives before and after the per-game
switch is saved off, a **multi-disc profile** where one two-disc set must arrive as a single card with a Disc row per
disc and switching the default disc must change the argv the stub receives, and a **recovery profile** that starts
from the per-disc shape an older build wrote (`scripts/seed-multidisc.ts --legacy`), so the packaged rescan has to
fold it and snapshot the library (`pre-merge`) first; it then checks all three `(default disc missing)` fallbacks by
the message the user sees and restores that snapshot through the app's own restore path, which relaunches it. It
fails on any renderer console error and removes all five profiles afterwards. `npm run verify:dist-pad`
runs the virtual-gamepad suite against the same packaged exe on a seeded demo profile, covering controller navigation,
Console Mode and modal back-stack behaviour in the shipped build rather than only dev Electron. Both packaged checks
compare the contents of `release/win-unpacked/resources/app.asar` with the current `out/` by SHA-256 and refuse to run
when they differ — a rebuild that produces identical bytes (a test-only change) leaves the package valid, while any
real difference still asks for `npm run dist`. `npm run check` ends by reporting that comparison, so a stale package
is stated rather than discovered later.
`npm run verify:first-run` complements them: it boots the packaged exe on a **clean** throwaway profile and checks the
first-run experience — the welcome screen, zero home cards/rows, an empty Library view, zero games/collections/
emulators/scan paths through the preload API, and a newly created database with no library rows (platforms and
settings only, empty artwork and backups). It passes `--user-data-dir` to a workspace-local profile, refuses to run
if that path ever resolves inside the real `%APPDATA%/JOYFRAME`, and asserts the real `joyframe.db` size and mtime are
unchanged before reporting success.

The startup ident has its own repeatable coverage, and `npm run check` now runs it after the pad suite:
`npm run verify:intro` proves it auto-advances untouched, is dismissed by a key press, a click or a controller button
without activating the screen underneath, never paints in `off`, and plays exactly once in `first-run`;
`npm run verify:intro-ui` drives the real Settings dropdown through `always → off → first-run → always`, restarting
the app each time to prove the choice persists and the next launch follows it; and `npm run verify:intro-pad` does
the same reach-and-step by controller only — CI's controller job runs it right after the pad suite, since a pad has no
keyboard equivalent. The welcome name step has its own packaged check,
`npm run verify:intro-name-pad`: it boots `release/win-unpacked` with an empty name and a virtual pad, proves a pad
button moves from the name step to the ident, and proves real key events still edit the name instead of skipping it.
CI's installer job runs `verify:intro-ui` against `release/win-unpacked` as well (`JOYFRAME_EXE` is what points it at
the package instead of dev Electron), so the dropdown's persistence is proven on the shipped payload too.
`npm run verify:installed` repeats the ident, skip and `off` checks
against the machine-wide copy in `C:\Program Files\JOYFRAME` (point `JOYFRAME_EXE` elsewhere to override), which is
the only check that looks at the installed payload rather than `release/win-unpacked`. It first runs
`npm run verify:installed-build`, which compares the SHA-256 of the installed `resources/app.asar` with the one in
`release/win-unpacked` and fails on any difference — a stale or partial install that the packaged checks cannot see.
Every run prints `spawn->window`, `window->bridge` and `bridge->intro` milliseconds, so a slow cold start shows up as
numbers instead of a vague timeout, and every gate spends one 30 s budget measured from launch rather than restarting
it — a launch that misses the deadline is reported as slower than it, not as a renderer that never appeared. Set
`JOYFRAME_BOOT_TIMEOUT_MS` lower to exercise that deadline without waiting; it only tightens the 30 s default.
CI now runs that probe instead of leaving it to a release machine: the installer job uploads the package it built and a
separate `installed-checks` job installs it silently (`/allusers /S`) and runs `npm run verify:installed`, so a green
run cannot sit next to an installer nobody installed.
`npm run check:installed` runs `npm run check` and then `verify:installed-build` in one go, and is the final step
after a release: rebuild, install, then that command, so the shipped copy is proven to be the verified build and not
something from an earlier run.

Metadata failures can also be forced in a running build: launch it with `JOYFRAME_FAULT_METADATA=401` (rejected
credentials), `429` (rate limit), `500` (server error) or any 4xx/5xx, and every provider request fails with that status
before reaching the network. `JOYFRAME_FAULT_METADATA=budget` instead spends one request per provider and then reports a
spent budget, so a refresh stops mid-run with skipped games left over. Either way the corresponding toast is
reproducible on demand: the variable is read per request and inert when unset or unrecognised, and smoke covers it as
the test-only hook it is.

A DOM probe over the remote debugging port found 142 focusable navigation elements, 107 game cards and
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
- **Metadata providers:** Steam Store (keyless), RAWG (free API key in Settings) and IGDB (Twitch client ID/secret in
  Settings) are implemented. RAWG supplies descriptions, genres, companies, release dates, cover art and screenshots for
  non-Steam games, with the "Data and images by RAWG" attribution its terms require shown in Settings and on game pages.
  ScreenScraper requires developer credentials issued by that project and is listed but not enabled. Manual artwork
  import always works and is cached locally.
- **Platform support** depends on emulator availability and the user's firmware; Switch/PS3/PS2/etc. are not shipped
  with anything.
- **Themes** offer five built-in dark palettes (Crimson, Midnight, Violet, Forest, Mono) plus a custom accent colour;
  there is no light theme, by design.
- Controller support uses the browser Gamepad API; unusual DirectInput-only pads may appear as generic devices.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Electron + Vite with hot reload |
| `npm run build` | Production bundles in `out/`, stamped with the hashes of its inputs — `src/`, `electron.vite.config.ts`, `tsconfig.node.json`, `tsconfig.web.json`, `package.json`, `package-lock.json` and `resources/` (`.build-stamp.json`) |
| `npm start` | Run the production build |
| `npm run typecheck` | TypeScript checks for main and renderer |
| `npm run smoke` | Backend integration smoke test |
| `npm run verify:pad` | Drive the controller suite in dev Electron with a virtual pad |
| `npm run verify:dist` | Boot the packaged build against seeded demo, 1.0.0, ROM-launch, multi-disc and multi-disc recovery profiles; check Home, Console Mode, the upgraded library, the ROM switch, Disc rows and default-disc switching, the fold's `pre-merge` snapshot and the restore path, and every `(default disc missing)` message through a stub emulator |
| `npm run verify:dist-pad` | Run the controller suite against the packaged build on a seeded demo profile |
| `npm run verify:packaged` | All four packaged probes in one run, in order: `verify:dist`, `verify:dist-pad`, `verify:first-run`, `verify:intro-ui` (about 105 s) |
| `npm run verify:first-run` | Boot the packaged build on a throwaway empty profile; check the welcome screen, empty library and fresh database |
| `npm run verify:freshness` | Exercise the packaged-build content guard with real fixture archives, without touching `release/` |
| `npm run verify:intro` | Boot dev Electron on a throwaway profile: auto-advance, key/click/controller skip, `off`, and a seen `first-run`; then the plays-once first-run probe |
| `npm run verify:intro-ui` | Cycle the Startup intro dropdown through every mode with real clicks and keys, restarting after each and checking disk plus launch behaviour |
| `npm run verify:intro-pad` | Reach and step the Startup intro dropdown with the pad alone, then restart to prove the choice persisted |
| `npm run verify:intro-name-pad` | Boot the packaged app with an empty name and a virtual pad: the name step appears, a pad button advances to the ident, and real typing edits the name instead of skipping |
| `npm run verify:installed-build` | Fail when `C:\Program Files\JOYFRAME` is not byte-for-byte the build in `release/win-unpacked` |
| `npm run verify:installed` | Check that integrity, then drive the machine-wide copy (`JOYFRAME_EXE` overrides the exe): ident, skip without click-through, `off` |
| `npm run verify:signing` | Prove the Azure signing path is either ready or cleanly unsigned: name any missing secrets, validate the endpoint shape, and check the enabler emits timestamped `azureSignOptions`; a half-set secret set fails. Runs in CI's no-gui checks on every push (~1 s) |
| `npm run self-test` | Prove the suite's own guards still fail correctly: short check list, exit `2` on a missing prerequisite and on a busy port, unfinished-run reporting, stale package |
| `npm run check` | Typecheck, guard self-test, smoke, freshness guard, pad suite, all three intro suites, then report whether `release/` still matches |
| `npm run check:installed` | `npm run check`, then fail unless the installed copy matches `release/win-unpacked` |
| `npm run certify` | Certify the shipped artifact: `check`, build, `dist`, the packaged probes (including `verify:intro-ui` against `release/win-unpacked`), `verify:dist-pad`, then `verify:installed-build`; prints `CERTIFIED` with the bundle's SHA-256 only when every stage passed |
| `npm run icons` | Regenerate PNG/ICO brand assets from SVG — they are build inputs, so follow it with `npm run build` before any probe runs: `npm run icons && npm run build` |
| `npm run verify:icons` | Fail when a committed PNG/ICO no longer matches the SVG it is rendered from, naming the file and the source; `npm run dist` runs it first through `predist` |
| `npm run verify:installer` | Run after `npm run dist`: fail when the installer is missing or electron-builder packaged its default icon instead of `resources/icon.ico`, and confirm the icon resources are inside `app.asar` |
| `npm run dist` | Build a Windows NSIS installer (never publishes: `--publish never`) |

Each probe boots a real app, so it captures that app's own stdout/stderr in `.verify-logs/<probe>.log` and prints the log
tail when a run fails. Before booting, a probe also checks the binary it drives and its debugging port: a missing build,
a missing Electron binary or a port a leftover instance still holds exits with code `2` and the fix, so exit `1` always
means the app regressed. Probes that read `out/` also hold it to its build stamp: if `src/`, `electron.vite.config.ts`,
a tsconfig (`tsconfig.node.json`, `tsconfig.web.json`), `resources/` or a dependency manifest (`package.json`,
`package-lock.json`) has changed since the build, or the stamp is missing because something other than `npm run build`
produced `out/`, they exit `2` naming the files and the rebuild rather than testing a bundle that predates the edit.

`npm run check` covers the dev build only, so it can be green while the installer is stale — it reports that comparison
without failing on it. `npm run certify` is the release signal: it runs `check`, then builds, packages, boots the
packaged app for both its probe sets and the controller suite, and finishes by proving `C:\Program Files\JOYFRAME` is
byte-for-byte `release/win-unpacked`. It stops at the first failing stage and prints `CERTIFIED`, the bundle SHA-256 and
which installer it covers only when the whole chain passed, so a green certificate cannot coexist with an installer
nobody tested.

---

## License

JOYFRAME is released under the [MIT License](LICENSE), copyright © 2026 965 Media.
