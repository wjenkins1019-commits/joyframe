/** Types for cdp.mjs, which stays plain JavaScript shared by the .mjs and .ts probes. */
export declare const delay: (ms: number) => Promise<void>

export interface CdpEvent {
  method: string
  params: any
}

export interface CdpSession {
  events: CdpEvent[]
  call: (method: string, params?: Record<string, unknown>) => Promise<any>
  close: () => void
  evaluate: (expression: string) => Promise<any>
  read: (expression: string, ready: (value: any) => boolean, timeout?: number) => Promise<any>
}

export interface CdpTarget {
  url: string
  webSocketDebuggerUrl: string
}

export declare function connect(debuggerUrl: string): Promise<Omit<CdpSession, 'evaluate' | 'read'>>

export declare function findWindow(port: number): Promise<CdpTarget | null>

export declare function createSession(
  target: Pick<CdpTarget, 'webSocketDebuggerUrl'>,
  options?: { reload?: boolean }
): Promise<CdpSession>

export declare function consoleProblems(events: CdpEvent[], label?: string): string[]

export declare function removeDir(dir: string): void
