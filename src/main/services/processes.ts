import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessInfo {
  pid: number
  name: string
  exe: string
}

let cache: { at: number; data: ProcessInfo[] } | null = null

/**
 * Read the running process list with executable paths. Uses CIM on Windows so
 * games launched through Steam (or a launcher wrapper) can be attributed back
 * to their install folder. Results are cached briefly to keep polling cheap.
 */
export async function listProcesses(maxAgeMs = 4000): Promise<ProcessInfo[]> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.data
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,comm='], { timeout: 5000 })
      const data = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [pid, ...rest] = line.split(/\s+/)
          return { pid: Number(pid), name: rest.join(' '), exe: rest.join(' ') }
        })
      cache = { at: Date.now(), data }
      return data
    } catch {
      return []
    }
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress'
      ],
      { timeout: 12000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }
    )
    const parsed = JSON.parse(stdout || '[]') as
      | { ProcessId: number; Name: string; ExecutablePath: string | null }[]
      | { ProcessId: number; Name: string; ExecutablePath: string | null }
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const data = list.map((p) => ({ pid: Number(p.ProcessId), name: String(p.Name ?? ''), exe: String(p.ExecutablePath ?? '') }))
    cache = { at: Date.now(), data }
    return data
  } catch {
    return cache?.data ?? []
  }
}

export async function killTree(pid: number): Promise<boolean> {
  if (!pid) return false
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 8000 })
    } else {
      process.kill(-pid, 'SIGTERM')
    }
    return true
  } catch {
    return false
  }
}
