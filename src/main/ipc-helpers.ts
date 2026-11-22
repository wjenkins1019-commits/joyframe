import { ipcMain } from 'electron'

export type HandlerMap = Record<string, (...args: never[]) => unknown>

/** Register every handler in a map as an ipcMain.handle channel. */
export function registerIpc(handlers: HandlerMap): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => handler(...(args as never[])))
  }
}
