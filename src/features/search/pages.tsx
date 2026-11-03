import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '@/database/db'
import { cx, Button, Select, Input, Badge, Spinner, EmptyState, Tabs } from '@/components/ui'
import { Markdown } from '@/components/common/Markdown'
import { ModelSelector } from '@/features/models/ModelSelector'
import { useAppStore } from '@/stores/app'
import { routeAndStream } from '@/services/ai/router/engine'
import { nanoid } from 'nanoid'
import { Columns2, Play, Copy, RotateCcw, Trash2, Save, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

interface Col { key: string; modelId: string; modelName: string; providerName: string; text: string; status: 'idle' | 'running' | 'done' | 'error'; error?: string; ms?: number }

export function ComparePage() {
  const [prompt, setPrompt] = useState((window as unknown as { __comparePrefill?: string }).__comparePrefill ?? '')
  const [cols, setCols] = useState<Col[]>([])
  const [modelPick, setModelPick] = useState<string>('')
  const aborters = useRef<Record<string, AbortController>>({})
  const toast = useAppStore((s) => s.toast)
  useEffect(() => { (window as unknown as { __comparePrefill?: string }).__comparePrefill = undefined }, [])

  const runOne = useCallback(async (col: Col, promptText: string) => {
    const ctrl = new AbortController()
    aborters.current[col.key] = ctrl
    setCols((cs) => cs.map((c) => (c.key === col.key ? { ...c, text: '', status: 'running', error: undefined, ms: undefined } : c)))
    const t0 = performance.now()
    const settings = useAppStore.getState().settings
    const res = await routeAndStream({
      // Pin routing to this column's model only (manual mode with that model first).
      router: { ...settings.router, mode: 'manual', primaryModelId: col.modelId, fallbackModelIds: [], maxRetries: 0 },
      chatModelId: col.modelId,
      messages: [{ role: 'user', content: promptText }],
      signal: ctrl.signal,
      onDelta: (d) => setCols((cs) => cs.map((c) => (c.key === col.key ? { ...c, text: c.text + d } : c)))
    })
    const ms = Math.round(performance.now() - t0)
    setCols((cs) => cs.map((c) => (c.key === col.key ? { ...c, status: res.error && !c.text ? 'error' : 'done', error: res.error, ms } : c)))
  }, [])

  const addAndRun = async () => {
    if (!prompt.trim()) { toast('warning', 'Enter a prompt first'); return }
    let ids: string[] = []
    if (modelPick === '__all_selected__') return
    if (modelPick) ids = [modelPick]
    else ids = cols.map((c) => c.modelId)
    if (ids.length === 0) { toast('warning', 'Select at least one model', 'Only models you explicitly select are called — the app never silently runs every model.'); return }
    for (const id of ids) {
      const m = await db.models.get(id)
      if (!m) continue
      const p = await db.providers.get(m.providerId)
      const col: Col = { key: nanoid(), modelId: id, modelName: m.name, providerName: p?.name ?? '?', text: '', status: 'idle' }
      setCols((cs) => [...cs.filter((c) => c.modelId !== id), col])
      void runOne(col, prompt)
    }
  }

  const stopAll = () => { Object.values(aborters.current).forEach((a) => a.abort()) }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-bold inline-flex items-center gap-2"><Columns2 size={19} /> Multi-Model Comparison</h2>
        <p className="text-sm text-ink-dim">Send the same prompt to specific models you choose. Each call uses your own API credentials and may incur provider charges.</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-raised p-3 space-y-3">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Type the prompt to compare…" className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm outline-none focus:border-accent" aria-label="Comparison prompt" />
        <div className="flex flex-wrap items-center gap-2">
          <ModelSelector value={modelPick || undefined} onChange={setModelPick} compact />
          {!modelPick && cols.length > 0 && <span className="text-xs text-ink-faint">or press Run to re-run all columns above</span>}
          <Button variant="primary" onClick={() => void addAndRun()}><Play size={14} /> Run</Button>
          {cols.some((c) => c.status === 'running') && <Button variant="danger" onClick={stopAll}>Stop all</Button>}
          <Button variant="ghost" onClick={() => setCols([])} disabled={!cols.length}><Trash2 size={14} /></Button>
        </div>
      </div>

      {cols.length === 0 ? (
        <EmptyState title="No comparison columns yet" message="Pick a model above and press Run. Add more models to compare side by side." />
      ) : (
        <div className={cx('grid gap-3', cols.length === 1 ? 'grid-cols-1' : cols.length === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3')}>
          {cols.map((c) => (
            <div key={c.key} className="flex min-h-[280px] flex-col rounded-xl border border-line bg-surface-raised">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <div className="min-w-0 grow">
                  <h4 className="truncate text-[13px] font-semibold">{c.modelName}</h4>
                  <p className="text-[11px] text-ink-faint">{c.providerName}</p>
                </div>
                {c.status === 'running' && <Badge tone="accent"><Spinner size={9} /> streaming</Badge>}
                {c.status === 'done' && <Badge tone="ok"><CheckCircle2 size={10} /> {c.ms}ms</Badge>}
                {c.status === 'error' && <Badge tone="error"><AlertTriangle size={10} /> failed</Badge>}
                <button aria-label="Retry this model" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => void runOne(c, prompt)}><RotateCcw size={13} /></button>
                <button aria-label="Remove column" className="rounded p-1 text-ink-faint hover:text-red-400" onClick={() => setCols((cs) => cs.filter((x) => x.key !== c.key))}><Trash2 size={13} /></button>
              </div>
              <div className="grow overflow-y-auto p-3 text-[13px]">
                {c.error && c.status === 'error' ? <p className="text-red-400 text-xs">{c.error}</p>
                  : c.text ? <Markdown content={c.text} streaming={c.status === 'running'} />
                  : <span className="dot-typing inline-flex"><span /><span /><span /></span>}
              </div>
              <div className="flex gap-1 border-t border-line px-2 py-1.5">
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(c.text); toast('success', 'Response copied') }} disabled={!c.text}><Copy size={12} /> Copy</Button>
                <Button size="sm" variant="ghost" disabled={!c.text} onClick={async () => { await db.prompts.add({ id: nanoid(), title: `Compare ${c.modelName} ${new Date().toLocaleDateString()}`, content: `Prompt:\n"""\n${prompt}\n"""\n\nResponse (${c.modelName}):\n${c.text}`, category: 'Custom', favorite: false, variables: [], createdAt: Date.now(), updatedAt: Date.now() }); toast('success', 'Saved response to Prompt Library') }}><Save size={12} /> Save</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= SEARCH ================= */

export function SearchPage() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<'all' | 'recent' | 'pinned' | 'archived'>('all')
  const [projFilter, setProjFilter] = useState('')
  const [results, setResults] = useState<{ chat: { id: string; title: string; updatedAt: number; pinned: boolean; archived: boolean }; snippet: string; modelName?: string; providerName?: string }[] | null>(null)
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const nav = useNavigateShim()

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t) }, [q])
  useEffect(() => { void db.projects.toArray().then((ps) => setProjects(ps.map((p) => ({ id: p.id, name: p.name })))) }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      const term = debounced.trim().toLowerCase()
      let chats = await db.chats.toArray()
      if (filter === 'pinned') chats = chats.filter((c) => c.pinned)
      else if (filter === 'archived') chats = chats.filter((c) => c.archived)
      else if (filter === 'recent') { const cutoff = Date.now() - 7 * 864e5; chats = chats.filter((c) => c.updatedAt > cutoff && !c.archived) }
      else chats = chats.filter((c) => !c.archived)
      if (projFilter) chats = chats.filter((c) => c.projectId === projFilter)
      const out: typeof results = []
      for (const c of chats.sort((a, b) => b.updatedAt - a.updatedAt)) {
        if (!term) { out.push({ chat: { id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: c.pinned, archived: c.archived }, snippet: '' }); if (out.length > 60) break; continue }
        const msgs = await db.messages.where('chatId').equals(c.id).toArray()
        const hit = msgs.find((m) => m.content.toLowerCase().includes(term))
        const titleHit = c.title.toLowerCase().includes(term)
        if (hit || titleHit) {
          let providerName: string | undefined
          if (hit?.providerId) providerName = (await db.providers.get(hit.providerId))?.name
          const idx = hit ? hit.content.toLowerCase().indexOf(term) : 0
          const snippet = hit ? `${hit.content.slice(Math.max(0, idx - 40), idx)}【${hit.content.slice(idx, idx + term.length)}】${hit.content.slice(idx + term.length, idx + term.length + 80)}` : c.title
          out.push({ chat: { id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: c.pinned, archived: c.archived }, snippet: snippet.replace(/\n/g, ' '), modelName: hit?.modelName, providerName })
        }
        if (out.length > 60) break
      }
      if (live) setResults(out)
    })()
    return () => { live = false }
  }, [debounced, filter, projFilter])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <h2 className="text-lg font-bold">Search conversations</h2>
      <div className="relative">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and message content… (indexed local search)" className="pl-9 h-11 text-[15px]" aria-label="Search all conversations" />
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Tabs tabs={[{ id: 'all', label: 'All' }, { id: 'recent', label: 'Recent' }, { id: 'pinned', label: 'Pinned' }, { id: 'archived', label: 'Archived' }]} value={filter} onChange={(t) => setFilter(t as never)} />
        <Select value={projFilter} onChange={(e) => setProjFilter(e.target.value)} aria-label="Filter by project" className="h-9">
          <option value="">Any project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      {results === null ? <div className="grid place-items-center py-8"><Spinner size={22} /></div> : results.length === 0 ? (
        <EmptyState title={debounced ? 'No matches' : 'Nothing here yet'} message={debounced ? 'Try fewer words or a different filter.' : 'Your history will appear here. Everything is searched locally.'} />
      ) : (
        <div className="space-y-2">
          {results.map((r) => (
            <button key={r.chat.id} onClick={() => nav(`/chat/${r.chat.id}`)} className="block w-full rounded-xl border border-line bg-surface-raised px-4 py-3 text-left hover:border-[var(--accent)]">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{r.chat.title}</span>
                {r.chat.pinned && <Badge tone="accent">pinned</Badge>}
                {r.chat.archived && <Badge tone="warn">archived</Badge>}
                <span className="ml-auto shrink-0 text-[11px] text-ink-faint inline-flex items-center gap-1"><Clock size={10} />{new Date(r.chat.updatedAt).toLocaleDateString()}</span>
              </div>
              {r.snippet && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-dim" dangerouslySetInnerHTML={{ __html: escapeHTML(r.snippet).replace(/【/g, '<mark class="bg-amber-400/30 text-inherit rounded px-0.5">').replace(/】/g, '</mark>') }} />}
              {(r.modelName || r.providerName) && <p className="mt-1 text-[11px] text-ink-faint">{r.providerName}{r.providerName && r.modelName ? ' · ' : ''}{r.modelName}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function escapeHTML(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// small shim so this file doesn't need the router import tree-shaken oddly
function useNavigateShim() {
  return useCallback((path: string) => { window.location.hash = '#' + path }, [])
}

/* ================= ARCHIVED ================= */

export function ArchivedPage() {
  const [chats, setChats] = useState<{ id: string; title: string; updatedAt: number }[]>([])
  const toast = useAppStore((s) => s.toast)
  const reload = useCallback(() => { void db.chats.toArray().then((all) => setChats(all.filter((c) => c.archived).sort((a, b) => b.updatedAt - a.updatedAt).map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt })))) }, [])
  useEffect(reload, [reload])
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <h2 className="text-lg font-bold">Archived chats</h2>
      {chats.length === 0 ? <EmptyState title="Archive is empty" message="Archived conversations rest here until you restore or delete them." /> : (
        <div className="space-y-2">{chats.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-3">
            <button className="truncate text-sm grow text-left hover:underline" onClick={() => { window.location.hash = `#/chat/${c.id}` }}>{c.title}</button>
            <span className="text-[11px] text-ink-faint">{new Date(c.updatedAt).toLocaleDateString()}</span>
            <Button size="sm" variant="secondary" onClick={async () => { await db.chats.update(c.id, { archived: false }); reload(); toast('success', 'Chat restored') }}>Restore</Button>
            <Button size="sm" variant="ghost" className="text-red-400" onClick={async () => { if (window.confirm('Permanently delete this archived chat?')) { const { deleteChatCascade } = await import('@/database/db'); await deleteChatCascade(c.id); reload() } }}>Delete</Button>
          </div>
        ))}</div>
      )}
    </div>
  )
}
