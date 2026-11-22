import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, Game, LaunchResult, PlayState } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { coreForPlatform } from './emulators.ts'
import { finishGamePlaytime, recordSession } from './library.ts'
import { killTree, listProcesses } from './processes.ts'
import { getGame, rowToEmulator, uid } from './repo.ts'

export interface LaunchHooks {
  emit(state: PlayState): void
  openExternal(url: string): Promise<void>
  settings(): AppSettings
}

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
  templateOverride: string
): { exe: string; args: string[]; cwd: string } {
  if (!emulatorId) throw new Error('No emulator is configured for this game. Assign one in the game settings.')
  const row = db.prepare('SELECT * FROM emulators WHERE id = ?').get(emulatorId) as Record<string, unknown> | undefined
  if (!row) throw new Error('The selected emulator no longer exists.')
  const emulator = rowToEmulator(row)
  if (!fs.existsSync(emulator.path)) throw new Error(`Emulator executable missing: ${emulator.path}`)
  if (!game.romPath) throw new Error('This game has no ROM file to launch.')

  const core = coreOverride || emulator.core || coreForPlatform(game.platformId)
  let corePath = core
  if (core && emulator.coreDir && !path.isAbsolute(core)) corePath = path.join(emulator.coreDir, core)

  const template = templateOverride || game.launchArgs || emulator.argsTemplate || '"{rom}"'
  const expanded = template
    .replace(/\{rom\}/g, game.romPath)
    .replace(/\{core\}/g, corePath)
    .replace(/\{game\}/g, game.title)
    .replace(/\{dir\}/g, game.installDir)
    .replace(/\{stateSlot\}/g, String(game.extra.saveStateSlot ?? ''))
    .replace(/\{title\}/g, game.title)

  return {
    exe: emulator.path,
    args: splitArgs(expanded),
    cwd: path.dirname(emulator.path)
  }
}

export function buildLaunchCommand(db: Db, game: Game): ResolvedLaunch {
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
        defaultMethod.args
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
    const run = resolveEmulator(db, game, game.emulatorId, game.emulatorCore, game.launchArgs)
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
  child: ChildProcess | null
  poll: NodeJS.Timeout | null
  watchDir: string
  game: Game
  seen: boolean
  misses: number
  tick: number
}

export class Launcher {
  private active: ActiveSession | null = null
  private state: PlayState = { gameId: null, state: 'idle', startedAt: null, pid: null, tracked: false }
  private db: Db
  private hooks: LaunchHooks

  constructor(db: Db, hooks: LaunchHooks) {
    this.db = db
    this.hooks = hooks
  }

  getState(): PlayState {
    return { ...this.state }
  }

  getActiveGameId(): string | null {
    return this.active?.gameId ?? null
  }

  private setState(next: PlayState): void {
    this.state = next
    this.hooks.emit(next)
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
      resolved = buildLaunchCommand(this.db, game)
    } catch (error) {
      throw new Error((error as Error).message)
    }

    const sessionId = uid()
    const startedAt = Date.now()
    this.setState({
      gameId,
      state: 'launching',
      startedAt: new Date(startedAt).toISOString(),
      pid: null,
      tracked: false
    })

    if (resolved.kind === 'protocol') {
      try {
        await this.hooks.openExternal(resolved.target)
      } catch (error) {
        this.setState({ gameId: null, state: 'idle', startedAt: null, pid: null, tracked: false })
        throw new Error(`Could not open ${resolved.target}: ${(error as Error).message}`)
      }
    } else {
      let child: ChildProcess
      try {
        child = spawn(resolved.target, resolved.args, {
          cwd: resolved.cwd && fs.existsSync(resolved.cwd) ? resolved.cwd : undefined,
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
      } catch (error) {
        this.setState({ gameId: null, state: 'idle', startedAt: null, pid: null, tracked: false })
        throw new Error(`Failed to launch: ${(error as Error).message}`)
      }
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
        child,
        poll: null,
        watchDir: resolved.watchDir,
        game,
        seen: true,
        misses: 0,
        tick: 0
      }
      this.setState({
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
    // the install folder. This is best-effort and reported as such.
    this.active = {
      gameId,
      sessionId,
      startedAt,
      source: resolved.source,
      pid: null,
      child: null,
      poll: null,
      watchDir: resolved.watchDir,
      game,
      seen: false,
      misses: 0,
      tick: 0
    }
    this.setState({
      gameId,
      state: 'running',
      startedAt: new Date(startedAt).toISOString(),
      pid: null,
      tracked: Boolean(resolved.watchDir)
    })
    if (resolved.watchDir) this.startWatcher()

    return {
      ok: true,
      gameId,
      sessionId,
      message: resolved.watchDir
        ? `Asked ${resolved.description} to launch ${game.title}. Playtime is tracked while the game process runs.`
        : `Asked ${resolved.description} to launch ${game.title}. Playtime cannot be tracked automatically for this method.`,
      tracked: Boolean(resolved.watchDir)
    }
  }

  private startWatcher(): void {
    const session = this.active
    if (!session) return
    session.poll = setInterval(() => {
      void this.watchStep()
    }, 10_000)
  }

  private async watchStep(): Promise<void> {
    const session = this.active
    if (!session || !session.watchDir) return
    session.tick += 1
    const normalized = session.watchDir.toLowerCase().replace(/\\/g, '/')
    const processes = await listProcesses(0)
    const match = processes.find((p) => {
      const exe = p.exe.toLowerCase().replace(/\\/g, '/')
      if (!exe.startsWith(normalized)) return false
      if (/steam(webhelper)?\.exe|gameoverlayui|steamservice/.test(exe)) return false
      return true
    })
    if (match) {
      session.seen = true
      session.misses = 0
      if (this.state.pid !== match.pid) {
        this.setState({ ...this.state, pid: match.pid, tracked: true })
      }
      return
    }
    if (session.seen) {
      session.misses += 1
      if (session.misses >= 2) this.finish()
      return
    }
    // Never observed: Steam may be updating or the game failed to start.
    if (session.tick >= 18) {
      this.finish(0, false)
    }
  }

  async stop(): Promise<boolean> {
    const session = this.active
    if (!session) return false
    if (session.child?.pid) await killTree(session.child.pid)
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

    recordSession(this.db, {
      id: session.sessionId,
      gameId: session.gameId,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt,
      seconds,
      source: session.source
    })
    if (seconds >= 5) {
      finishGamePlaytime(this.db, session.gameId, seconds)
    }

    this.active = null
    this.setState({ gameId: null, state: 'idle', startedAt: null, pid: null, tracked: false })
  }

  shutdown(): void {
    const session = this.active
    if (!session) return
    if (session.poll) clearInterval(session.poll)
    const tracking = this.hooks.settings().playtimeTracking !== false
    const seconds = tracking ? Math.round((Date.now() - session.startedAt) / 1000) : 0
    recordSession(this.db, {
      id: session.sessionId,
      gameId: session.gameId,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      seconds,
      source: session.source
    })
    if (seconds >= 5) finishGamePlaytime(this.db, session.gameId, seconds)
    this.active = null
  }
}
