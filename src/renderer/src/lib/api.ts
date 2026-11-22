import type { JoyframeApi } from '@shared/types'

function requireApi(): JoyframeApi {
  if (typeof window === 'undefined' || !window.joyframe) {
    throw new Error('JOYFRAME bridge is unavailable. Run the app through Electron.')
  }
  return window.joyframe
}

export const api = new Proxy({} as JoyframeApi, {
  get(_target, prop: string) {
    return (requireApi() as unknown as Record<string, unknown>)[prop]
  }
})

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Electron wraps IPC errors with "Error invoking remote method ...: Error: ..."
    return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }
  return String(error)
}
