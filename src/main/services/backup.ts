import fs from 'node:fs'
import path from 'node:path'
import type { BackupInfo } from '../../shared/types.ts'
import { backupDatabase, type Db } from './db.ts'

const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'binary')

function stamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  // Milliseconds keep two backups made in the same second apart; a name clash
  // would otherwise overwrite one database while the other's key companion stayed.
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}${String(now.getMilliseconds()).padStart(3, '0')}`
}

export interface BackupOptions {
  /**
   * Copy the profile's secrets.key beside the backup, so restoring it on
   * another PC keeps provider keys readable. Opt-in only: automatic backups and
   * plain manual ones never carry the key, so a copied database on its own can
   * never reveal a stored credential.
   */
  secretsPath?: string
}

/** The companion key file that belongs to a database backup. */
function backupKeyPath(backupPath: string): string {
  return `${backupPath}.key`
}

/**
 * Write encryption key material owner-only. writeFileSync's `mode` only applies
 * when it creates the file, so the bits are set again afterwards; Windows has no
 * group/world bits to clear and chmod there only toggles the read-only flag.
 */
function writeKeyFile(file: string, contents: Buffer): void {
  fs.writeFileSync(file, contents, { mode: 0o600 })
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
}

/** Copy key material as a key file, never as a plain file copy that inherits a wide mode. */
function copyKeyFile(source: string, target: string): void {
  writeKeyFile(target, fs.readFileSync(source))
}

export async function createBackup(
  db: Db,
  backupDir: string,
  keep = 10,
  label = 'auto',
  options: BackupOptions = {}
): Promise<BackupInfo> {
  fs.mkdirSync(backupDir, { recursive: true })
  const name = `joyframe-${label}-${stamp()}.db`
  const target = path.join(backupDir, name)
  await backupDatabase(db, target)
  if (options.secretsPath && fs.existsSync(options.secretsPath)) {
    try {
      copyKeyFile(options.secretsPath, backupKeyPath(target))
    } catch (error) {
      // Never leave behind a backup that looks plain but was asked to be portable.
      fs.rmSync(target, { force: true })
      throw error
    }
  }
  const stat = fs.statSync(target)
  pruneBackups(backupDir, keep)
  return {
    name,
    path: target,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
    includesSecrets: fs.existsSync(backupKeyPath(target))
  }
}

export function listBackups(backupDir: string): BackupInfo[] {
  if (!fs.existsSync(backupDir)) return []
  return fs
    .readdirSync(backupDir)
    .filter((file) => file.endsWith('.db'))
    .map((file) => {
      const full = path.join(backupDir, file)
      const stat = fs.statSync(full)
      return {
        name: file,
        path: full,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        includesSecrets: fs.existsSync(backupKeyPath(full))
      }
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
    // A pruned backup must not leave its key behind.
    try {
      fs.unlinkSync(backupKeyPath(backup.path))
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
 * Replace the live database with a backup, closing the connection as part of the
 * swap. On failure the profile is left as it was; the caller relaunches so every
 * cache is rebuilt either way.
 *
 * A backup made with `secretsPath` carries its profile's secrets.key as a
 * companion file; when present it is installed as the live key, so a restore on
 * another PC keeps the stored provider keys readable. Without a companion the
 * live key is left exactly as it was.
 */
export function restoreBackup(db: Db, dbFile: string, backupPath: string, secretsPath?: string): boolean {
  if (!isValidDatabase(backupPath)) throw new Error('That file is not a valid JOYFRAME database backup.')
  const companion = backupKeyPath(backupPath)
  const incomingKey = fs.existsSync(companion) ? fs.readFileSync(companion) : null
  if (incomingKey && incomingKey.length < 32) {
    throw new Error("That backup's key file is not a JOYFRAME secrets.key.")
  }

  // Stage the backup's key beside the live one. Installing it is a rename once
  // the database swap has succeeded, so a failed swap cannot disturb the key the
  // profile is still using.
  let pendingKey: string | null = null
  if (secretsPath && incomingKey) {
    pendingKey = `${secretsPath}.pending`
    fs.rmSync(pendingKey, { force: true })
    writeKeyFile(pendingKey, incomingKey)
  }

  const safetyDir = path.join(path.dirname(dbFile), 'backups')
  fs.mkdirSync(safetyDir, { recursive: true })
  const safety = path.join(safetyDir, `joyframe-before-restore-${stamp()}.db`)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(dbFile, safety)
  // Keep the current key beside the safety copy: a restore that swaps keys must
  // still leave a readable way back.
  if (secretsPath && fs.existsSync(secretsPath)) copyKeyFile(secretsPath, backupKeyPath(safety))
  db.close()

  try {
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
    if (pendingKey && secretsPath) fs.renameSync(pendingKey, secretsPath)
  } catch (error) {
    // Put the pre-restore database back (a half-written copy would not open) and
    // drop the staged key, leaving the profile exactly as it was.
    try {
      fs.copyFileSync(safety, dbFile)
    } catch {
      /* best effort: the safety copy is still on disk */
    }
    if (pendingKey) fs.rmSync(pendingKey, { force: true })
    throw error
  }
  return true
}
