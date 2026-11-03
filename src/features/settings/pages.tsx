import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { db } from '@/database/db'
import type { RouterStatsEntry } from '@/types'
import { cx, Button, Input, Select, Field, Toggle, Modal, Badge, Tabs, ConfirmDialog } from '@/components/ui'
import { Sidebar } from '@/components/layout/Sidebar'
import { ModelSelector } from '@/features/models/ModelSelector'
import { ProvidersSettings, ModelsSettings } from '@/features/providers/ProvidersSettings'
import { MemoryPage, ProjectsPage, PromptsPage, AssistantsPage } from '@/features/projects/pages'
import { SearchPage, ArchivedPage, ComparePage } from '@/features/search/pages'
import { CodeWorkspacePage } from '@/features/coding/CodeWorkspace'
import { ChatScreen, VoiceModeBar } from '@/features/chat/ChatScreen'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useTTS, speechRecognitionSupported, ttsSupported } from '@/services/voice'
import { getRouterStats, clearRouterStats } from '@/services/ai/router/engine'
import { exportJSON, exportZIP, validateBackup, importBackup, APP_VERSION, type ImportReport } from '@/services/export'
import { formatBytes } from '@/utils'
import { nanoid } from 'nanoid'
import {
  Menu as MenuIcon, Settings2, Database, Keyboard, Bug, Info, Zap,
  Download, Upload, Trash2, Eraser, Activity, Timer, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Cpu, Route as RouteIcon, Palette, MessageSquare, Mic, Brain, HardDrive, Lock, FileJson
} from 'lucide-react'

/* ================= Shell layout (desktop sidebar + mobile drawer) ================= */

export function AppShell() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const mobileOpen = useAppStore((s) => s.mobileNavOpen)
  const setMobileOpen = useAppStore((s) => s.setMobileNavOpen)
  const streaming = useAppStore((s) => s.streamingChatId)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [online, setOnline] = useState(navigator.onLine)
  const location = useLocation()

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const sc = settings.shortcuts
    const match = (e: KeyboardEvent, combo: string) => {
      const parts = combo.toLowerCase().split('+')
      const mod = parts.includes('mod')
      const needCtrl = parts.includes('ctrl'), needShift = parts.includes('shift'), needAlt = parts.includes('alt')
      const key = parts[parts.length - 1]
      const hasMod = e.metaKey || e.ctrlKey
      if (mod && !hasMod) return false
      if (!mod && (needCtrl !== e.ctrlKey || needShift !== e.shiftKey)) return false
      return e.key.toLowerCase() === key
    }
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.matches('input, textarea, select') || target.isContentEditable
      if (match(e, sc.toggleSidebar)) { e.preventDefault(); useAppStore.getState().setSidebarCollapsed(!useAppStore.getState().sidebarCollapsed) }
      if (match(e, sc.newChat)) { e.preventDefault(); window.location.hash = '#/' }
      if (match(e, sc.search)) { e.preventDefault(); window.location.hash = '#/search' }
      if (match(e, sc.settings)) { e.preventDefault(); window.location.hash = '#/settings/general' }
      if (match(e, sc.palette)) { e.preventDefault(); document.getElementById('cmd-palette-input')?.focus() }
      if (e.key === 'Escape' && streaming) useChatStore.getState().stopGeneration()
      void typing
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [settings.shortcuts, streaming])

  const isChat = location.pathname.startsWith('/chat') || location.pathname === '/'
  const isWorkspace = location.pathname === '/workspace'

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <div className={cx('hidden md:block h-full', collapsed ? 'w-[56px]' : 'w-[var(--sidebar-w)]')}>
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[min(320px,85vw)] fade-up"><Sidebar mobile /></div>
        </div>
      )}

      <main className="flex min-w-0 grow flex-col">
        {!isWorkspace && (
          <div className="flex items-center gap-2 border-b border-line bg-surface-raised px-3 py-2 md:hidden">
            <button aria-label="Open navigation menu" className="rounded-lg p-2 hover:bg-surface-overlay" onClick={() => setMobileOpen(true)}><MenuIcon size={18} /></button>
            <span className="text-sm font-semibold truncate">{isChat ? 'Personal AI Studio' : document.title.replace(' · Personal AI Studio', '')}</span>
            {!online && <Badge tone="warn">offline</Badge>}
          </div>
        )}
        <div className="min-h-0 grow">
          <Outlet />
        </div>
        {!online && !isWorkspace && <OfflineBanner />}
      </main>

      {isChat && <VoiceModeBar />}
      <CommandPalette />
    </div>
  )
}

function OfflineBanner() {
  return (
    <div className="border-t border-line bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-300">
      You are offline. Saved conversations, memory, projects and settings remain fully available; AI generation resumes when the connection returns.
    </div>
  )
}

/* ================= Command palette ================= */

function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const loadChats = useChatStore((s) => s.loadChats)
  const chats = useChatStore((s) => s.chats)
  useEffect(() => { void loadChats() }, [loadChats])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setOpen((v) => !v); setQ('') } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])
  const commands = useMemo(() => {
    const base = [
      { label: 'New chat', run: () => nav('/') },
      { label: 'Open Search', run: () => nav('/search') },
      { label: 'Open Projects', run: () => nav('/projects') },
      { label: 'Open Assistants', run: () => nav('/assistants') },
      { label: 'Open Prompt Library', run: () => nav('/prompts') },
      { label: 'Open Code Workspace', run: () => nav('/workspace') },
      { label: 'Open Model Comparison', run: () => nav('/compare') },
      { label: 'Open Memory', run: () => nav('/memory') },
      { label: 'Open Settings', run: () => nav('/settings/general') },
      { label: 'Toggle theme', run: () => { const s = useAppStore.getState(); void s.updateSettings({ appearance: { ...s.settings.appearance, theme: s.settings.appearance.theme === 'dark' ? 'light' : 'dark' } }) } }
    ]
    const chatCmds = chats.slice(0, 30).map((c) => ({ label: `Go to chat: ${c.title}`, run: () => nav(`/chat/${c.id}`) }))
    const all = [...base, ...chatCmds]
    return q ? all.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : all
  }, [q, chats, nav])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[12vh] px-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="fade-up w-full max-w-lg rounded-2xl border border-line bg-surface-raised shadow-2xl">
        <Input id="cmd-palette-input" autoFocus placeholder="Type a command…" value={q} onChange={(e) => setQ(e.target.value)}
          className="h-11 rounded-b-none border-0 border-b bg-transparent" aria-label="Command palette search"
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && commands[0]) { commands[0].run(); setOpen(false) } }} />
        <div className="max-h-72 overflow-y-auto p-1.5">
          {commands.map((c) => (
            <button key={c.label} className="block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] text-ink-dim hover:bg-surface-overlay hover:text-ink" onClick={() => { c.run(); setOpen(false) }}>{c.label}</button>
          ))}
          {commands.length === 0 && <p className="px-3 py-4 text-center text-xs text-ink-faint">No matching commands.</p>}
        </div>
      </div>
    </div>
  )
}

/* ================= Settings shell with nested routes ================= */

const SETTINGS_TABS = [
  { path: 'general', label: 'General', icon: <Settings2 size={14} /> },
  { path: 'providers', label: 'Providers', icon: <Cpu size={14} /> },
  { path: 'models', label: 'Models', icon: <Zap size={14} /> },
  { path: 'router', label: 'Model Router', icon: <RouteIcon size={14} /> },
  { path: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
  { path: 'chat', label: 'Chat', icon: <MessageSquare size={14} /> },
  { path: 'voice', label: 'Voice', icon: <Mic size={14} /> },
  { path: 'memory', label: 'Memory', icon: <Brain size={14} /> },
  { path: 'data', label: 'Data & Storage', icon: <HardDrive size={14} /> },
  { path: 'privacy', label: 'Privacy', icon: <Lock size={14} /> },
  { path: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={14} /> },
  { path: 'advanced', label: 'Advanced', icon: <Bug size={14} /> },
  { path: 'about', label: 'About', icon: <Info size={14} /> }
]

export function SettingsLayout() {
  return (
    <div className="flex h-full min-h-0">
      <nav className="hidden w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-line bg-surface-raised p-2 lg:block" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <NavLink key={t.path} to={`/settings/${t.path}`} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]', isActive ? 'bg-surface-overlay text-ink font-medium' : 'text-ink-dim hover:text-ink hover:bg-surface-overlay/60')}>
            {t.icon}{t.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 grow overflow-y-auto">
        <div className="lg:hidden p-3"><Select aria-label="Choose settings section" className="w-full" value={window.location.hash.split('/').pop() || 'general'} onChange={(e) => { window.location.hash = `#/settings/${e.target.value}` }}>
          {SETTINGS_TABS.map((t) => <option key={t.path} value={t.path}>{t.label}</option>)}
        </Select></div>
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 pb-24"><Outlet /></div>
      </div>
    </div>
  )
}

/* ---------- General ---------- */
export function GeneralSettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  const toast = useAppStore((st) => st.toast)
  return (
    <Section title="General" desc="Application-wide defaults stored locally.">
      <Row label="Default language" hint="Used for voice recognition and interface locale hints.">
        <Select value={s.general.language} onChange={(e) => void up({ general: { ...s.general, language: e.target.value } })} aria-label="Default language">
          <option value="en">English</option><option value="bn">বাংলা (Bengali)</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="ar">العربية</option>
        </Select>
      </Row>
      <Row label="Default model" hint="Used when a conversation has no explicit model.">
        <ModelSelector value={s.general.defaultModelId || undefined} onChange={(m) => void up((st) => ({ general: { ...st.general, defaultModelId: m } }))} />
      </Row>
      <Row label="Startup page" hint="Which screen opens when the app starts.">
        <Select value={s.general.startupPage} onChange={(e) => void up({ general: { ...s.general, startupPage: e.target.value as never } })} aria-label="Startup page">
          <option value="chat">New Chat</option><option value="search">Search</option><option value="projects">Projects</option><option value="workspace">Code Workspace</option>
        </Select>
      </Row>
      <Row label="Auto-save drafts and settings"><Toggle checked={s.general.autoSave} label="Auto-save" onChange={(v) => void up({ general: { ...s.general, autoSave: v } })} /></Row>
      <Row label="Confirm before delete" hint="Show confirmation dialogs for destructive actions."><Toggle checked={s.general.confirmBeforeDelete} label="Confirm before delete" onChange={(v) => void up({ general: { ...s.general, confirmBeforeDelete: v } })} /></Row>
      <Row label="Default chat behavior"><Select value={s.chat.tempChat ? 'temp' : 'persist'} onChange={(e) => void up({ chat: { ...s.chat, tempChat: e.target.value === 'temp' } })} aria-label="Default chat behavior"><option value="persist">Save conversations</option><option value="temp">Start temporary (not saved)</option></Select></Row>
      <button className="text-xs text-ink-faint underline" onClick={() => { toast('info', 'Heads up', 'Export a backup first — this resets settings only, not your chats.'); void up((st) => ({ ...st, general: { ...DEFAULTS.general }, appearance: { ...DEFAULTS.appearance }, chat: { ...DEFAULTS.chat }, voice: { ...DEFAULTS.voice }, memory: { ...DEFAULTS.memory }, router: { ...DEFAULTS.router }, advanced: { ...DEFAULTS.advanced }, shortcuts: { ...DEFAULTS.shortcuts } })) }}>Reset settings to defaults</button>
    </Section>
  )
}

/* ---------- Router ---------- */
export function RouterSettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  const [stats, setStats] = useState<RouterStatsEntry[]>([])
  const [fallbackOptions, setFallbackOptions] = useState<{ id: string; name: string }[]>([])
  const reloadStats = useCallback(() => setStats(getRouterStats()), [])
  useEffect(() => { reloadStats(); const iv = setInterval(reloadStats, 4000); void db.models.filter((m) => m.enabled).toArray().then((ms) => setFallbackOptions(ms.map((m) => ({ id: m.id, name: m.name })))); return () => clearInterval(iv) }, [reloadStats])

  const r = s.router
  const setR = (patch: Partial<typeof r>) => void up((st) => ({ router: { ...st.router, ...patch } }))

  return (
    <Section title="AI Model Router" desc="Independent routing engine: manual selection, automatic failover, or capability-based smart routing.">
      <Row label="Routing mode">
        <Tabs tabs={[{ id: 'manual', label: 'Manual' }, { id: 'failover', label: 'Auto Failover' }, { id: 'smart', label: 'Smart Routing' }]} value={r.mode} onChange={(m) => setR({ mode: m as never })} />
      </Row>
      <Row label="Primary model"><ModelSelector value={r.primaryModelId || undefined} onChange={(m) => setR({ primaryModelId: m })} /></Row>
      <Row label="Secondary model"><ModelSelector value={r.secondaryModelId || undefined} onChange={(m) => setR({ secondaryModelId: m })} /></Row>
      <Row label="Fallback models" hint="Tried in order after primary and secondary fail.">
        <div className="space-y-1 w-full max-w-xs">
          {r.fallbackModelIds.map((id, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select value={id} onChange={(e) => setR({ fallbackModelIds: r.fallbackModelIds.map((x, j) => (j === i ? e.target.value : x)) })} className="grow text-xs" aria-label={`Fallback ${i + 1}`}>
                {fallbackOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <button aria-label="Remove fallback" className="text-ink-faint hover:text-red-400" onClick={() => setR({ fallbackModelIds: r.fallbackModelIds.filter((_, j) => j !== i) })}><XCircle size={15} /></button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setR({ fallbackModelIds: [...r.fallbackModelIds, fallbackOptions[0]?.id ?? ''] })} disabled={!fallbackOptions.length}>+ Add fallback</Button>
        </div>
      </Row>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Maximum retries per request"><Input type="number" min={0} max={5} value={r.maxRetries} onChange={(e) => setR({ maxRetries: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
        <Field label="Request timeout (ms)"><Input type="number" min={5000} step={5000} value={r.timeoutMs} onChange={(e) => setR({ timeoutMs: Number(e.target.value) || 60000 })} /></Field>
        <Field label="Retry delay (ms)"><Input type="number" min={0} value={r.retryDelayMs} onChange={(e) => setR({ retryDelayMs: Number(e.target.value) || 0 })} /></Field>
        <Field label="Failure cooldown (ms)" hint="A failed model is skipped until the cooldown expires."><Input type="number" min={0} step={5000} value={r.failureCooldownMs} onChange={(e) => setR({ failureCooldownMs: Number(e.target.value) || 0 })} /></Field>
      </div>
      <Row label="Preferred capabilities" hint="Used by Smart Routing task classification.">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {['streaming', 'vision', 'reasoning', 'json', 'tools'].map((k) => <Badge key={k} tone={k === 'streaming' || k === 'reasoning' ? 'accent' : 'default'}>{k}</Badge>)}
        </div>
      </Row>

      <div className="mt-6 rounded-xl border border-line bg-surface-raised p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold inline-flex items-center gap-2"><Activity size={14} /> Router dashboard</h4>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={reloadStats}><RefreshCw size={12} /> Refresh</Button>
            <Button size="sm" variant="ghost" onClick={() => { clearRouterStats(); reloadStats() }}>Clear</Button>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Stat label="Current mode" value={r.mode} />
          <Stat label="Attempts logged" value={String(stats.length)} />
          <Stat label="Success rate" value={stats.length ? `${Math.round((stats.filter((x) => x.ok).length / stats.length) * 100)}%` : '—'} />
          <Stat label="Avg latency" value={avgLatency(stats)} />
        </div>
        {stats.length === 0 ? <p className="text-xs text-ink-faint">No requests routed yet. Stats appear here after real API calls.</p> : (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-surface-overlay"><tr className="text-left text-ink-faint"><th className="px-2 py-1.5">Time</th><th className="px-2 py-1.5">Model</th><th className="px-2 py-1.5">Task</th><th className="px-2 py-1.5">Latency</th><th className="px-2 py-1.5">Result</th></tr></thead>
              <tbody>{stats.slice(0, 40).map((x, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1 whitespace-nowrap">{new Date(x.at).toLocaleTimeString()}</td>
                  <td className="px-2 py-1">{x.modelName}</td>
                  <td className="px-2 py-1">{x.task}</td>
                  <td className="px-2 py-1">{x.ms != null ? `${x.ms}ms` : '—'}</td>
                  <td className="px-2 py-1">{x.ok ? <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={11} /> ok</span> : <span className="text-red-400 inline-flex items-center gap-1 truncate max-w-[180px]" title={x.error}><XCircle size={11} /> {(x.error ?? '').slice(0, 40)}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-faint inline-flex items-center gap-1"><Timer size={11} /> Recent failures above include Retry-After respected rate limits (429), auth failures marked “needs attention”, timeouts and network errors. Requests are never retried endlessly.</p>
      </div>
    </Section>
  )
}

function avgLatency(stats: RouterStatsEntry[]) {
  const ok = stats.filter((s) => s.ok && s.ms != null)
  if (!ok.length) return '—'
  return `${Math.round(ok.reduce((a, b) => a + (b.ms ?? 0), 0) / ok.length)}ms`
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-surface-overlay px-2.5 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div><div className="font-semibold capitalize truncate">{value}</div></div>
}

/* ---------- Appearance ---------- */
export function AppearanceSettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  const a = s.appearance
  const setA = (patch: Partial<typeof a>) => void up((st) => ({ appearance: { ...st.appearance, ...patch } }))
  return (
    <Section title="Appearance" desc="Theme, typography and layout density.">
      <Row label="Theme"><Tabs tabs={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }]} value={a.theme} onChange={(t) => setA({ theme: t as never })} /></Row>
      <Row label="Accent color"><div className="flex items-center gap-2">{['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899'].map((c) => <button key={c} aria-label={`Accent ${c}`} className={cx('h-7 w-7 rounded-full border-2', a.accent === c ? 'border-white' : 'border-transparent')} style={{ background: c }} onClick={() => setA({ accent: c })} />)}<input type="color" aria-label="Custom accent color" value={a.accent} onChange={(e) => setA({ accent: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" /></div></Row>
      <Row label="Font family"><Select value={a.fontFamily} onChange={(e) => setA({ fontFamily: e.target.value })} aria-label="Font family" className="w-56"><option value="system-ui">System UI</option><option value="'Segoe UI', sans-serif">Segoe UI</option><option value="Inter, system-ui">Inter</option><option value="Georgia, serif">Georgia (serif)</option><option value="'Courier New', monospace">Monospace</option></Select></Row>
      <Row label="Font size"><Tabs tabs={[{ id: 'sm', label: 'Small' }, { id: 'base', label: 'Medium' }, { id: 'lg', label: 'Large' }]} value={a.fontSize} onChange={(v) => setA({ fontSize: v as never })} /></Row>
      <Row label="Message width"><Tabs tabs={[{ id: 'narrow', label: 'Narrow' }, { id: 'normal', label: 'Normal' }, { id: 'wide', label: 'Wide' }]} value={a.messageWidth} onChange={(v) => setA({ messageWidth: v as never })} /></Row>
      <Row label="Sidebar width"><input type="range" min={220} max={360} step={10} value={a.sidebarWidth} onChange={(e) => setA({ sidebarWidth: Number(e.target.value) })} aria-label="Sidebar width" className="w-44 accent-[var(--accent)]" /><span className="text-xs text-ink-faint ml-2">{a.sidebarWidth}px</span></Row>
      <Row label="Chat density"><Tabs tabs={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }]} value={a.density} onChange={(v) => setA({ density: v as never })} /></Row>
      <Row label="Animations"><Toggle checked={a.animations} label="Animations" onChange={(v) => setA({ animations: v })} /></Row>
    </Section>
  )
}

/* ---------- Chat ---------- */
export function ChatSettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  const c = s.chat
  const setC = (patch: Partial<typeof c>) => void up((st) => ({ chat: { ...st.chat, ...patch } }))
  return (
    <Section title="Chat" desc="Composer and rendering behavior.">
      <Row label="Enter to send" hint="Off: Enter adds a newline, Ctrl/Cmd+Enter sends."><Toggle checked={c.enterToSend} label="Enter to send" onChange={(v) => setC({ enterToSend: v })} /></Row>
      <Row label="Markdown rendering"><Toggle checked={c.markdown} label="Markdown" onChange={(v) => setC({ markdown: v })} /></Row>
      <Row label="Syntax highlighting"><Toggle checked={c.codeHighlight} label="Code highlighting" onChange={(v) => setC({ codeHighlight: v })} /></Row>
      <Row label="Auto-scroll to latest response"><Toggle checked={c.autoScroll} label="Auto-scroll" onChange={(v) => setC({ autoScroll: v })} /></Row>
      <Row label="Auto-generate conversation titles"><Toggle checked={c.autoTitle} label="Auto title" onChange={(v) => setC({ autoTitle: v })} /></Row>
      <Row label="Temporary chats by default" hint="New conversations are not persisted unless toggled off in the composer."><Toggle checked={c.tempChat} label="Temporary default" onChange={(v) => setC({ tempChat: v })} /></Row>
    </Section>
  )
}

/* ---------- Voice ---------- */
export function VoiceSettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  const v = s.voice
  const setV = (patch: Partial<typeof v>) => void up((st) => ({ voice: { ...st.voice, ...patch } }))
  const tts = useTTS()
  return (
    <Section title="Voice" desc="Browser engines are used where supported. Optional local engines can be configured below.">
      <div className="rounded-lg border border-line bg-surface-overlay p-3 text-xs space-y-1">
        <div className="flex items-center gap-2">{speechRecognitionSupported() ? <Badge tone="ok">Speech-to-text available</Badge> : <Badge tone="warn">Not in this browser</Badge>}<span className="text-ink-dim">Web Speech API recognition works best in Chrome / Edge.</span></div>
        <div className="flex items-center gap-2">{ttsSupported() ? <Badge tone="ok">Text-to-speech available</Badge> : <Badge tone="warn">Not in this browser</Badge>}<span className="text-ink-dim">SpeechSynthesis voices come from your operating system.</span></div>
      </div>
      <Row label="Recognition language"><Select value={v.sttLanguage} onChange={(e) => setV({ sttLanguage: e.target.value })} aria-label="Recognition language" className="w-48"><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="bn-BD">বাংলা (Bangladesh)</option><option value="bn-IN">বাংলা (India)</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option><option value="ar-SA">العربية</option></Select></Row>
      <Row label="Speech-to-text engine"><Select value={v.engine} onChange={(e) => setV({ engine: e.target.value as never })} aria-label="STT engine" className="w-56"><option value="browser">Browser (Web Speech API)</option><option value="whisper-local">Local Whisper.cpp server</option></Select></Row>
      {v.engine === 'whisper-local' && <WhisperSetup />}
      <Row label="Text-to-speech voice">
        <Select value={v.ttsVoice} onChange={(e) => setV({ ttsVoice: e.target.value })} aria-label="TTS voice" className="w-64">
          <option value="">System default</option>
          {tts.voices.map((vo) => <option key={vo.voiceURI} value={vo.voiceURI}>{vo.name} ({vo.lang})</option>)}
        </Select>
      </Row>
      <Row label="Playback speed"><input type="range" min={0.5} max={2} step={0.1} value={v.ttsRate} onChange={(e) => setV({ ttsRate: Number(e.target.value) })} className="w-40 accent-[var(--accent)]" aria-label="Playback speed" /><span className="text-xs text-ink-faint ml-2">{v.ttsRate.toFixed(1)}×</span></Row>
      <Row label="Auto-read assistant responses"><Toggle checked={v.autoRead} label="Auto read" onChange={(val) => setV({ autoRead: val })} /></Row>
      <Row label="Piper TTS (optional offline)"><span className="text-xs text-ink-dim max-w-xs">Integration interface ready: run a Piper HTTP server locally and paste its URL — responses will be synthesized offline.</span></Row>
      <PiperSetup />
    </Section>
  )
}

function WhisperSetup() {
  const [url, setUrl] = useState(localStorage.getItem('whisperUrl') ?? 'http://localhost:8080/inference')
  const [status, setStatus] = useState<string | null>(null)
  const test = async () => {
    localStorage.setItem('whisperUrl', url)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: '' }) })
      setStatus(r.ok ? 'Server reachable.' : `HTTP ${r.status} — check the whisper.cpp server port and CORS flags (--config with Access-Control-Allow-Origin).`)
    } catch { setStatus('Cannot reach the server. Start whisper.cpp server (e.g. `whisper-cpp-server -m ggml-model.bin --host 127.0.0.1 --port 8080`). Audio transcription also needs HTTPS or localhost for microphone access.') }
  }
  return (
    <div className="rounded-lg border border-line bg-surface-overlay p-3 space-y-2">
      <p className="text-xs text-ink-dim">Optional offline transcription via a local whisper.cpp server. Nothing leaves your machine.</p>
      <div className="flex gap-2"><Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs" aria-label="Whisper server URL" /><Button size="sm" variant="secondary" onClick={() => void test()}>Test</Button></div>
      {status && <p className="text-xs text-ink-faint">{status}</p>}
    </div>
  )
}

function PiperSetup() {
  const [url, setUrl] = useState(localStorage.getItem('piperUrl') ?? '')
  return (
    <div className="rounded-lg border border-line bg-surface-overlay p-3 space-y-2">
      <p className="text-xs text-ink-dim">Optional offline synthesis via a local Piper HTTP server (POST /tts → WAV).</p>
      <div className="flex gap-2"><Input placeholder="http://localhost:5000/tts" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs" aria-label="Piper server URL" onBlur={() => localStorage.setItem('piperUrl', url)} /></div>
    </div>
  )
}

/* ---------- Memory settings ---------- */
export function MemorySettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  const m = s.memory
  const setM = (patch: Partial<typeof m>) => void up((st) => ({ memory: { ...st.memory, ...patch } }))
  return (
    <Section title="Memory" desc="Control the three isolated memory scopes and injection policy.">
      <Row label="Global memory" hint="Approved facts shared across every conversation."><Toggle checked={m.globalEnabled} label="Global memory" onChange={(v) => setM({ globalEnabled: v })} /></Row>
      <Row label="Conversation memory" hint="Per-chat facts. Never visible to other conversations."><Toggle checked={m.chatEnabled} label="Chat memory" onChange={(v) => setM({ chatEnabled: v })} /></Row>
      <Row label="Project memory" hint="Shared inside one project's conversations."><Toggle checked={m.projectEnabled} label="Project memory" onChange={(v) => setM({ projectEnabled: v })} /></Row>
      <Row label="Require approval before storing automatically" hint="When on, nothing is memorized without your explicit action."><Toggle checked={m.approvalRequired} label="Approval required" onChange={(v) => setM({ approvalRequired: v })} /></Row>
      <p className="text-xs text-ink-dim rounded-lg border border-line bg-surface-overlay p-3">Context injection order before each request: system instructions → global instructions/memory → project instructions/memory → conversation memory → recent messages (trimmed to fit the model context window) → current user message. Manage entries on the <NavLink to="/memory" className="underline text-accent">Memory page</NavLink>.</p>
    </Section>
  )
}

/* ---------- Data & storage ---------- */
export function DataSettings() {
  const toast = useAppStore((st) => st.toast)
  const [usage, setUsage] = useState<{ bytes: number; quota: number } | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [importFile, setImportFile] = useState<{ text: string; payload?: ReturnType<typeof validateBackup>['payload']; error?: string } | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const reload = useCallback(async () => {
    if (navigator.storage?.estimate) setUsage(await navigator.storage.estimate())
    setCounts({ chats: await db.chats.count(), messages: await db.messages.count(), providers: await db.providers.count(), models: await db.models.count(), memories: await db.memories.count(), projects: await db.projects.count(), prompts: await db.prompts.count(), assistants: await db.assistants.count() })
  }, [])
  useEffect(() => { void reload() }, [reload])

  return (
    <Section title="Data & Storage" desc="Everything lives in IndexedDB on this device. No backend, no account.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(counts).map(([k, v]) => <Stat key={k} label={k} value={String(v)} />)}
      </div>
      {usage && (
        <div className="rounded-lg border border-line bg-surface-overlay p-3 text-xs">
          <div className="flex justify-between"><span>Storage used: <strong>{formatBytes(usage.bytes)}</strong></span><span>Quota: {formatBytes(usage.quota)}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-raised"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (usage.bytes / (usage.quota || 1)) * 100)}%` }} /></div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={async () => { await exportJSON(undefined, undefined, {}, false); toast('success', 'Backup exported', 'Full JSON backup (API keys excluded).') }}><Download size={14} /> Export all (JSON)</Button>
        <Button variant="secondary" onClick={async () => { await exportZIP(); toast('success', 'ZIP exported', 'backup.json + Markdown transcripts included.') }}><FileJson size={14} /> Export ZIP</Button>
        <label className="cursor-pointer">
          <Button variant="secondary" onClick={() => document.getElementById('import-file')?.click()}><Upload size={14} /> Import backup</Button>
          <input id="import-file" type="file" accept=".json,.zip" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return
            let text = ''
            if (f.name.endsWith('.zip')) {
              const JSZip = (await import('jszip')).default
              const zip = await JSZip.loadAsync(await f.arrayBuffer())
              const entry = zip.file('backup.json'); if (!entry) { toast('error', 'Invalid ZIP', 'No backup.json found inside.'); return }
              text = await entry.async('string')
            } else text = await f.text()
            const res = validateBackup(text)
            setImportFile({ text, payload: res.payload, error: res.error })
            e.target.value = ''
          }} />
        </label>
        <Button variant="danger" onClick={() => setConfirmWipe(true)}><Eraser size={14} /> Clear all data</Button>
      </div>

      <ImportModal file={importFile} onClose={() => setImportFile(null)} onDone={(rep) => { setReport(rep); setImportFile(null); void reload() }} />
      <Modal open={!!report} onClose={() => setReport(null)} title="Import report" footer={<Button variant="primary" onClick={() => setReport(null)}>Done</Button>}>
        {report && (
          <div className="space-y-2 text-sm">
            <p className="text-ink-dim">Restore finished. Added records:</p>
            <pre className="rounded-lg bg-surface-overlay border border-line p-3 text-xs font-mono">{JSON.stringify(report.added, null, 2)}</pre>
            <p className="text-xs text-ink-faint">Skipped duplicate IDs: {report.skippedDuplicates} — existing data was never overwritten silently.</p>
            {report.errors.map((er) => <p key={er} className="text-xs text-red-400">{er}</p>)}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={confirmWipe} onClose={() => setConfirmWipe(false)} danger title="Clear ALL local data?"
        message="This deletes every conversation, provider (including API keys), model, memory, project, prompt, assistant and setting from this browser. Export a backup first."
        onConfirm={async () => { await db.delete(); await db.open(); toast('success', 'All local data cleared'); void reload() }} />
    </Section>
  )
}

function ImportModal({ file, onClose, onDone }: { file: { text: string; payload?: ReturnType<typeof validateBackup>['payload']; error?: string } | null; onClose: () => void; onDone: (r: ImportReport) => void }) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  if (!file) return null
  if (file.error) return (
    <Modal open onClose={onClose} title="Import failed" footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div className="flex items-start gap-2 text-sm text-red-400"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{file.error}</div>
    </Modal>
  )
  const p = file.payload!
  return (
    <Modal open onClose={onClose} title="Restore backup" wide footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); const rep = await importBackup(p, mode, {}); setBusy(false); onDone(rep) }}>Confirm import</Button>
    </>}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <Stat label="From app version" value={p.version} />
          <Stat label="Schema version" value={`v${p.schemaVersion} (app v${SCHEMA_LABEL})`} />
          <Stat label="Export date" value={new Date(p.exportedAt).toLocaleString()} />
          <Stat label="Includes API keys" value={p.includesKeys ? 'YES — review before restoring' : 'no (keys excluded)'} />
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Contents</h4>
          <div className="flex flex-wrap gap-1.5">{Object.entries(p.counts).filter(([, n]) => n > 0).map(([k, n]) => <Badge key={k}>{k}: {n}</Badge>)}</div>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Duplicate handling</h4>
          <p className="text-xs text-ink-dim mb-2">Existing records with matching IDs are skipped (never silently overwritten).</p>
          <Tabs tabs={[{ id: 'merge', label: 'Merge (skip duplicates)' }, { id: 'replace', label: 'Replace all chats/messages first' }]} value={mode} onChange={(m) => setMode(m as never)} />
          {mode === 'replace' && <p className="mt-2 text-xs text-amber-400">Replace mode deletes current conversations before restoring this backup's conversations. Other categories still merge safely.</p>}
        </div>
      </div>
    </Modal>
  )
}
const SCHEMA_LABEL = '1'

/* ---------- Privacy ---------- */
export function PrivacySettings() {
  const [providers, setProviders] = useState<{ id: string; name: string; baseUrl: string; apiKey: string }[]>([])
  const toast = useAppStore((st) => st.toast)
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  useEffect(() => { void db.providers.toArray().then(setProviders) }, [])
  return (
    <Section title="Privacy" desc="Local-first data handling with honest security limits.">
      <div className="rounded-lg border border-line bg-surface-overlay p-3.5 text-[13px] space-y-2">
        <p><strong>What stays on this device:</strong> conversations, messages, memories, projects, prompts, assistants, settings and provider configurations are stored in this browser's IndexedDB only. There is no analytics or third-party tracking.</p>
        <p><strong>What leaves this device:</strong> anything you send to an AI provider goes to that provider's servers over HTTPS. Your configured providers receive the message content, injected memory context and attached document text you choose to include.</p>
        <p className="text-amber-300"><strong>Honest limitation:</strong> browser-only storage cannot guarantee absolute secrecy of API keys against malicious scripts on this origin or a compromised browser profile. For stronger protection enable the encrypted vault below.</p>
      </div>
      <Row label="Include API keys in exports" hint="Off by default — backups exclude secrets unless explicitly enabled."><Toggle checked={s.advanced.exportIncludesKeys} label="Export includes keys" onChange={(v) => void up((st) => ({ advanced: { ...st.advanced, exportIncludesKeys: v } }))} /></Row>
      <div className="rounded-xl border border-line bg-surface-raised p-4 space-y-3">
        <h4 className="text-sm font-semibold">Encrypted credential vault (optional)</h4>
        <p className="text-xs text-ink-dim">Wraps stored API keys with AES-GCM using a key derived from your passphrase (PBKDF2, 210k iterations, Web Crypto). The passphrase is never stored — it must be entered after reloads to unlock sending requests.</p>
        <VaultControls providers={providers.map((p) => ({ ...p, apiKey: maskKeyStatic(p.apiKey) }))} onChanged={() => void db.providers.toArray().then(setProviders)} toast={toast} />
      </div>
      <div className="rounded-xl border border-line bg-surface-raised p-4 space-y-2">
        <h4 className="text-sm font-semibold">Stored credentials (masked)</h4>
        {providers.length === 0 ? <p className="text-xs text-ink-faint">No providers configured.</p> : providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs"><span className="font-medium">{p.name}</span><code className="rounded bg-surface-overlay border border-line px-2 py-0.5 font-mono">{maskKeyStatic(p.apiKey)}</code><span className="text-ink-faint truncate">{p.baseUrl}</span></div>
        ))}
      </div>
      <Button variant="danger" onClick={async () => { if (window.confirm('Clear every stored API key? Providers remain configured but unusable until re-entered.')) { for (const p of providers) await db.providers.update(p.id, { apiKey: '', connectionStatus: 'unknown' }); toast('success', 'Sensitive data cleared'); void db.providers.toArray().then(setProviders) } }}><Trash2 size={14} /> Clear all API keys now</Button>
    </Section>
  )
}
function maskKeyStatic(k: string) { return !k ? '(none)' : k.startsWith('enc:') ? '🔒 encrypted at rest' : k.length <= 8 ? '••••' : `${k.slice(0, 4)}${'•'.repeat(Math.min(12, k.length - 8))}${k.slice(-4)}` }

function VaultControls({ providers, onChanged, toast }: { providers: { id: string; name: string; apiKey: string }[]; onChanged: () => void; toast: ReturnType<typeof useAppStore.getState>['toast'] }) {
  const [pass, setPass] = useState('')
  const [locked, setLocked] = useState<boolean | null>(null)
  const busy = useRef(false)
  const derive = async (phrase: string, salt: Uint8Array) => {
    const kb = await crypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 210000, hash: 'SHA-256' }, kb, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  }
  const encryptAll = async () => {
    if (pass.length < 8) { toast('error', 'Weak passphrase', 'Use at least 8 characters.'); return }
    busy.current = true
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const key = await derive(pass, salt)
      const all = await db.providers.toArray()
      for (const p of all) {
        if (!p.apiKey || p.apiKey.startsWith('enc:')) continue
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(p.apiKey))
        await db.providers.update(p.id, { apiKey: `enc:${btoa(String.fromCharCode(...salt, ...iv, ...new Uint8Array(ct)))}` })
      }
      sessionStorage.setItem('vaultSalt', btoa(String.fromCharCode(...salt)))
      setLocked(false); onChanged(); toast('success', 'Vault enabled', 'All plaintext keys were encrypted with your passphrase.')
    } finally { busy.current = false }
  }
  const decryptAll = async () => {
    const saltB = sessionStorage.getItem('vaultSalt')
    if (!saltB) { toast('error', 'Vault locked', 'Restart encryption or re-enter passphrase after enabling.'); return }
    const salt = Uint8Array.from(atob(saltB), (c) => c.charCodeAt(0))
    const key = await derive(pass, salt)
    const all = await db.providers.toArray()
    let okCount = 0
    for (const p of all) {
      if (!p.apiKey.startsWith('enc:')) continue
      try {
        const raw = Uint8Array.from(atob(p.apiKey.slice(4), (c) => c.charCodeAt(0)))
        const iv = raw.slice(16, 28); const ct = raw.slice(28)
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
        await db.providers.update(p.id, { apiKey: new TextDecoder().decode(pt) }); okCount++
      } catch { /* wrong passphrase for this record */ }
    }
    if (okCount) { setLocked(false); onChanged(); toast('success', 'Vault unlocked', `${okCount} key(s) available for requests this session.`) }
    else { setLocked(true); toast('error', 'Unlock failed', 'Incorrect passphrase — keys remain encrypted.') }
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input type="password" placeholder="Vault passphrase" value={pass} onChange={(e) => setPass(e.target.value)} className="max-w-xs" aria-label="Vault passphrase" />
        <Button variant="primary" onClick={() => void encryptAll()} disabled={!pass || busy.current}>Encrypt keys</Button>
        <Button variant="secondary" onClick={() => void decryptAll()} disabled={!pass || busy.current}>Unlock</Button>
      </div>
      {locked === true && <p className="text-xs text-red-400">Wrong passphrase.</p>}
      {locked === false && <p className="text-xs text-emerald-400">Vault active — keys decrypt in-memory for requests only.</p>}
      <p className="text-[11px] text-ink-faint">{providers.length} provider(s) configured.</p>
    </div>
  )
}

/* ---------- Shortcuts ---------- */
export function ShortcutSettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  return (
    <Section title="Keyboard Shortcuts" desc="Combos use mod = Ctrl (⌘ on macOS). Edit combos and they persist immediately.">
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(s.shortcuts) as (keyof typeof s.shortcuts)[]).map((k) => (
          <Field key={k} label={k}>
            <Input value={s.shortcuts[k]} onChange={(e) => void up((st) => ({ shortcuts: { ...st.shortcuts, [k]: e.target.value } }))} className="font-mono text-xs" aria-label={`Shortcut for ${k}`} />
          </Field>
        ))}
      </div>
      <p className="text-xs text-ink-faint">Send / Stop during generation: Enter follows the Chat setting; Escape always stops generation.</p>
    </Section>
  )
}

/* ---------- Advanced ---------- */
export function AdvancedSettings() {
  const s = useAppStore((st) => st.settings)
  const up = useAppStore((st) => st.updateSettings)
  const toast = useAppStore((st) => st.toast)
  const [logs, setLogs] = useState<{ id: string; ts: number; level: string; msg: string }[]>([])
  useEffect(() => { void db.usageLogs.orderBy('ts').reverse().limit(60).toArray().then(setLogs) }, [])
  return (
    <Section title="Advanced" desc="Diagnostics for power users.">
      <Row label="Debug mode" hint="Verbose console logging (secrets are never logged)."><Toggle checked={s.advanced.debugMode} label="Debug mode" onChange={(v) => void up((st) => ({ advanced: { ...st.advanced, debugMode: v } }))} /></Row>
      <Row label="Allow “Save Without Testing”" hint="Adds an explicit untested-provider option in the Add Provider dialog."><Toggle checked={s.advanced.allowSaveUntested} label="Allow save untested" onChange={(v) => void up((st) => ({ advanced: { ...st.advanced, allowSaveUntested: v } }))} /></Row>
      <div className="flex gap-2 flex-wrap">
        <Button variant="secondary" onClick={() => { toast(navigator.onLine ? 'success' : 'warning', navigator.onLine ? 'Network OK — online' : 'Currently offline'); void db.usageLogs.add({ id: nanoid(), ts: Date.now(), level: 'info', msg: `diagnostics: online=${navigator.onLine}` }) }}><Activity size={14} /> Run network diagnostics</Button>
        <Button variant="secondary" onClick={async () => { const n = await db.usageLogs.count(); toast('info', 'Cache management', `${n} log entries. Service worker cache refresh scheduled.`); if ('caches' in window) { const ks = await caches.keys(); for (const k of ks) await caches.delete(k) } }}><Eraser size={14} /> Purge caches</Button>
        <Button variant="secondary" onClick={async () => { await db.messages.where('status').equals('streaming').modify({ status: 'stopped' }); await db.vacuum(); toast('success', 'Database maintenance done', 'Stale streaming rows finalized and IndexedDB vacuumed.') }}><Database size={14} /> Database maintenance</Button>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">Provider / API logs</h4>
        {logs.length === 0 ? <p className="text-xs text-ink-faint">No log entries yet.</p> : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-surface-overlay p-2 font-mono text-[11px] space-y-1">
            {logs.map((l) => <div key={l.id} className={cx(l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-ink-dim')}>[{new Date(l.ts).toLocaleTimeString()}] {l.msg}</div>)}
          </div>
        )}
      </div>
      <Row label="Experimental features" hint="Nothing risky is enabled by default."><Badge>none active</Badge></Row>
    </Section>
  )
}

/* ---------- About ---------- */
export function AboutSettings() {
  return (
    <Section title="About" desc="Build and license information.">
      <div className="flex items-center gap-3">
        <img src="/icons/icon.svg" alt="" className="h-14 w-14 rounded-2xl" />
        <div><h3 className="font-bold text-lg">Personal AI Studio</h3><p className="text-sm text-ink-dim">Your Models. Your Intelligence. Your Workspace.</p><Badge tone="accent">v{APP_VERSION} · schema v{SCHEMA_LABEL} · build {__BUILD_TIME__}</Badge></div>
      </div>
      <p className="text-sm text-ink-dim">A local-first multi-provider AI chat platform. No mandatory backend, no subscription, no hardcoded credentials.</p>
      <div className="rounded-lg border border-line bg-surface-overlay p-3 text-xs space-y-1">
        <strong className="text-[13px]">Open-source libraries</strong>
        <p>React (MIT) · Vite (MIT) · TypeScript (Apache-2.0) · Tailwind CSS (MIT) · Dexie.js (Apache-2.0) · Zustand (MIT) · marked (MIT) · DOMPurify (Apache-2.0/MPL) · highlight.js (BSD-3) · Monaco Editor (MIT) · jsPDF (MIT) · JSZip (MIT/GPLv3) · mammoth (BSD-2) · pdfjs-dist (Apache-2.0) · SheetJS xlsx (Apache-2.0) · lucide-react (ISC)</p>
      </div>
      <p className="text-xs text-ink-faint">Credits: built with free, community-maintained engines. Voice features rely on browser-provided Web Speech / SpeechSynthesis APIs; optional offline engines (whisper.cpp, Piper) are separate open-source projects you install yourself.</p>
    </Section>
  )
}

/* ---------- shared bits ---------- */
import { DEFAULT_SETTINGS as DEFAULTS } from '@/utils'
declare const __BUILD_TIME__: string

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div><h2 className="text-lg font-bold">{title}</h2><p className="text-sm text-ink-dim">{desc}</p></div>
      {children}
    </div>
  )
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <div className="min-w-[200px] max-w-md grow"><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-ink-faint mt-0.5">{hint}</div>}</div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  )
}

