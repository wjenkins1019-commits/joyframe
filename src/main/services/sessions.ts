import type { Db } from './db.ts'
import { nowIso } from './repo.ts'
import { listProcesses } from './processes.ts'

/**
 * Play sessions are written when the game launches (`ended_at` stays empty
 * while the session is open) and completed when it ends. A crash therefore
 * leaves an open row behind, which startup reconciliation settles: sessions
 * whose process is gone are closed, and sessions whose process is still
 * running are handed back to the launcher so the UI can stop them.
 */

export interface SessionStart {
  id: string
  gameId: string
  startedAt: string
  source: string
  pid?: number | null
  exe?: string
}

export interface OpenSession {
  id: string
  gameId: string
  title: string
  startedAt: string
  source: string
  pid: number | null
  exe: string
}

export interface RecoveryReport {
  /** Sessions whose process is still alive and can be adopted. */
  live: OpenSession[]
  /** Sessions closed because their process is gone. */
  closed: number
}

export function startSession(db: Db, session: SessionStart): void {
  db.prepare(
    'INSERT INTO play_sessions (id, game_id, started_at, ended_at, seconds, source, pid, exe, recovered) VALUES (?,?,?,\'\',0,?,?,?,0)'
  ).run(
    session.id,
    session.gameId,
    session.startedAt,
    session.source,
    session.pid ?? null,
    session.exe ?? ''
  )
}

/** Record the process that ended up running, so a crash can find it again. */
export function updateSessionProcess(db: Db, id: string, pid: number, exe: string): void {
  db.prepare('UPDATE play_sessions SET pid = ?, exe = ? WHERE id = ?').run(pid, exe, id)
}

export function finishSession(db: Db, id: string, endedAt: string, seconds: number): void {
  db.prepare('UPDATE play_sessions SET ended_at = ?, seconds = ? WHERE id = ?').run(endedAt, Math.max(0, seconds), id)
}

/** Remove a session that never actually started (failed or cancelled launch). */
export function abortSession(db: Db, id: string): void {
  db.prepare('DELETE FROM play_sessions WHERE id = ?').run(id)
}

/** Close a crashed session whose process no longer exists, without inventing playtime. */
export function closeInterruptedSession(db: Db, id: string): void {
  db.prepare("UPDATE play_sessions SET ended_at = ?, seconds = 0, recovered = 1 WHERE id = ?").run(nowIso(), id)
}

export function listOpenSessions(db: Db): OpenSession[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.game_id, s.started_at, s.source, s.pid, s.exe, g.title
       FROM play_sessions s JOIN games g ON g.id = s.game_id
       WHERE s.ended_at = ''
       ORDER BY s.started_at ASC`
    )
    .all() as Record<string, unknown>[]
  return rows.map((row) => ({
    id: String(row.id),
    gameId: String(row.game_id),
    title: String(row.title),
    startedAt: String(row.started_at),
    source: String(row.source ?? ''),
    pid: row.pid === null || row.pid === undefined ? null : Number(row.pid),
    exe: String(row.exe ?? '')
  }))
}

export function sameProcessPath(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\\/g, '/') === b.toLowerCase().replace(/\\/g, '/')
}

/**
 * Settle sessions left open by a crash. A session counts as still running only
 * when its recorded pid is alive *and* its executable path matches, so a
 * recycled pid cannot resurrect the wrong game.
 */
export async function reconcileOpenSessions(db: Db): Promise<RecoveryReport> {
  const open = listOpenSessions(db)
  if (open.length === 0) return { live: [], closed: 0 }

  const processes = await listProcesses(0)
  const live: OpenSession[] = []
  let closed = 0
  for (const session of open) {
    const alive =
      session.pid !== null &&
      processes.some(
        (entry) =>
          entry.pid === session.pid && (!session.exe || !entry.exe || sameProcessPath(entry.exe, session.exe))
      )
    if (alive) {
      live.push(session)
    } else {
      closeInterruptedSession(db, session.id)
      closed += 1
    }
  }
  return { live, closed }
}
