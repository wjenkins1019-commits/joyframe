import fs from 'node:fs'
import path from 'node:path'
import type { BackupInfo } from '../../shared/types.ts'
import { backupDatabase, type Db } from './db.ts'

const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'binary')

function stamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`
}

export async function createBackup(db: Db, backupDir: string, keep = 10, label = 'auto'): Promise<BackupInfo> {
  fs.mkdirSync(backupDir, { recursive: true })
  const name = `joyframe-${label}-${stamp()}.db`
  const target = path.join(backupDir, name)
  await backupDatabase(db, target)
  const stat = fs.statSync(target)
  pruneBackups(backupDir, keep)
  return { name, path: target, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() }
}

export function listBackups(backupDir: string): BackupInfo[] {
  if (!fs.existsSync(backupDir)) return []
  return fs
    .readdirSync(backupDir)
    .filter((file) => file.endsWith('.db'))
    .map((file) => {
      const full = path.join(backupDir, file)
      const stat = fs.statSync(full)
      return { name: file, path: full, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() }
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function pruneBackups(backupDir: string, keep: number): void {
  const backups = listBackups(backupDir)
  for (const backup of backups.slice(Math.max(1, keep))) {
    try {
      fs.unlinkSync(backup.path)
    } catch {
      /* ignore */
    }
  }
}

export function isValidDatabase(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(16)
    fs.readSync(fd, buffer, 0, 16, 0)
    fs.closeSync(fd)
    return buffer.equals(SQLITE_HEADER)
  } catch {
    return false
  }
}

/**
 * Replace the live database with a backup. The caller must close the open
 * connection first; the app then relaunches so every cache is rebuilt.
 */
export function restoreBackup(db: Db, dbFile: string, backupPath: string): boolean {
  if (!isValidDatabase(backupPath)) throw new Error('That file is not a valid JOYFRAME database backup.')
  const safetyDir = path.join(path.dirname(dbFile), 'backups')
  fs.mkdirSync(safetyDir, { recursive: true })
  const safety = path.join(safetyDir, `joyframe-before-restore-${stamp()}.db`)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(dbFile, safety)
  db.close()
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbFile}${suffix}`
    if (fs.existsSync(sidecar)) {
      try {
        fs.unlinkSync(sidecar)
      } catch {
        /* ignore */
      }
    }
  }
  fs.copyFileSync(backupPath, dbFile)
  return true
}
