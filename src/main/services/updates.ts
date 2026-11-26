import { execFile } from 'node:child_process'
import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * In-app auto-updates via electron-updater, fed by the GitHub release that
 * the release workflow stages as a draft, proves (digest + silent install +
 * boot), and only then promotes to published.
 *
 * The update check runs only when ALL of these hold:
 * - the app is packaged (`app.isPackaged`), so dev builds never phone home;
 * - the platform is Windows, the only target the updater is configured for;
 * - the running exe carries a valid Authenticode signature. Unsigned builds
 *   (local dev packages, and every release until code signing is configured)
 *   skip silently with a log line — there is nothing trustworthy to update
 *   from, and electron-updater would refuse the install anyway.
 *
 * `verifyUpdateCodeSignature` is deliberately left at its default (true):
 * it is the guarantee that a downloaded update was signed by the same
 * publisher as the installed app before it is allowed to run. Never set it
 * to false to "make updates work" on unsigned builds — that would let any
 * network attacker serve the updater a malicious installer.
 */
export function startUpdateChecks(log: (message: string) => void): void {
  if (!app.isPackaged) return
  if (process.platform !== 'win32') {
    log('updates: skipping check — auto-update is configured for Windows only')
    return
  }
  // Fire and forget: a hung check must never stall startup or the window.
  void gateAndCheck(log)
}

async function gateAndCheck(log: (message: string) => void): Promise<void> {
  let signed = false
  try {
    signed = await isAuthenticodeValid(app.getPath('exe'))
  } catch (error) {
    log(`updates: signature check failed (${(error as Error).message}) — skipping check`)
    return
  }
  if (!signed) {
    log('updates: skipping check — running exe is not Authenticode-signed; updates enable automatically on signed builds')
    return
  }

  autoUpdater.logger = {
    info: (message: string) => log(`updates: ${message}`),
    warn: (message: string) => log(`updates: ${message}`),
    error: (message: string) => log(`updates error: ${message}`),
    debug: () => {}
  } as typeof autoUpdater.logger
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    log(`updates: v${info.version} downloaded, prompting to restart`)
    void dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'JOYFRAME update ready',
        message: `JOYFRAME v${info.version} has downloaded and will install on restart.`
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
        else log('updates: install deferred to app quit')
      })
  })

  try {
    await autoUpdater.checkForUpdates()
    log('updates: check finished')
  } catch (error) {
    // Network failures, no releases yet, etc: logged, never surfaced. The
    // user is never nagged about something they cannot act on.
    log(`updates: check failed (${(error as Error).message})`)
  }
}

/**
 * True when the file carries a valid, chain-trusted Authenticode signature.
 * This is only the gate ("signed at all"); electron-updater's own signature
 * verification matches the download against the installed publisher.
 */
function isAuthenticodeValid(exePath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const quoted = `'${exePath.replace(/'/g, "''")}'`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -FilePath ${quoted}).Status`],
      { timeout: 15000 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout.trim() === 'Valid')
      }
    )
  })
}
