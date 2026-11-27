import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, Game, LaunchNotice, LaunchResult, PlayState } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { coreForPlatform } from './emulators.ts'
import { fullscreenArgsFor } from './fullscreen-presets.ts'
import { finishGamePlaytime } from './library.ts'
import { killTree, listProcesses } from './processes.ts'
import { getGame, rowToEmulator, uid } from './repo.ts'
import {
  abortSession,
  finishSession,
  sameProcessPath,
  startSession,
  updateSessionProcess,
  type OpenSession
} from './sessions.ts'

export interface LaunchHooks {
  emit(state: PlayState): void
  openExternal(url: string): Promise<void>
  settings(): AppSettings
}

/** How often a protocol launch is checked for its game process. */
const OBSERVE_INTERVAL_MS = 2_500
/** Checks before a protocol launch gives up: 8 x 2.5s = a 20 second window. */
const OBSERVE_TICKS = 8
/** Consecutive misses tolerated after the process was seen before the session ends. */
const TRACKING_MISSES = 8

/** Seconds shown to the user in the launch-failure notice. */
export const OBSERVE_WINDOW_SECONDS = Math.round((OBSERVE_INTERVAL_MS * OBSERVE_TICKS) / 1000)

/** Split a command-line string into argv, honouring double quotes. */
export function splitArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) args.push(current)
  return args
}

interface ResolvedLaunch {
  kind: 'protocol' | 'spawn'
  target: string
  args: string[]
  cwd: string
  source: string
  watchDir: string
  description: string
}

function resolveEmulator(
  db: Db,
  game: Game,
  emulatorId: string | null,
  coreOverride: string,
  templateOverride: string,
  settings: AppSettings | undefined
): { exe: string; args: string[]; cwd: string } {
  if (!emulatorId) throw new Error('No emulator is configured for this game. Assign one in the game settings.')
  const row = db.prepare('SELECT * FROM emulators WHERE id = ?').get(emulatorId) as Record<string, unknown> | undefined
  if (!row) throw new Error('The selected emulator no longer exists.')
  const emulator = rowToEmulator(row)
  if (!fs.existsSync(emulator.path)) throw new Error(`Emulator executable missing: ${emulator.path}`)
  if (!game.romPath) throw new Error('This game has no ROM file to launch.')
  // Handing the emulator a path that is gone opens its empty window or fails
  // silently, so say what happened instead of "launching" a dead file.
  if (!fs.existsSync(game.romPath)) {
    throw new Error(
      `ROM file not found: ${game.romPath}. Move it back or rescan the folder — the game's playtime and metadata are kept.`
    )
  }

  const core = coreOverride || emulator.core || coreForPlatform(game.platformId)
  let corePath = core
  if (core && emulator.coreDir && !path.isAbsolute(core)) corePath = path.join(emulator.coreDir, core)

  const template = templateOverride || game.launchArgs || emulator.argsTemplate || '"{rom}"'
  // A template that never mentions the ROM starts the emulator on its own
  // empty window, which is what "launch" must not do: the button is for the
  // game. The ROM is appended as a last argument unless this game asked to
  // open the emulator bare, so an old or hand-written template cannot quietly
  // turn a game launch into an emulator launch.
  const passesRom = /\{rom\}/.test(template)
  const expanded = template
    .replace(/\{rom\}/g, game.romPath)
    .replace(/\{core\}/g, corePath)
    .replace(/\{game\}/g, game.title)
    .replace(/\{dir\}/g, game.installDir)
    .replace(/\{stateSlot\}/g, String(game.extra.saveStateSlot ?? ''))
    .replace(/\{title\}/g, game.title)

  const args = splitArgs(expanded)
  // A per-game choice wins; otherwise the global Emulation setting decides
  // whether a template without {rom} still opens the game or a bare emulator.
  const launchDirectly = game.extra.launchRomDirectly ?? settings?.launchRomsDirectly ?? true
  if (!passesRom && launchDirectly) args.push(game.romPath)

  // A verified fullscreen preset for this emulator starts the game fullscreen.
  // Emulators without one get no extra arguments, so the launch is unchanged.
  const customFullscreen = emulator.customFullscreenArgs ? splitArgs(emulator.customFullscreenArgs) : []
  const fullscreenArgs = fullscreenArgsFor(emulator.path, emulator.fullscreen, args, customFullscreen)
  if (fullscreenArgs.length) args.unshift(...fullscreenArgs)

  return {
    exe: emulator.path,
    args,
    cwd: path.dirname(emulator.path)
  }
}

export function buildLaunchCommand(db: Db, game: Game, settings?: AppSettings): ResolvedLaunch {
  const defaultMethod = game.launchMethods.find((m) => m.isDefault)

  if (defaultMethod) {
    if (defaultMethod.kind === 'steam') {
      return {
        kind: 'protocol',
        target: `steam://rungameid/${defaultMethod.target}`,
        args: [],
        cwd: '',
        source: 'steam',
        watchDir: game.installDir,
        description: 'Steam'
      }
    }
    if (defaultMethod.kind === 'url') {
      return {
        kind: 'protocol',
        target: defaultMethod.target,
        args: [],
        cwd: '',
        source: 'protocol',
        watchDir: '',
        description: defaultMethod.label || 'Protocol'
      }
    }
    if (defaultMethod.kind === 'emulator') {
      const run = resolveEmulator(
        db,
        game,
        defaultMethod.emulatorId ?? game.emulatorId,
        defaultMethod.core,
        defaultMethod.args,
        settings
      )
      return { kind: 'spawn', target: run.exe, args: run.args, cwd: run.cwd, source: 'emulator', watchDir: '', description: 'Emulator' }
    }
    if (!fs.existsSync(defaultMethod.target)) {
      throw new Error(`Launch target not found: ${defaultMethod.target}`)
    }
    return {
      kind: 'spawn',
      target: defaultMethod.target,
      args: splitArgs(defaultMethod.args || game.launchArgs),
      cwd: path.dirname(defaultMethod.target),
      source: 'executable',
      watchDir: '',
      description: defaultMethod.label || 'Executable'
    }
  }

  if (game.source === 'steam' && game.sourceId) {
    return {
      kind: 'protocol',
      target: `steam://rungameid/${game.sourceId}`,
      args: [],
      cwd: '',
      source: 'steam',
      watchDir: game.installDir,
      description: 'Steam'
    }
  }

  if (game.emulatorId || game.romPath) {
    const run = resolveEmulator(db, game, game.emulatorId, game.emulatorCore, game.launchArgs, settings)
    return { kind: 'spawn', target: run.exe, args: run.args, cwd: run.cwd, source: 'emulator', watchDir: '', description: 'Emulator' }
  }

  if (game.executable) {
    if (!fs.existsSync(game.executable)) {
      throw new Error(`Executable not found: ${game.executable}. Update the launch path in game settings.`)
    }
    return {
      kind: 'spawn',
      target: game.executable,
      args: splitArgs(game.launchArgs),
      cwd: game.installDir || path.dirname(game.executable),
      source: 'executable',
      watchDir: '',
      description: 'Executable'
    }
  }

  throw new Error('This game has no launch method. Edit the game and set an executable or emulator.')
}

interface ActiveSession {
  gameId: string
  sessionId: string
  startedAt: number
  source: string
  pid: number | null
  /** Executable of the running process, used to verify a pid before killing it. */
  exe: string
  child: ChildProcess | null
  poll: NodeJS.Timeout | null
  watchDir: string
  game: Game
  seen: boolean
  misses: number
  tick: number
}

function idleState(notice: LaunchNotice | null = null): PlayState {
  return {
    gameId: null,
    state: 'idle',
    startedAt: null,
    pid: null,
    tracked: false,
    observing: false,
    observeUntil: null,
    notice,
    recovered: false
  }
}

export class Launcher {
  private active: ActiveSession | null = null
  private state: PlayState = idleState()
  private db: Db
  private hooks: LaunchHooks

  constructor(db: Db, hooks: LaunchHooks) {
    this.db = db
    this.hooks = hooks
  }

  getState(): PlayState {
    return { ...this.state, notice: this.state.notice ? { ...this.state.notice } : null }
  }

  getActiveGameId(): string | null {
    return this.active?.gameId ?? null
  }

  private setState(next: PlayState): void {
    this.state = next
    this.hooks.emit(this.getState())
  }

  async launch(gameId: string): Promise<LaunchResult> {
    const game = getGame(this.db, gameId)
    if (!game) throw new Error('Game not found')
    if (this.active) {
      return {
        ok: false,
        gameId,
        sessionId: this.active.sessionId,
        message: 'Another game is already running. Stop it before launching a new one.',
        tracked: this.active.pid !== null
      }
    }

    let resolved: ResolvedLaunch
    try {
      resolved = buildLaunchCommand(this.db, game, this.hooks.settings())
    } catch (error) {
      throw new Error((error as Error).message)
    }

    const sessionId = uid()
    const startedAt = Date.now()
    // Record the session before asking anything to launch, so a crash between
    // here and the first poll still leaves evidence of the attempt.
    startSession(this.db, {
      id: sessionId,
      gameId,
      startedAt: new Date(startedAt).toISOString(),
      source: resolved.source
    })
    this.setState({ ...idleState(), gameId, state: 'launching', startedAt: new Date(startedAt).toISOString() })

    if (resolved.kind === 'protocol') {
      try {
        await this.hooks.openExternal(resolved.target)
      } catch (error) {
        abortSession(this.db, sessionId)
        this.setState(idleState())
        throw new Error(`Could not open ${resolved.target}: ${(error as Error).message}`)
      }
    } else {
      let child: ChildProcess
      try {
        child = spawn(resolved.target, resolved.args, {
          cwd: resolved.cwd && fs.existsSync(resolved.cwd) ? resolved.cwd : undefined,
          detached: true,
          stdio: 'ignore',
          // No console window: the emulator runs in the background and only
          // the game itself appears. GUI emulators show their own window;
          // pair this with fullscreen launch arguments for a seamless start.
          windowsHide: true
        })
      } catch (error) {
        abortSession(this.db, sessionId)
        this.setState(idleState())
        throw new Error(`Failed to launch: ${(error as Error).message}`)
      }
      if (child.pid) updateSessionProcess(this.db, sessionId, child.pid, resolved.target)
      child.on('error', () => {
        /* surfaced through exit handling */
      })
      child.on('exit', () => this.finish())
      child.unref()

      this.active = {
        gameId,
        sessionId,
        startedAt,
        source: resolved.source,
        pid: child.pid ?? null,
        exe: resolved.target,
        child,
        poll: null,
        watchDir: resolved.watchDir,
        game,
        seen: true,
        misses: 0,
        tick: 0
      }
      this.setState({
        ...idleState(),
        gameId,
        state: 'running',
        startedAt: new Date(startedAt).toISOString(),
        pid: child.pid ?? null,
        tracked: true
      })
      return {
        ok: true,
        gameId,
        sessionId,
        message: `Launched ${game.title} via ${resolved.description}`,
        tracked: true
      }
    }

    // Protocol launches (Steam) are tracked by watching for a process inside
    // the install folder. The wait is bounded: if nothing shows up within the
    // observation window the launch is abandoned and the UI offers Retry/Cancel.
    this.active = {
      gameId,
      sessionId,
      startedAt,
      source: resolved.source,
      pid: null,
      exe: '',
      child: null,
      poll: null,
      watchDir: resolved.watchDir,
      game,
      seen: false,
      misses: 0,
      tick: 0
    }

    if (resolved.watchDir) {
      this.setState({
        ...idleState(),
        gameId,
        state: 'launching',
        startedAt: new Date(startedAt).toISOString(),
        tracked: false,
        observing: true,
        observeUntil: new Date(startedAt + OBSERVE_INTERVAL_MS * OBSERVE_TICKS).toISOString()
      })
      this.startWatcher()
      return {
        ok: true,
        gameId,
        sessionId,
        message: `Asked ${resolved.description} to launch ${game.title}. Watching for the game for ${OBSERVE_WINDOW_SECONDS} seconds.`,
        tracked: true
      }
    }

    this.setState({
      ...idleState(),
      gameId,
      state: 'running',
      startedAt: new Date(startedAt).toISOString(),
      tracked: false
    })
    return {
      ok: true,
      gameId,
      sessionId,
      message: `Asked ${resolved.description} to launch ${game.title}. Playtime cannot be tracked automatically for this method.`,
      tracked: false
    }
  }

  /** Re-run the launch that expired or failed, from the pending notice. */
  async retry(): Promise<LaunchResult> {
    const gameId = this.state.notice?.gameId ?? null
    if (!gameId) throw new Error('There is no launch to retry.')
    this.setState(idleState())
    return this.launch(gameId)
  }

  /** Dismiss the launch notice without starting the game. */
  dismissNotice(): PlayState {
    if (this.state.notice) this.setState({ ...this.state, notice: null })
    return this.getState()
  }

  private startWatcher(): void {
    const session = this.active
    if (!session) return
    session.poll = setInterval(() => {
      void this.watchStep()
    }, OBSERVE_INTERVAL_MS)
  }

  private async watchStep(): Promise<void> {
    const session = this.active
    if (!session || !session.watchDir) return
    session.tick += 1
    const normalized = session.watchDir.toLowerCase().replace(/\\/g, '/')
    const processes = await listProcesses(0)
    // A stop/expire may have landed while the process list was loading.
    if (this.active !== session) return

    const match = processes.find((p) => {
      const exe = p.exe.toLowerCase().replace(/\\/g, '/')
      if (!exe.startsWith(normalized)) return false
      if (/steam(webhelper)?\.exe|gameoverlayui|steamservice/.test(exe)) return false
      return true
    })

    if (match) {
      session.misses = 0
      if (!session.seen) {
        session.seen = true
        session.pid = match.pid
        session.exe = match.exe
        updateSessionProcess(this.db, session.sessionId, match.pid, match.exe)
        this.setState({
          gameId: session.gameId,
          state: 'running',
          startedAt: new Date(session.startedAt).toISOString(),
          pid: match.pid,
          tracked: true,
          observing: false,
          observeUntil: null,
          notice: null
        })
        return
      }
      if (this.state.pid !== match.pid) {
        this.setState({ ...this.state, pid: match.pid, tracked: true })
      }
      session.pid = match.pid
      session.exe = match.exe
      return
    }

    if (session.seen) {
      session.misses += 1
      if (session.misses >= TRACKING_MISSES) this.finish()
      return
    }

    // Never observed: Steam may be updating, or the game failed to start.
    if (session.tick >= OBSERVE_TICKS) this.expireObservation(session)
  }

  /** Give up on a protocol launch that never produced a game process. */
  private expireObservation(session: ActiveSession): void {
    if (session.poll) clearInterval(session.poll)
    this.active = null
    // Nothing ran, so the ledger row for this attempt is removed.
    abortSession(this.db, session.sessionId)
    this.setState(
      idleState({
        gameId: session.gameId,
        title: session.game.title,
        reason: 'timeout',
        message: `Nothing launched within ${OBSERVE_WINDOW_SECONDS} seconds. It may still be starting, or Steam may be waiting on an update.`,
        at: new Date().toISOString()
      })
    )
  }

  async stop(): Promise<boolean> {
    const session = this.active
    if (!session) return false
    const pid = session.child?.pid ?? session.pid
    if (pid) {
      // A recovered session has no child handle, so confirm the pid still
      // belongs to the recorded executable before terminating it.
      let verified = Boolean(session.child) || !session.exe
      if (!verified) {
        const processes = await listProcesses(0)
        verified = processes.some(
          (entry) => entry.pid === pid && (!entry.exe || sameProcessPath(entry.exe, session.exe))
        )
      }
      if (verified) await killTree(pid)
    }
    if (!session.seen && this.state.state === 'launching') {
      if (session.poll) clearInterval(session.poll)
      abortSession(this.db, session.sessionId)
      this.active = null
      this.setState(idleState())
      return true
    }
    this.finish()
    return true
  }

  /** Finalise the active session, persisting playtime. */
  finish(forcedSeconds?: number, addPlaytime = true): void {
    const session = this.active
    if (!session) return
    if (session.poll) clearInterval(session.poll)
    const tracking = this.hooks.settings().playtimeTracking !== false
    const elapsed = forcedSeconds ?? Math.round((Date.now() - session.startedAt) / 1000)
    const seconds = tracking && addPlaytime ? Math.max(0, elapsed) : 0
    const endedAt = new Date().toISOString()

    finishSession(this.db, session.sessionId, endedAt, seconds)
    if (seconds >= 5) {
      finishGamePlaytime(this.db, session.gameId, seconds)
    }

    this.active = null
    this.setState(idleState())
  }

  shutdown(): void {
    const session = this.active
    if (!session) return
    if (session.poll) clearInterval(session.poll)
    const tracking = this.hooks.settings().playtimeTracking !== false
    const seconds = tracking ? Math.round((Date.now() - session.startedAt) / 1000) : 0
    finishSession(this.db, session.sessionId, new Date().toISOString(), seconds)
    if (seconds >= 5) finishGamePlaytime(this.db, session.gameId, seconds)
    this.active = null
  }

  /**
   * Take over a session that was still running when the app last exited. The
   * ledger row stays open and playtime keeps accumulating until the game stops.
   */
  adopt(session: OpenSession): boolean {
    if (this.active) return false
    const game = getGame(this.db, session.gameId)
    if (!game) return false
    const parsed = new Date(session.startedAt).getTime()
    const startedAt = Number.isFinite(parsed) ? parsed : Date.now()
    this.active = {
      gameId: session.gameId,
      sessionId: session.id,
      startedAt,
      source: session.source || 'recovered',
      pid: session.pid,
      exe: session.exe,
      child: null,
      poll: null,
      watchDir: '',
      game,
      seen: true,
      misses: 0,
      tick: 0
    }
    this.setState({
      ...idleState(),
      gameId: session.gameId,
      state: 'running',
      startedAt: new Date(startedAt).toISOString(),
      pid: session.pid,
      tracked: true,
      recovered: true
    })
    this.startPidWatcher()
    return true
  }

  /** Watch a recovered process by pid; end the session when it is gone. */
  private startPidWatcher(): void {
    const session = this.active
    if (!session || session.pid === null) return
    session.poll = setInterval(() => {
      void (async () => {
        if (this.active !== session) return
        const processes = await listProcesses(0)
        if (this.active !== session) return
        if (processes.some((entry) => entry.pid === session.pid)) {
          session.misses = 0
          return
        }
        session.misses += 1
        if (session.misses >= 2) this.finish()
      })()
    }, 10_000)
  }
}
