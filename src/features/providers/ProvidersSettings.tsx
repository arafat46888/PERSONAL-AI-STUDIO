import { useEffect, useState } from 'react'
import { db, deleteProviderCascade } from '@/database/db'
import type { AIModel, Provider } from '@/types'
import { DEFAULT_CAPABILITIES } from '@/types'
import { cx, Button, Input, Select, Field, Modal, Toggle, Badge, Menu, ConfirmDialog, EmptyState, Spinner } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { testProviderConnection, fetchProviderModels } from '@/services/ai/adapters'
import { maskKey, validateUrl, timeAgo } from '@/utils'
import { nanoid } from 'nanoid'
import { Plus, Zap, CheckCircle2, XCircle, Pencil, Trash2, Copy, RefreshCw, Download, Power, AlertTriangle, Eye, EyeOff, Settings2 } from 'lucide-react'

export function ProvidersSettings() {
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [editing, setEditing] = useState<Provider | 'new' | null>(null)
  const [confirmDel, setConfirmDel] = useState<Provider | null>(null)
  const toast = useAppStore((s) => s.toast)
  const reload = () => void db.providers.orderBy('priority').toArray().then(setProviders)
  useEffect(reload, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Providers</h2>
          <p className="text-sm text-ink-dim">Connect your own API credentials. Keys are stored only in this browser's local database and are masked after saving.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> Add Provider</Button>
      </div>

      {!providers ? <div className="grid place-items-center py-10"><Spinner size={24} /></div> : providers.length === 0 ? (
        <EmptyState title="No providers configured" message="Add an OpenAI-compatible endpoint (OpenAI, Groq, Together, Ollama, LM Studio…), a Gemini provider, or a custom adapter." action={<Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> Add your first provider</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((p) => <ProviderCard key={p.id} p={p} onEdit={() => setEditing(p)} onDelete={() => setConfirmDel(p)} onChanged={reload} />)}
        </div>
      )}

      {editing && <ProviderModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}

      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} danger
        title={`Delete provider "${confirmDel?.name}"?`}
        message="All models belonging to this provider will be removed from routing. Existing conversations keep their historical model metadata; messages are not deleted."
        onConfirm={async () => { if (confirmDel) { await deleteProviderCascade(confirmDel.id); toast('success', 'Provider deleted'); reload() } }} />
    </div>
  )
}

function statusBadge(p: Provider) {
  switch (p.connectionStatus) {
    case 'ok': return <Badge tone="ok"><CheckCircle2 size={11} /> Connected</Badge>
    case 'error': return <Badge tone="error"><XCircle size={11} /> Failed</Badge>
    case 'needs-attention': return <Badge tone="error"><AlertTriangle size={11} /> Needs attention</Badge>
    default: return <Badge>Not tested</Badge>
  }
}

function ProviderCard({ p, onEdit, onDelete, onChanged }: { p: Provider; onEdit: () => void; onDelete: () => void; onChanged: () => void }) {
  const [modelCount, setModelCount] = useState<number | null>(null)
  const toast = useAppStore((s) => s.toast)
  useEffect(() => { void db.models.where('providerId').equals(p.id).count().then(setModelCount) }, [p.id])

  const retest = async () => {
    const r = await testProviderConnection(p, p.defaultModelId || 'gpt-4o-mini')
    await db.providers.update(p.id, { connectionStatus: r.ok ? 'ok' : 'error', lastTestedAt: Date.now(), updatedAt: Date.now() })
    toast(r.ok ? 'success' : 'error', r.ok ? `Provider "${p.name}" connected successfully` : `Provider "${p.name}" failed`, r.message)
    onChanged()
  }

  return (
    <div className={cx('rounded-xl border bg-surface-raised p-4 space-y-3', p.enabled ? 'border-line' : 'border-line opacity-60')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 grow">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{p.name}</h3>
            {statusBadge(p)}
            {!p.enabled && <Badge tone="warn">disabled</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-ink-faint truncate" title={p.baseUrl}>{p.baseUrl}</p>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {p.format} · key {maskKey(p.apiKey) || '—'} · {modelCount ?? '…'} model(s){p.lastTestedAt ? ` · tested ${timeAgo(p.lastTestedAt)}` : ''}
          </p>
        </div>
        <Toggle checked={p.enabled} label={`Enable ${p.name}`} onChange={async (v) => { await db.providers.update(p.id, { enabled: v, updatedAt: Date.now() }); onChanged() }} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button size="sm" variant="secondary" onClick={() => void retest()}><RefreshCw size={13} /> Retest</Button>
        <Button size="sm" variant="ghost" onClick={onEdit}><Pencil size={13} /> Edit</Button>
        <Menu align="left" trigger={<Button size="sm" variant="ghost" aria-label="More provider actions"><Copy size={13} /></Button>} items={[
          { label: 'Duplicate', icon: <Copy size={13} />, onClick: async () => { const now = Date.now(); await db.providers.add({ ...p, id: nanoid(), name: `${p.name} (copy)`, priority: p.priority + 1, connectionStatus: 'unknown', lastTestedAt: undefined, createdAt: now, updatedAt: now }); onChanged() } },
          { label: 'Manage models', icon: <Settings2 size={13} />, onClick: () => { window.location.hash = '#/settings/models' } },
          { label: 'Delete', icon: <Trash2 size={13} />, danger: true, onClick: onDelete }
        ]} />
        <span className="ml-auto text-[11px] text-ink-faint inline-flex items-center gap-1"><Power size={11} /> priority {p.priority}</span>
      </div>
    </div>
  )
}

/* ---------------- Add / Edit Provider modal with mandatory test flow ---------------- */

const FORMATS = [
  { id: 'openai-compatible', label: 'OpenAI-compatible Chat Completions (/chat/completions)' },
  { id: 'gemini', label: 'Gemini Native API (:generateContent)' },
  { id: 'custom', label: 'Custom Adapter (OpenAI wire format, extended per adapter)' }
] as const

export function ProviderModal({ initial, onClose, onSaved }: { initial: Provider | null; onClose: () => void; onSaved: () => void }) {
  const toast = useAppStore((s) => s.toast)
  const allowUntested = useAppStore((s) => s.settings.advanced.allowSaveUntested)
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [format, setFormat] = useState<Provider['format']>(initial?.format ?? 'openai-compatible')
  const [defaultModelId, setDefaultModelId] = useState(initial?.defaultModelId ?? '')
  const [headersText, setHeadersText] = useState(initial?.customHeaders ? JSON.stringify(initial.customHeaders, null, 2) : '')
  const [timeout, setTimeoutMs] = useState(String(initial?.timeout ?? 30000))
  const [maxTokens, setMaxTokens] = useState(String(initial?.maxTokens ?? ''))
  const [showKey, setShowKey] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [discovered, setDiscovered] = useState<{ id: string; name?: string }[] | null>(null)
  const [fetching, setFetching] = useState(false)

  const editedExisting = !!initial

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Provider name is required.'
    if (!baseUrl.trim()) e.baseUrl = 'Base URL is required.'
    else if (!validateUrl(baseUrl.trim())) e.baseUrl = 'Enter a valid URL (https://host/v1).'
    else if (baseUrl.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(baseUrl)) e.baseUrl = 'Use HTTPS for remote APIs; plain HTTP is only allowed for localhost.'
    if (!apiKey.trim()) e.apiKey = 'API key is required.'
    else if (apiKey.trim().length < 8) e.apiKey = 'API key looks too short — double-check it.'
    if (!FORMATS.some((f) => f.id === format)) e.format = 'Choose a supported API format.'
    if (!defaultModelId.trim()) e.defaultModelId = 'Default model ID is required.'
    if (headersText.trim()) { try { JSON.parse(headersText) } catch { e.headers = 'Custom headers must be valid JSON.' } }
    const t = Number(timeout); if (!Number.isFinite(t) || t < 1000) e.timeout = 'Timeout must be ≥ 1000 ms.'
    if (maxTokens && (!Number.isFinite(Number(maxTokens)) || Number(maxTokens) <= 0)) e.maxTokens = 'Max tokens must be a positive number.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const runTest = async () => {
    if (!validate()) { setTestResult(null); return }
    setTesting(true); setTestResult(null)
    let hdrs: Record<string, string> | undefined
    try { hdrs = headersText.trim() ? JSON.parse(headersText) : undefined } catch { hdrs = undefined }
    const res = await testProviderConnection({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), format, customHeaders: hdrs, timeout: Number(timeout) }, defaultModelId.trim())
    setTestResult(res)
    setTesting(false)
  }

  const doFetchModels = async () => {
    setFetching(true)
    try {
      const list = await fetchProviderModels({ ...(initial ?? {}), id: initial?.id ?? '', name, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), format, defaultModelId, enabled: true, priority: 1, timeout: Number(timeout) || 30000, connectionStatus: 'unknown', createdAt: 0, updatedAt: 0, customHeaders: headersText.trim() ? JSON.parse(headersText) : undefined } as Provider)
      setDiscovered(list)
      if (list.length === 0) toast('info', 'No models returned', 'This provider does not expose a model-list endpoint. Enter model IDs manually.')
    } catch (e) {
      toast('error', 'Model discovery failed', e instanceof Error ? e.message : 'This provider may not support listing models. Use manual entry instead.')
    } finally { setFetching(false) }
  }

  const buildProvider = (): Provider => {
    const now = Date.now()
    let hdrs: Record<string, string> | undefined
    try { hdrs = headersText.trim() ? JSON.parse(headersText) : undefined } catch { hdrs = initial?.customHeaders }
    return {
      id: initial?.id ?? nanoid(),
      name: name.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, ''), apiKey: apiKey.trim(), format,
      defaultModelId: defaultModelId.trim(), customHeaders: hdrs,
      timeout: Number(timeout), maxTokens: maxTokens ? Number(maxTokens) : undefined,
      enabled: initial?.enabled ?? true, priority: initial?.priority ?? 1,
      lastTestedAt: testResult ? Date.now() : initial?.lastTestedAt,
      connectionStatus: testResult ? (testResult.ok ? 'ok' : 'error') : (initial?.connectionStatus ?? 'unknown'),
      createdAt: initial?.createdAt ?? now, updatedAt: now
    }
  }

  const save = async (tested: boolean) => {
    if (!validate()) return
    if (tested && !testResult?.ok) return
    const p = buildProvider()
    if (initial) await db.providers.update(initial.id, p)
    else {
      await db.providers.add(p)
      // auto-register the default model so chat works immediately
      await db.models.add({ id: nanoid(), providerId: p.id, name: p.defaultModelId, modelId: p.defaultModelId, capabilities: { ...DEFAULT_CAPABILITIES }, enabled: true, priority: 1, createdAt: Date.now() })
    }
    toast('success', editedExisting ? 'Provider updated' : 'Provider added', tested ? 'Connection verified.' : 'Saved without testing (Advanced setting).')
    onSaved()
  }

  const canAdd = testResult?.ok === true

  return (
    <Modal open onClose={onClose} title={editedExisting ? `Edit provider — ${initial?.name}` : 'Add Provider'} wide footer={
      <>
        {allowUntested && !canAdd && <Button variant="outline" onClick={() => void save(false)} disabled={!validateQuiet(name, baseUrl, apiKey, defaultModelId)}>Save Without Testing</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={editedExisting ? false : !canAdd} onClick={() => void save(editedExisting ? true : true)}>
          {editedExisting ? 'Save Changes' : canAdd ? 'Add Provider' : 'Add Provider (test first)'}
        </Button>
      </>
    }>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider Name" required htmlFor="pv-name">
            <Input id="pv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Groq account" aria-invalid={!!errors.name} />
            {errors.name && <span className="text-xs text-red-400">{errors.name}</span>}
          </Field>
          <Field label="API Format" required htmlFor="pv-format">
            <Select id="pv-format" value={format} onChange={(e) => { setFormat(e.target.value as Provider['format']); setTestResult(null) }}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
            {errors.format && <span className="text-xs text-red-400">{errors.format}</span>}
          </Field>
        </div>
        <Field label="Base URL" required hint="e.g. https://api.openai.com/v1 or https://generativelanguage.googleapis.com/v1beta for Gemini" htmlFor="pv-url">
          <Input id="pv-url" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null) }} placeholder="https://api.example.com/v1" aria-invalid={!!errors.baseUrl} />
          {errors.baseUrl && <span className="text-xs text-red-400">{errors.baseUrl}</span>}
        </Field>
        <Field label="API Key" required hint="Stored locally only. Masked after saving; never included in normal exports." htmlFor="pv-key">
          <div className="relative">
            <Input id="pv-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTestResult(null) }} placeholder="sk-…" autoComplete="off" aria-invalid={!!errors.apiKey} className="pr-10 font-mono" />
            <button aria-label={showKey ? 'Hide API key' : 'Show API key'} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink" onClick={() => setShowKey((v) => !v)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
          {errors.apiKey && <span className="text-xs text-red-400">{errors.apiKey}</span>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default Model ID" required htmlFor="pv-model">
            <div className="flex gap-2">
              <Input id="pv-model" value={defaultModelId} onChange={(e) => { setDefaultModelId(e.target.value); setTestResult(null) }} placeholder="gpt-4o-mini" className="grow" aria-invalid={!!errors.defaultModelId} />
              <Button variant="secondary" onClick={() => void doFetchModels()} loading={fetching} title="Fetch model list when the provider exposes one"><Download size={14} /> Fetch Models</Button>
            </div>
            {errors.defaultModelId && <span className="text-xs text-red-400">{errors.defaultModelId}</span>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Request Timeout (ms)" htmlFor="pv-timeout">
              <Input id="pv-timeout" type="number" min={1000} value={timeout} onChange={(e) => setTimeoutMs(e.target.value)} />
              {errors.timeout && <span className="text-xs text-red-400">{errors.timeout}</span>}
            </Field>
            <Field label="Max Tokens" htmlFor="pv-maxtok">
              <Input id="pv-maxtok" type="number" min={0} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="optional" />
              {errors.maxTokens && <span className="text-xs text-red-400">{errors.maxTokens}</span>}
            </Field>
          </div>
        </div>
        <Field label="Custom Headers (JSON)" htmlFor="pv-headers">
          <textarea id="pv-headers" rows={3} value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder='{"X-Example": "value"}' className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent" aria-invalid={!!errors.headers} />
          {errors.headers && <span className="text-xs text-red-400">{errors.headers}</span>}
        </Field>

        {discovered && discovered.length > 0 && (
          <div className="rounded-lg border border-line bg-surface-overlay p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-medium"><span>Discovered {discovered.length} model(s) — click to use as default:</span></div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {discovered.slice(0, 120).map((m) => (
                <button key={m.id} onClick={() => { setDefaultModelId(m.id); setTestResult(null) }} className={cx('rounded-md border px-2 py-1 text-[11px]', defaultModelId === m.id ? 'border-accent text-ink' : 'border-line text-ink-dim hover:text-ink')}>{m.name ?? m.id}</button>
              ))}
            </div>
          </div>
        )}

        {/* Test workflow */}
        <div className="rounded-xl border border-line bg-surface-overlay p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-sm font-semibold">Connection test</h4>
              <p className="text-xs text-ink-dim">The Add Provider button unlocks only after a real test request succeeds{editedExisting ? ' (or you save changes directly)' : ''}.</p>
            </div>
            <Button variant="outline" onClick={() => void runTest()} loading={testing} disabled={testing}>
              <Zap size={14} /> {testing ? 'Testing connection…' : 'Test Connection'}
            </Button>
          </div>
          {testing && <div className="flex items-center gap-2 text-xs text-ink-dim"><Spinner size={14} /> Sending a real minimal request to {baseUrl || 'your endpoint'}…</div>}
          {testResult && (
            <div className={cx('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm', testResult.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-300')}>
              {testResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <div><strong>{testResult.ok ? 'Test Successful' : 'Test Failed'}.</strong> {testResult.message}</div>
            </div>
          )}
          {!canAdd && !editedExisting && <p className="text-[11px] text-ink-faint">Tip: authentication errors (401/403) mean the key was rejected; 404 usually means the Base URL path or model ID is wrong.</p>}
        </div>
      </div>
    </Modal>
  )
}

function validateQuiet(name: string, url: string, key: string, model: string) {
  return !!name.trim() && validateUrl(url.trim()) && !!key.trim() && !!model.trim()
}

/* ---------------- Models management page ---------------- */

export function ModelsSettings() {
  const [models, setModels] = useState<AIModel[] | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [editing, setEditing] = useState<AIModel | 'new' | null>(null)
  const [filter, setFilter] = useState('')
  const toast = useAppStore((s) => s.toast)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const reload = () => { void db.models.toArray().then(setModels); void db.providers.toArray().then(setProviders) }
  useEffect(reload, [])

  const q = filter.toLowerCase()
  const list = (models ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold">Models</h2>
          <p className="text-sm text-ink-dim">Capabilities are configurable — they are never inferred from the model name alone.</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search models…" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-44" aria-label="Search models" />
          <Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> Add Model</Button>
        </div>
      </div>

      {!models ? <div className="grid place-items-center py-10"><Spinner size={24} /></div> : list.length === 0 ? (
        <EmptyState title={models.length === 0 ? 'No models yet' : 'No matching models'} message={models.length === 0 ? 'Add models manually, or use “Fetch Models” inside a provider while adding it.' : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="bg-surface-overlay text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Model ID</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Context</th><th className="px-3 py-2">Capabilities</th><th className="px-3 py-2">Enabled</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="border-t border-line hover:bg-surface-overlay/50">
                  <td className="px-3 py-2 font-medium">{m.name}{settings.general.defaultModelId === m.id && <Badge tone="accent">default</Badge>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{m.modelId}</td>
                  <td className="px-3 py-2 text-xs">{providers.find((p) => p.id === m.providerId)?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{m.contextWindow ? m.contextWindow.toLocaleString() : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      {Object.entries(m.capabilities).filter(([, v]) => v).map(([k]) => <span key={k} title={k} className="rounded bg-surface-overlay border border-line px-1.5 py-0.5 text-[10px]">{capShort(k)}</span>)}
                    </div>
                  </td>
                  <td className="px-3 py-2"><Toggle checked={m.enabled} label={`Enable ${m.name}`} onChange={async (v) => { await db.models.update(m.id, { enabled: v }); reload() }} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}><Pencil size={13} /></Button>
                    <Menu align="right" trigger={<Button size="sm" variant="ghost" aria-label="Model actions"><MoreIcon /></Button>} items={[
                      { label: 'Set as default model', icon: <CheckCircle2 size={13} />, onClick: () => { void updateSettings((s) => ({ general: { ...s.general, defaultModelId: m.id }, router: { ...s.router, primaryModelId: m.id } })); toast('success', 'Default model updated') } },
                      { label: 'Delete model', icon: <Trash2 size={13} />, danger: true, onClick: async () => { if (window.confirm(`Delete model "${m.name}"? Conversations keep historical metadata.`)) { await db.models.delete(m.id); reload() } } }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ModelModal initial={editing === 'new' ? null : editing} providers={providers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function capShort(k: string) {
  return { streaming: 'stream', vision: 'vision', tools: 'tools', reasoning: 'reason', json: 'json', imageInput: 'img-in', audioInput: 'aud-in', audioOutput: 'aud-out', systemInstructions: 'sys' }[k] ?? k
}

function MoreIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg> }

function ModelModal({ initial, providers, onClose, onSaved }: { initial: AIModel | null; providers: Provider[]; onClose: () => void; onSaved: () => void }) {
  const toast = useAppStore((s) => s.toast)
  const [name, setName] = useState(initial?.name ?? '')
  const [modelId, setModelId] = useState(initial?.modelId ?? '')
  const [providerId, setProviderId] = useState(initial?.providerId ?? providers[0]?.id ?? '')
  const [ctx, setCtx] = useState(String(initial?.contextWindow ?? ''))
  const [maxOut, setMaxOut] = useState(String(initial?.maxOutputTokens ?? ''))
  const [caps, setCaps] = useState({ ...DEFAULT_CAPABILITIES, ...(initial?.capabilities ?? {}) })
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [priority, setPriority] = useState(String(initial?.priority ?? 1))

  const save = async () => {
    if (!name.trim() || !modelId.trim() || !providerId) { toast('error', 'Missing fields', 'Model name, model ID and provider are required.'); return }
    const m: AIModel = {
      id: initial?.id ?? nanoid(), providerId, name: name.trim(), modelId: modelId.trim(),
      contextWindow: ctx ? Number(ctx) : undefined, maxOutputTokens: maxOut ? Number(maxOut) : undefined,
      capabilities: caps, enabled, priority: Number(priority) || 1, createdAt: initial?.createdAt ?? Date.now()
    }
    if (initial) await db.models.update(initial.id, m)
    else await db.models.add(m)
    toast('success', initial ? 'Model updated' : 'Model added')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={initial ? `Edit model — ${initial.name}` : 'Add model'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save Model</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GPT-4o mini" /></Field>
          <Field label="Model ID" required hint="Exact ID expected by the provider"><Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-4o-mini" className="font-mono" /></Field>
          <Field label="Provider" required>
            <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="w-full">
              {providers.length === 0 && <option value="">No providers — add one first</option>}
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Priority (lower = tried first)"><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
          <Field label="Context Window (tokens)"><Input type="number" value={ctx} onChange={(e) => setCtx(e.target.value)} placeholder="128000" /></Field>
          <Field label="Maximum Output Tokens"><Input type="number" value={maxOut} onChange={(e) => setMaxOut(e.target.value)} placeholder="4096" /></Field>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">Capabilities <span className="text-xs font-normal text-ink-faint">(verify against your provider — do not enable what isn't supported)</span></h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(caps).map(([k, v]) => (
              <label key={k} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px] cursor-pointer">
                <span className="capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                <Toggle checked={v} label={k} onChange={(nv) => setCaps((c) => ({ ...c, [k]: nv }))} />
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Toggle checked={enabled} label="Model enabled" onChange={setEnabled} /> Enabled</label>
      </div>
    </Modal>
  )
}
