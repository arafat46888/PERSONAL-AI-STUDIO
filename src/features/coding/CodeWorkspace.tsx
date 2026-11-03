import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { workspace } from '@/services/workspace'
import type { CodeFile, WorkspaceProject } from '@/types'
import { cx, Button, Input, Select, Modal, Spinner, Badge, EmptyState } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { Markdown } from '@/components/common/Markdown'
import { downloadBlob, downloadText } from '@/services/storage/files'
import { nanoid } from 'nanoid'
import { Plus, FileCode2, Play, Download, FolderDown, Trash2, X, Save, Sparkles, Bug, Zap, Repeat, FlaskConical, Languages as LangIcon, MessageSquareText, ShieldCheck, RotateCcw } from 'lucide-react'

const MonacoEditor = lazy(() => import('@monaco-editor/react'))

const LANG_MAP: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', json: 'json', html: 'html', css: 'css', md: 'markdown', txt: 'plaintext', sh: 'shell', sql: 'sql', java: 'java', c: 'c', cpp: 'cpp', go: 'go', rs: 'rust' }
const guessLang = (name: string) => LANG_MAP[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'

const AI_ACTIONS = [
  { id: 'explain', label: 'Explain Code', icon: <MessageSquareText size={13} />, prompt: (c: string, lang: string) => `Explain what the following ${lang} code does, step by step:\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'fix', label: 'Fix Bugs', icon: <Bug size={13} />, prompt: (c: string, lang: string) => `Find and fix bugs in the following ${lang} code. Return the corrected full code in a fenced block:\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'optimize', label: 'Optimize Code', icon: <Zap size={13} />, prompt: (c: string, lang: string) => `Optimize the following ${lang} code for performance and readability. Return improved full code in a fenced block:\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'refactor', label: 'Refactor', icon: <Repeat size={13} />, prompt: (c: string, lang: string) => `Refactor the following ${lang} code with clean structure. Return the refactored full code:\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'tests', label: 'Generate Tests', icon: <FlaskConical size={13} />, prompt: (c: string, lang: string) => `Write unit tests covering the following ${lang} code:\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'convert', label: 'Convert Language', icon: <LangIcon size={13} />, prompt: (c: string, lang: string) => `Convert the following ${lang} code to another language (ask me which if unclear):\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'comments', label: 'Add Comments', icon: <Plus size={13} />, prompt: (c: string, lang: string) => `Add helpful comments to the following ${lang} code and return it fully commented:\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'docs', label: 'Generate Documentation', icon: <FileCode2 size={13} />, prompt: (c: string, lang: string) => `Write API documentation for the following ${lang} code:\n\`\`\`${lang}\n${c}\n\`\`\`` },
  { id: 'security', label: 'Review Security', icon: <ShieldCheck size={13} />, prompt: (c: string, lang: string) => `Perform a security review of the following ${lang} code and list vulnerabilities with fixes:\n\`\`\`${lang}\n${c}\n\`\`\`` }
]

export function CodeWorkspacePage() {
  const toast = useAppStore((s) => s.toast)
  const settings = useAppStore((s) => s.settings)
  const [wsProjects, setWsProjects] = useState<WorkspaceProject[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [files, setFiles] = useState<CodeFile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [busyAction, setBusyAction] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const editorRef = useRef<unknown>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const active = files.find((f) => f.id === activeId) ?? null

  useEffect(() => {
    void workspace.list().then(async (ps) => {
      setWsProjects(ps)
      if (ps.length > 0 && !currentId) {
        setCurrentId(ps[0].id)
        setFiles(await workspace.files(ps[0].id))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistFiles = async (next: CodeFile[]) => {
    setFiles(next)
    if (!currentId) return
    await workspace.save(currentId, next)

  }

  const createProject = async (name: string) => {
    const p: WorkspaceProject = { id: nanoid(), name, files: [], createdAt: Date.now(), updatedAt: Date.now() }
    await workspace.create(p)
    setWsProjects([...wsProjects, p])
    setCurrentId(p.id)
    const starter: CodeFile[] = [{ id: nanoid(), projectId: p.id, name: 'index.html', language: 'html', content: '<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>Hello</title></head>\n<body>\n<h1>Hello from Personal AI Studio</h1>\n<script>console.log("ready")</script>\n</body>\n</html>', dirty: false }]
    await persistStarter(starter, p.id)
  }

  const persistStarter = async (starter: CodeFile[], pid: string) => {
    await workspace.save(pid, starter)
    setFiles(starter)
    setActiveId(starter[0]?.id ?? null)
  }

  const switchProject = async (id: string) => {
    setCurrentId(id)
    setFiles(await workspace.files(id))
    setActiveId(null)
  }

  const deleteProject = async (id: string) => {
    if (!window.confirm('Delete this workspace project and all its files?')) return
    await workspace.remove(id)
    const ps = wsProjects.filter((p) => p.id !== id)
    setWsProjects(ps)
    if (currentId === id) { setCurrentId(ps[0]?.id ?? null); setFiles([]); setActiveId(null) }
  }

  const updateContent = (val: string | undefined) => {
    if (!active || val === undefined) return
    setFiles((fs) => fs.map((f) => (f.id === active.id ? { ...f, content: val, dirty: true } : f)))
  }

  const saveAll = async () => {
    if (!currentId) return
    await persistFiles(files.map((f) => ({ ...f, dirty: false })))
    toast('success', 'Workspace saved')
  }

  const addFile = async (name?: string, content?: string) => {
    const fname = (name ?? newFileName).trim()
    if (!fname) return
    const f: CodeFile = { id: nanoid(), projectId: currentId ?? '', name: fname, language: guessLang(fname), content: content ?? '', dirty: false }
    if (!currentId) { toast('warning', 'Create or select a project first'); return }
    await persistFiles([...files, f])
    setActiveId(f.id)
    setNewFileOpen(false); setNewFileName('')
  }

  const removeFile = async (id: string) => {
    const next = files.filter((f) => f.id !== id)
    await persistFiles(next)
    if (activeId === id) setActiveId(next[0]?.id ?? null)
  }

  const runAIAction = async (action: typeof AI_ACTIONS[number]) => {
    if (!active) return
    const modelId = settings.general.defaultModelId || settings.router.primaryModelId
    if (!modelId) { toast('error', 'No default model configured', 'Set a default model in Settings → Models or connect a provider first.'); return }
    setBusyAction(true)
    try {
      const { routeAndStream } = await import('@/services/ai/router/engine')
      const ctrl = new AbortController()
      let out = ''
      const res = await routeAndStream({ router: { ...settings.router, mode: 'manual', primaryModelId: modelId, fallbackModelIds: [] }, chatModelId: modelId, messages: [{ role: 'user', content: action.prompt(active.content, active.language) }], signal: ctrl.signal, onDelta: (d) => { out += d } })
      out = res.text || out
      if (!out) { toast('error', 'AI action failed', res.error ?? 'Empty response'); return }
      // If response contains a single fenced code block, offer to apply it
      const fence = out.match(/```[\w-]*\n([\s\S]*?)```/)
      if (fence && window.confirm('Apply the returned code into the current file?')) {
        await persistFiles(files.map((f) => (f.id === active.id ? { ...f, content: fence[1], dirty: true } : f)))
      }
      // Also log explanation to chat history via a dedicated assistant note chat? Keep simple: show modal preview below conversation panel.
      setAiLog((log) => [...log, { action: action.label, text: out }].slice(-6))
      toast('success', `${action.label} finished`)
    } finally { setBusyAction(false) }
  }

  const [aiLog, setAiLog] = useState<{ action: string; text: string }[]>([])

  const exportZip = async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    const proj = wsProjects.find((p) => p.id === currentId)
    files.forEach((f) => zip.file(f.name, f.content))
    zip.file('workspace.json', JSON.stringify({ name: proj?.name ?? 'workspace', app: 'personal-ai-studio', exportedAt: Date.now(), files: files.map(({ id, ...r }) => r) }, null, 2))
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `${(proj?.name ?? 'workspace').replace(/\s+/g, '-')}.zip`)
    toast('success', 'Workspace ZIP downloaded')
  }

  const importZip = async (file: File) => {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(file)
    if (!currentId) { toast('warning', 'Select a project to import into first'); return }
    const added: CodeFile[] = []
    for (const path of Object.keys(zip.files)) {
      if (zip.files[path].dir || path === 'workspace.json') continue
      const content = await zip.files[path].async('string')
      const name = path.split('/').pop()!
      added.push({ id: nanoid(), projectId: currentId, name, language: guessLang(name), content, dirty: false })
    }
    if (added.length === 0) { toast('info', 'Nothing importable', 'No supported text files found inside the ZIP.'); return }
    await persistFiles([...files, ...added])
    toast('success', `Imported ${added.length} file(s)`)
  }

  const htmlPreview = useMemo(() => buildPreviewDoc(files, active), [files, active])

  return (
    <div className="flex h-full min-h-0">
      {/* Left: file tree + AI chat panel */}
      <aside className={cx('flex shrink-0 flex-col border-r border-line bg-surface-raised', chatOpen ? 'w-[290px] max-w-[85vw]' : 'w-10')}>
        <button className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-ink-dim hover:text-ink" onClick={() => setChatOpen((v) => !v)} aria-label="Toggle left panel">
          {chatOpen ? <X size={14} /> : <Sparkles size={14} />} {chatOpen && 'Workspace tools'}
        </button>
        {chatOpen && (
          <div className="min-h-0 grow space-y-3 overflow-y-auto px-3 pb-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Project</label>
              <div className="flex gap-1.5">
                <Select value={currentId ?? ''} onChange={(e) => e.target.value && void switchProject(e.target.value)} className="h-9 w-full grow text-xs" aria-label="Workspace project">
                  <option value="">— none —</option>
                  {wsProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Button size="icon" variant="secondary" aria-label="New workspace project" onClick={() => { const n = window.prompt('Project name:', 'My workspace'); if (n) void createProject(n) }}><Plus size={14} /></Button>
                {currentId && <Button size="icon" variant="ghost" aria-label="Delete workspace project" className="text-red-400" onClick={() => void deleteProject(currentId)}><Trash2 size={14} /></Button>}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Files</span>
                <div className="flex gap-1">
                  <button className="rounded p-1 text-ink-faint hover:text-ink" title="New file" aria-label="New file" onClick={() => setNewFileOpen(true)}><Plus size={13} /></button>
                  <button className="rounded p-1 text-ink-faint hover:text-ink" title="Import ZIP into project" aria-label="Import project ZIP" onClick={() => fileInput.current?.click()}><FolderDown size={13} /></button>
                  <input ref={fileInput} type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && void importZip(e.target.files[0])} />
                </div>
              </div>
              <div className="space-y-0.5">
                {files.length === 0 && <p className="text-[11px] text-ink-faint py-2">No files yet. Create one or import a ZIP.</p>}
                {files.map((f) => (
                  <div key={f.id} className={cx('group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] cursor-pointer', f.id === activeId ? 'bg-surface-overlay text-ink' : 'text-ink-dim hover:bg-surface-overlay/60')} onClick={() => setActiveId(f.id)}>
                    <FileCode2 size={13} className="shrink-0 text-[var(--accent)]" />
                    <span className="truncate grow">{f.name}</span>
                    {f.dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="unsaved changes" />}
                    <button aria-label={`Delete ${f.name}`} className="hidden group-hover:block rounded p-0.5 text-ink-faint hover:text-red-400" onClick={(e) => { e.stopPropagation(); void removeFile(f.id) }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">AI coding actions</span>
              <div className="grid grid-cols-1 gap-1">
                {AI_ACTIONS.map((a) => (
                  <button key={a.id} disabled={!active || busyAction} onClick={() => void runAIAction(a)} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-[12px] text-ink-dim hover:border-accent hover:text-ink disabled:opacity-40">
                    <span className="text-[var(--accent)]">{a.icon}</span>{a.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10.5px] text-ink-faint">Actions send your current file's contents to the selected default model. Errors are explained when you paste them into the chat screen.</p>
            </div>

            {aiLog.length > 0 && (
              <div>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">AI results</span>
                <div className="space-y-2">
                  {aiLog.map((l, i) => (
                    <div key={i} className="rounded-lg border border-line bg-surface-overlay p-2.5">
                      <div className="mb-1 flex items-center justify-between text-[11px]"><Badge tone="accent">{l.action}</Badge><button className="text-ink-faint hover:text-ink" aria-label="Dismiss" onClick={() => setAiLog((x) => x.filter((_, j) => j !== i))}><X size={11} /></button></div>
                      <div className="max-h-40 overflow-y-auto text-[12px]"><Markdown content={l.text} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Right: tabs + editor + preview/output */}
      <main className="flex min-w-0 grow flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface-raised px-2 py-1.5">
          {files.map((f) => (
            <button key={f.id} onClick={() => setActiveId(f.id)} className={cx('group flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs', f.id === activeId ? 'bg-surface-overlay text-ink border border-line' : 'text-ink-dim hover:text-ink')}>
              {f.name}{f.dirty && <span className="text-amber-400">•</span>}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => void saveAll()} disabled={!files.some((f) => f.dirty)}><Save size={13} /> Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setPreviewKey((k) => k + 1)}><RotateCcw size={13} /> Refresh</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPreview((v) => !v)}><Play size={13} /> Preview</Button>
            <Button size="sm" variant="ghost" disabled={!active} onClick={() => active && downloadText(active.content, active.name)}><Download size={13} /> File</Button>
            <Button size="sm" variant="secondary" onClick={() => void exportZip()}><FolderDown size={13} /> ZIP</Button>
          </div>
        </div>

        <div className={cx('min-h-0 grow', showPreview && active && isHtml(active.name) ? 'grid grid-rows-2 lg:grid-cols-2 lg:grid-rows-1' : '')}>
          <div className="min-h-0 relative">
            {active ? (
              <Suspense fallback={<div className="grid h-full place-items-center"><Spinner size={24} /></div>}>
                <MonacoEditor
                  language={active.language}
                  value={active.content}
                  theme={settings.appearance.theme === 'light' ? 'vs-light' : 'vs-dark'}
                  onChange={updateContent}
                  onMount={(editor) => { editorRef.current = editor }}
                  options={{ lineNumbers: 'on', autoIndent: 'full', folding: true, wordWrap: 'on', minimap: { enabled: false }, fontSize: 13, tabSize: 2, automaticLayout: true, formatOnPaste: true }}
                />
              </Suspense>
            ) : (
              <EmptyState title="Open a file" message="Select a file from the tree, create a new one, or import a project ZIP." />
            )}
          </div>
          {showPreview && active && isHtml(active.name) && (
            <div className="min-h-0 border-t border-line lg:border-t-0 lg:border-l">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-ink-faint">
                <span>Sandboxed preview (untrusted code cannot touch this app)</span>
              </div>
              <iframe key={previewKey} title="Sandboxed preview" sandbox="allow-scripts" srcDoc={htmlPreview} className="h-[calc(100%-29px)] w-full bg-white" />
            </div>
          )}
          {showPreview && active && !isHtml(active.name) && (
            <div className="min-h-0 border-t border-line lg:border-t-0 lg:border-l flex flex-col">
              <div className="border-b border-line px-3 py-1.5 text-[11px] text-ink-faint">Output panel — console output appears here for runnable HTML previews; non-HTML files show metadata only.</div>
              <div className="grow overflow-y-auto p-3 font-mono text-[12px] text-ink-dim whitespace-pre-wrap">{`file: ${active.name}\nlanguage: ${active.language}\nsize: ${active.content.length.toLocaleString()} chars\nlines: ${active.content.split('\n').length.toLocaleString()}`}</div>
            </div>
          )}
        </div>
      </main>

      <Modal open={newFileOpen} onClose={() => setNewFileOpen(false)} title="New file" footer={<Button variant="primary" onClick={() => void addFile()} disabled={!newFileName.trim()}>Create</Button>}>
        <Input autoFocus placeholder="filename.ext (e.g. app.tsx)" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newFileName.trim() && void addFile()} aria-label="File name" />
      </Modal>
    </div>
  )
}

function isHtml(name: string) { return /\.(html?|htm)$/i.test(name) }

/** Build preview document: inline all HTML/CSS/JS files from the project. */
function buildPreviewDoc(files: CodeFile[], active: CodeFile | null): string {
  if (!active) return ''
  const html = files.filter((f) => isHtml(f.name)).find((f) => f.id === active.id)?.content ?? active.content
  const css = files.filter((f) => /\.css$/i.test(f.name)).map((f) => `/* ${f.name} */\n${f.content}`).join('\n')
  const js = files.filter((f) => /\.(jsx?|ts)$/i.test(f.name) && !isHtml(f.name)).map((f) => `// ${f.name}\n${f.content}`).join('\n')
  let doc = html
  if (css && !/<style|<link/i.test(doc)) doc = doc.includes('</head>') ? doc.replace('</head>', `<style>${css}</style></head>`) : `<style>${css}</style>` + doc
  if (js && !/<script/i.test(doc)) doc = doc.includes('</body>') ? doc.replace('</body>', `<script>${js}<\/script></body>`) : doc + `<script>${js}<\/script>`
  if (doc.includes('<head') && !doc.includes('<base')) doc = doc.replace(/<head[^>]*>/i, (m) => m + '<base target="_blank">')
  return doc
}
