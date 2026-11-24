/** Types for the parts of cdp.mjs the TypeScript probes import. */
export declare const delay: (ms: number) => Promise<void>

export interface CdpSession {
  call: (method: string, params?: Record<string, unknown>, timeout?: number) => Promise<any>
  close: () => void
  evaluate: (expression: string) => Promise<any>
}

export declare function findWindow(port: number): Promise<{ webSocketDebuggerUrl: string } | null>

/** Returns a function to call once the probe has printed its result. */
export declare function reportUnfinishedRun(label: string): () => void

export declare function createSession(
  target: { webSocketDebuggerUrl: string },
  options?: { reload?: boolean }
): Promise<CdpSession>
