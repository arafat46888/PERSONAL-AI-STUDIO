import type { AppSettings } from '@/types'

export const DEFAULT_SETTINGS: AppSettings = {
  general: { language: 'en', defaultModelId: '', startupPage: 'chat', autoSave: true, confirmBeforeDelete: true },
  appearance: { theme: 'dark', accent: '#6366f1', fontFamily: 'system-ui', fontSize: 'base', messageWidth: 'normal', sidebarWidth: 280, density: 'comfortable', animations: true },
  chat: { enterToSend: true, markdown: true, codeHighlight: true, autoScroll: true, autoTitle: true, tempChat: false },
  voice: { sttLanguage: 'en-US', ttsVoice: '', ttsRate: 1, autoRead: false, engine: 'browser' },
  memory: { globalEnabled: true, chatEnabled: true, projectEnabled: true, approvalRequired: true },
  router: { mode: 'failover', primaryModelId: '', secondaryModelId: '', fallbackModelIds: [], maxRetries: 3, timeoutMs: 60000, retryDelayMs: 1000, failureCooldownMs: 60000 },
  advanced: { debugMode: false, allowSaveUntested: false, exportIncludesKeys: false },
  shortcuts: { newChat: 'mod+k', search: 'mod+shift+f', send: 'Enter', stop: 'Escape', toggleSidebar: 'mod+b', settings: 'mod+,', palette: 'mod+shift+p' }
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(16, key.length - 8))}${key.slice(-4)}`
}

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export function extractPromptVariables(text: string): string[] {
  const out = new Set<string>()
  const re = /\{\{\s*([a-zA-Z0-9_\- ]+)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.add(m[1])
  return [...out]
}

export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_\- ]+)\s*\}\}/g, (_, k) => values[k.trim()] ?? `{{${k}}}`)
}

export function validateUrl(u: string): boolean {
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
