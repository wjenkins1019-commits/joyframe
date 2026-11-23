/** Types for the parts of cdp.mjs the TypeScript probes import. */
export declare const delay: (ms: number) => Promise<void>

export interface CdpSession {
  call: (method: string, params?: Record<string, unknown>) => Promise<any>
  close: () => void
  evaluate: (expression: string) => Promise<any>
}

export declare function findWindow(port: number): Promise<{ webSocketDebuggerUrl: string } | null>

export declare function createSession(
  target: { webSocketDebuggerUrl: string },
  options?: { reload?: boolean }
): Promise<CdpSession>
