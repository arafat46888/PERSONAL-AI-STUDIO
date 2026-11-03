import { create } from 'zustand'
import { db } from '@/database/db'
import { DEFAULT_SETTINGS } from '@/utils'
import type { AppSettings } from '@/types'

interface Toast { id: string; kind: 'success' | 'error' | 'warning' | 'info' | 'loading'; title: string; detail?: string }

interface AppState {
  settings: AppSettings
  settingsLoaded: boolean
  toasts: Toast[]
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  streamingChatId: string | null
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings> | ((s: AppSettings) => Partial<AppSettings>)) => Promise<void>
  toast: (kind: Toast['kind'], title: string, detail?: string) => string
  dismissToast: (id: string) => void
  updateToast: (id: string, patch: Partial<Pick<Toast, 'kind' | 'title' | 'detail'>>) => void
  setSidebarCollapsed: (v: boolean) => void
  setMobileNavOpen: (v: boolean) => void
  setStreaming: (chatId: string | null) => void
}

function mergeSettings(base: AppSettings, incoming: Partial<AppSettings>): AppSettings {
  const out = { ...base } as AppSettings
  for (const k of Object.keys(incoming) as (keyof AppSettings)[]) {
    const v = incoming[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) (out as Record<string, unknown>)[k] = { ...(base[k] as object), ...v }
    else (out as Record<string, unknown>)[k] = v
  }
  return out
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  toasts: [],
  sidebarCollapsed: false,
  mobileNavOpen: false,
  streamingChatId: null,

  loadSettings: async () => {
    const row = await db.settings.get('app')
    const loaded = row ? mergeSettings(DEFAULT_SETTINGS, row.value as Partial<AppSettings>) : DEFAULT_SETTINGS
    set({ settings: loaded, settingsLoaded: true })
    applyTheme(loaded)
  },

  updateSettings: async (patch) => {
    const cur = get().settings
    const next = mergeSettings(cur, typeof patch === 'function' ? patch(cur) : patch)
    set({ settings: next })
    applyTheme(next)
    await db.settings.put({ key: 'app', value: next })
  },

  toast: (kind, title, detail) => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, kind, title, detail }] }))
    if (kind !== 'loading') setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000)
    return id
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  updateToast: (id, p) => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...p } : t)) })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  setStreaming: (chatId) => set({ streamingChatId: chatId })
}))

export function applyTheme(s: AppSettings) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = s.appearance.theme === 'dark' || (s.appearance.theme === 'system' && prefersDark)
  root.classList.toggle('dark', dark)
  root.style.setProperty('--accent', s.appearance.accent)
  root.style.setProperty('--font-size', s.appearance.fontSize === 'sm' ? '14px' : s.appearance.fontSize === 'lg' ? '17px' : '15.5px')
  root.style.setProperty('--sidebar-w', `${s.appearance.sidebarWidth}px`)
  root.style.fontFamily = s.appearance.fontFamily
  root.classList.toggle('no-animations', !s.appearance.animations)
  root.dataset.density = s.appearance.density
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const s = useAppStore.getState().settings
  if (s.appearance.theme === 'system') applyTheme(s)
})
