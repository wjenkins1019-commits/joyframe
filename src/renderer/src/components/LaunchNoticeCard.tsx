import { AlarmClock } from 'lucide-react'
import { useStore } from '../state/store'
import { Button } from './ui'

/**
 * Shown when a launch's bounded observation window ended without a game
 * process. The attempt is over, so it offers an explicit Retry or Cancel
 * instead of leaving the launcher blocked.
 */
export function LaunchNoticeCard(): React.JSX.Element | null {
  const notice = useStore((state) => state.playState.notice)
  const retryLaunch = useStore((state) => state.retryLaunch)
  const dismissLaunchNotice = useStore((state) => state.dismissLaunchNotice)

  if (!notice) return null

  return (
    <div data-jf-layer-skip="1" className="pointer-events-none fixed inset-x-0 bottom-6 z-[75] flex justify-center px-6">
      <div className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border border-amber-400/30 bg-[#141619]/95 px-4 py-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)] backdrop-blur-xl animate-rise">
        <AlarmClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Couldn't confirm {notice.title} started</p>
          <p className="mt-0.5 text-xs leading-relaxed text-white/55">{notice.message}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => void retryLaunch()}>
            Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void dismissLaunchNotice()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
