import { useEffect } from 'react'
import { AppRoutes } from './app/router'
import { useAppStore } from '@/stores/app'
import { Toaster } from '@/components/ui'

export default function App() {
  const init = useAppStore((s) => s.init)
  useEffect(() => { void init() }, [init])

  // Apply appearance settings to CSS variables / classes whenever they change
  const appearance = useAppStore((s) => s.settings.appearance)
  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => {
      const dark = appearance.theme === 'dark' || (appearance.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('light', !dark)
    }
    applyTheme()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', applyTheme)
    root.style.setProperty('--accent', appearance.accent)
    root.style.setProperty('--sidebar-w', `${appearance.sidebarWidth}px`)
    root.style.setProperty('--font-ui', appearance.fontFamily)
    root.style.fontSize = appearance.fontSize === 'sm' ? '14px' : appearance.fontSize === 'lg' ? '18px' : '16px'
    root.dataset.density = appearance.density
    root.dataset.msgwidth = appearance.messageWidth
    if (!appearance.animations) root.classList.add('no-animations')
    else root.classList.remove('no-animations')
    return () => mq.removeEventListener('change', applyTheme)
  }, [appearance])

  return (
    <div className="h-dvh text-ink font-[var(--font-ui)]">
      <AppRoutes />
      <Toaster />
    </div>
  )
}
