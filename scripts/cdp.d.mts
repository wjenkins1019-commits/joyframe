/** Types for the parts of cdp.mjs the TypeScript probes import. */
export declare const delay: (ms: number) => Promise<void>

export interface CdpSession {
  call: (method: string, params?: Record<string, unknown>, timeout?: number) => Promise<any>
  close: () => void
  evaluate: (expression: string) => Promise<any>
}

export declare function findWindow(port: number): Promise<{ webSocketDebuggerUrl: string } | null>

/** Exit code for a run the machine was not ready for, not a regression. */
export declare const EXIT_NOT_READY: number

export interface AppLog {
  stdio: (number | 'ignore')[]
}

/** Per-run capture of the app's stdout/stderr, tail-printed when the run fails. */
export declare function createAppLog(name: string, options?: { lines?: number }): AppLog

export interface BootNeed {
  file: string
  remedy: string
}

export declare const MISSING_ELECTRON: string
export declare const MISSING_PACKAGED: string

/** The prerequisites of any probe that boots the dev build. Read-only. */
export declare const DEV_BOOT_NEEDS: BootNeed[]

export declare function preflight(options: {
  label: string
  needs?: BootNeed[]
  port?: number
  portVariable?: string
}): Promise<void>

/** Returns a function to call once the probe has printed its result. */
export declare function reportUnfinishedRun(label: string): () => void

export declare function createSession(
  target: { webSocketDebuggerUrl: string },
  options?: { reload?: boolean }
): Promise<CdpSession>
