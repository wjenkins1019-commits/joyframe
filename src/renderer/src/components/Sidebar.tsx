import {
  BarChart3,
  Cpu,
  Gamepad2,
  Home,
  Layers,
  Library,
  Settings,
  Tv
} from 'lucide-react'
import type { ViewId } from '@shared/types'
import { useStore } from '../state/store'
import { cx } from './ui'
import { LogoMark } from './Logo'

const ITEMS: { id: ViewId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'collections', label: 'Collections', icon: Layers },
  { id: 'steam', label: 'Steam', icon: Gamepad2 },
  { id: 'emulators', label: 'Emulators', icon: Cpu },
  { id: 'stats', label: 'Statistics', icon: BarChart3 }
]

export function Sidebar({ hidden = false }: { hidden?: boolean }): React.JSX.Element {
  const view = useStore((state) => state.view)
  const setView = useStore((state) => state.setView)
  const setConsoleMode = useStore((state) => state.setConsoleMode)
  const consoleMode = useStore((state) => state.consoleMode)

  const enterConsole = (): void => {
    setConsoleMode(true)
    void window.joyframe.system.setFullScreen(true).catch(() => undefined)
  }

  return (
    <nav
      className={cx(
        'relative z-30 flex h-full w-[84px] shrink-0 flex-col items-center border-r border-white/6 bg-[#111317]/92 py-3 backdrop-blur-xl',
        hidden && 'hidden'
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center">
        <LogoMark size={38} />
      </div>

      <div className="mt-6 flex flex-1 flex-col items-center gap-1.5">
        {ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.id && !consoleMode
          return (
            <button
              key={item.id}
              data-nav="1"
              onClick={() => setView(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'group relative flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200',
                active
                  ? 'bg-jf-red/16 text-white shadow-[inset_0_0_0_1px_rgba(215,25,53,0.35)]'
                  : 'text-white/45 hover:bg-white/6 hover:text-white'
              )}
            >
              {active && <span className="absolute -left-3 h-6 w-[3px] rounded-r bg-jf-red" />}
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              <span className="pointer-events-none absolute left-[58px] z-50 hidden whitespace-nowrap rounded-md border border-white/10 bg-[#212429] px-2 py-1 text-[11px] font-semibold text-white shadow-xl group-hover:block">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col items-center gap-1.5 pb-1">
        <button
          data-nav="1"
          onClick={enterConsole}
          title="Console Mode"
          aria-label="Console Mode"
          className="group relative flex h-12 w-12 items-center justify-center rounded-xl text-white/45 transition hover:bg-white/6 hover:text-white"
        >
          <Tv className="h-5 w-5" />
          <span className="pointer-events-none absolute left-[58px] z-50 hidden whitespace-nowrap rounded-md border border-white/10 bg-[#212429] px-2 py-1 text-[11px] font-semibold text-white shadow-xl group-hover:block">
            Console Mode
          </span>
        </button>
        <button
          data-nav="1"
          onClick={() => setView('settings')}
          title="Settings"
          aria-label="Settings"
          className={cx(
            'group relative flex h-12 w-12 items-center justify-center rounded-xl transition',
            view === 'settings'
              ? 'bg-white/10 text-white'
              : 'text-white/45 hover:bg-white/6 hover:text-white'
          )}
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </nav>
  )
}
