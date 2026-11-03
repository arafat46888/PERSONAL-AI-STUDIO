import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nanoid } from 'nanoid'
import { db } from '@/database/db'
import type { Memory, Project, Prompt, Assistant } from '@/types'
import { cx, Button, Input, Textarea, Select, Field, Modal, Toggle, Badge, Menu, EmptyState, Spinner, Tabs, ConfirmDialog } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { extractPromptVariables, fillVariables, timeAgo } from '@/utils'
import { Plus, Search, Brain, Globe, MessagesSquare, FolderKanban, Trash2, Pencil, CheckCircle2, ShieldQuestion, Download, Upload, Star, Play, Copy, MoreHorizontal, X } from 'lucide-react'

/* ================= MEMORY ================= */

export function MemoryPage() {
  const [tab, setTab] = useState<'global' | 'chat' | 'project'>('global')
  const [memories, setMemories] = useState<Memory[] | null>(null)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Memory | 'new' | null>(null)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const toast = useAppStore((s) => s.toast)
  const reload = () => void db.memories.toArray().then(setMemories)
  useEffect(reload, [])

  const list = useMemo(() => (memories ?? []).filter((m) => m.scope === tab && (!q || (m.title + m.content).toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.updatedAt - a.updatedAt), [memories, tab, q])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold inline-flex items-center gap-2"><Brain size={19} /> Memory</h2>
          <p className="text-sm text-ink-dim">Three isolated scopes. Conversation memory is never shared with other conversations unless you explicitly approve it into global memory.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> Add memory</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={[{ id: 'global', label: 'Global' }, { id: 'chat', label: 'Conversation' }, { id: 'project', label: 'Project' }]} value={tab} onChange={(t) => setTab(t as never)} />
        <div className="relative grow max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input placeholder="Search memory…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 h-9" aria-label="Search memory" />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-dim ml-auto">
          {tab === 'global' ? 'Global memory enabled' : tab === 'chat' ? 'Conversation memory enabled' : 'Project memory enabled'}
          <Toggle checked={tab === 'global' ? settings.memory.globalEnabled : tab === 'chat' ? settings.memory.chatEnabled : settings.memory.projectEnabled}
            onChange={(v) => void updateSettings((s) => ({ memory: { ...s.memory, [tab === 'global' ? 'globalEnabled' : tab === 'chat' ? 'chatEnabled' : 'projectEnabled']: v } }))} />
        </label>
      </div>

      {!memories ? <div className="grid place-items-center py-10"><Spinner size={24} /></div> : list.length === 0 ? (
        <EmptyState title={`No ${tab} memories`} message={tab === 'chat' ? "Use “Remember this” on any assistant message to store facts for that conversation only." : tab === 'project' ? 'Attach chats to projects, then use “Add to project memory”.' : 'Global memory holds facts shared across every conversation after your approval.'} />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <div key={m.id} className="rounded-xl border border-line bg-surface-raised p-3.5 space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 grow">
                  <h4 className="text-sm font-semibold truncate">{m.title}</h4>
                  {m.scope !== 'global' && <ScopeLabel m={m} />}
                </div>
                {m.approved ? <Badge tone="ok"><CheckCircle2 size={10} /> approved</Badge> : <Badge tone="warn"><ShieldQuestion size={10} /> pending</Badge>}
              </div>
              <p className="text-[13px] text-ink-dim whitespace-pre-wrap line-clamp-4">{m.content}</p>
              <div className="flex items-center gap-1 text-[11px] text-ink-faint">
                <span>{timeAgo(m.updatedAt)}</span>
                <div className="ml-auto flex gap-0.5">
                  {!m.approved && <button title="Approve" className="rounded p-1 hover:text-emerald-400" onClick={async () => { await db.memories.update(m.id, { approved: true, updatedAt: Date.now() }); reload() }}><CheckCircle2 size={13} /></button>}
                  <button title="Edit" className="rounded p-1 hover:text-ink" onClick={() => setEditing(m)}><Pencil size={13} /></button>
                  <button title="Delete" className="rounded p-1 hover:text-red-400" onClick={async () => { await db.memories.delete(m.id); reload(); toast('success', 'Memory deleted') }}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-line">
        <Button size="sm" variant="secondary" onClick={async () => { const all = await db.memories.toArray(); const blob = JSON.stringify(all, null, 2); const { downloadText } = await import('@/services/storage/files'); downloadText(blob, 'memory-export.json', 'application/json'); toast('success', 'Memory exported') }}><Download size={13} /> Export memory</Button>
      </div>

      {editing && <MemoryModal initial={editing === 'new' ? null : editing} defaultScope={tab} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function ScopeLabel({ m }: { m: Memory }) {
  const [label, setLabel] = useState<string>('…')
  useEffect(() => {
    if (m.scope === 'chat' && m.scopeId) void db.chats.get(m.scopeId).then((c) => setLabel(`chat: ${c?.title ?? 'deleted'}`))
    else if (m.scope === 'project' && m.scopeId) void db.projects.get(m.scopeId).then((p) => setLabel(`project: ${p?.name ?? 'deleted'}`))
    else setLabel(m.scope)
  }, [m])
  return <span className="text-[11px] text-ink-faint">{label}</span>
}

function MemoryModal({ initial, defaultScope, onClose, onSaved }: { initial: Memory | null; defaultScope: string; onClose: () => void; onSaved: () => void }) {
  const [scope, setScope] = useState<Memory['scope']>(initial?.scope ?? defaultScope as Memory['scope'])
  const [scopeId, setScopeId] = useState(initial?.scopeId ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [approved, setApproved] = useState(initial?.approved ?? false)
  const [chats, setChats] = useState<{ id: string; title: string }[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { void db.chats.toArray().then((c) => c.sort((a, b) => b.updatedAt - a.updatedAt)).then(setChats); void db.projects.toArray().then(setProjects) }, [])
  const save = async () => {
    if (!title.trim() || !content.trim()) return
    if (scope !== 'global' && !scopeId) return
    const m: Memory = { id: initial?.id ?? nanoid(), scope, scopeId: scope === 'global' ? undefined : scopeId, title: title.trim(), content: content.trim(), approved, createdAt: initial?.createdAt ?? Date.now(), updatedAt: Date.now() }
    if (initial) await db.memories.update(initial.id, m)
    else await db.memories.add(m)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit memory' : 'Add memory'} footer={<Button variant="primary" onClick={() => void save()} disabled={!title.trim() || !content.trim()}>Save</Button>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Scope" required>
            <Select value={scope} onChange={(e) => { setScope(e.target.value as Memory['scope']); setScopeId('') }} className="w-full">
              <option value="global">Global — all conversations</option>
              <option value="chat">Conversation — one chat only</option>
              <option value="project">Project</option>
            </Select>
          </Field>
          {scope !== 'global' && (
            <Field label={scope === 'chat' ? 'Conversation' : 'Project'} required>
              <Select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="w-full">
                <option value="">Select…</option>
                {(scope === 'chat' ? chats.map((c) => ({ id: c.id, name: c.title })) : projects.map((p) => ({ id: p.id, name: p.name }))).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short label" /></Field>
        <Field label="Content" required><Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><Toggle checked={approved} label="Approved for injection" onChange={setApproved} /> Approved for context injection <span className="text-xs text-ink-faint">(unapproved memories are never sent to providers)</span></label>
      </div>
    </Modal>
  )
}

/* ================= PROJECTS ================= */

export function ProjectsPage() {
  const nav = useNavigate()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const [confirmDel, setConfirmDel] = useState<Project | null>(null)
  const [openProj, setOpenProj] = useState<Project | null>(null)
  const toast = useAppStore((s) => s.toast)
  const reload = () => void db.projects.toArray().then((ps) => setProjects(ps.sort((a, b) => b.updatedAt - a.updatedAt)))
  useEffect(reload, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold inline-flex items-center gap-2"><FolderKanban size={19} /> Projects</h2>
          <p className="text-sm text-ink-dim">Each project keeps its own instructions, memory, documents and attached conversations.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> New Project</Button>
      </div>

      {!projects ? <div className="grid place-items-center py-10"><Spinner size={24} /></div> : projects.length === 0 ? (
        <EmptyState title="No projects yet" message="Create a project to group chats, notes and project-scoped memory together." action={<Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> Create project</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className={cx('rounded-xl border bg-surface-raised p-4 space-y-2 cursor-pointer hover:border-[var(--accent)] transition-colors', p.archived && 'opacity-60')} onClick={() => setOpenProj(p)}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{p.icon || '📁'}</span>
                <h3 className="font-semibold truncate grow">{p.name}</h3>
                {p.pinned && <Badge tone="accent">pinned</Badge>}
                {p.archived && <Badge tone="warn">archived</Badge>}
              </div>
              {p.description && <p className="text-[13px] text-ink-dim line-clamp-2">{p.description}</p>}
              <div className="flex items-center text-[11px] text-ink-faint">
                <span>updated {timeAgo(p.updatedAt)}</span>
                <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
                  <Menu align="right" trigger={<button aria-label="Project actions" className="rounded p-1 hover:text-ink"><MoreHorizontal size={14} /></button>} items={[
                    { label: 'Open', icon: <Play size={13} />, onClick: () => setOpenProj(p) },
                    { label: 'New chat in project', icon: <MessagesSquare size={13} />, onClick: () => { window.location.hash = '#/'; setPendingProject(p.id) } },
                    { label: 'Rename', icon: <Pencil size={13} />, onClick: () => setEditing(p) },
                    { label: p.pinned ? 'Unpin' : 'Pin', icon: <Star size={13} />, onClick: async () => { await db.projects.update(p.id, { pinned: !p.pinned, updatedAt: Date.now() }); reload() } },
                    { label: 'Duplicate', icon: <Copy size={13} />, onClick: async () => { await db.projects.add({ ...p, id: nanoid(), name: `${p.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() }); reload() } },
                    { label: p.archived ? 'Restore' : 'Archive', icon: <CheckCircle2 size={13} />, onClick: async () => { await db.projects.update(p.id, { archived: !p.archived, updatedAt: Date.now() }); reload() } },
                    { label: 'Export', icon: <Download size={13} />, onClick: async () => { const { exportJSON } = await import('@/services/export'); await exportJSON(`project-${p.name}.json`, undefined, { chats: true, memories: true, projects: true }, false); toast('success', 'Backup exported (project data included)') } },
                    { label: 'Delete', icon: <Trash2 size={13} />, danger: true, onClick: () => setConfirmDel(p) }
                  ]} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <ProjectModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} danger title={`Delete project "${confirmDel?.name}"?`}
        message="Project memory and notes will be deleted. Attached conversations are kept but detached from the project."
        onConfirm={async () => { if (confirmDel) { const { deleteProjectCascade } = await import('@/database/db'); await deleteProjectCascade(confirmDel.id); reload(); toast('success', 'Project deleted') } }} />

      {openProj && <ProjectDetail project={openProj} onClose={() => setOpenProj(null)} onChanged={reload} onNewChat={() => { void setPendingProject(openProj.id); nav('/') }} />}
    </div>
  )
}

async function setPendingProject(id: string) {
  const { useChatStore } = await import('@/stores/chat')
  useChatStore.getState().setPendingProject(id)
}

function ProjectModal({ initial, onClose, onSaved }: { initial: Project | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '📁')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const save = async () => {
    if (!name.trim()) return
    const p: Project = { id: initial?.id ?? nanoid(), name: name.trim(), description: desc.trim() || undefined, icon: icon || undefined, instructions: instructions.trim() || undefined, pinned: initial?.pinned ?? false, archived: initial?.archived ?? false, createdAt: initial?.createdAt ?? Date.now(), updatedAt: Date.now() }
    if (initial) await db.projects.update(initial.id, p)
    else await db.projects.add(p)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit project' : 'New Project'} footer={<Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>Save</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-[70px_1fr] gap-3">
          <Field label="Icon"><Input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} className="text-center" /></Field>
          <Field label="Project Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My app rewrite" /></Field>
        </div>
        <Field label="Description"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Project Instructions" hint="Injected as system context for every chat inside this project."><Textarea rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Tech stack, conventions, goals…" /></Field>
      </div>
    </Modal>
  )
}

function ProjectDetail({ project, onClose, onChanged, onNewChat }: { project: Project; onClose: () => void; onChanged: () => void; onNewChat: () => void }) {
  const [chats, setChats] = useState<{ id: string; title: string; updatedAt: number }[]>([])
  const [mems, setMems] = useState<Memory[]>([])
  const [notes, setNotes] = useState<{ id: string; title: string; content: string }[]>([])
  const nav = useNavigate()
  const reloadAll = () => {
    void db.chats.where('projectId').equals(project.id).toArray().then((c) => setChats(c.sort((a, b) => b.updatedAt - a.updatedAt).map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt }))))
    void db.memories.where('scope').equals('project').and((m) => m.scopeId === project.id).toArray().then(setMems)
    void db.prompts.where('category').equals(`note:${project.id}`).toArray().then((n) => setNotes(n.map((x) => ({ id: x.id, title: x.title, content: x.content }))))
  }
  useEffect(reloadAll, [project.id])
  const addNote = async () => {
    const t = window.prompt('Note:')
    if (!t?.trim()) return
    await db.prompts.add({ id: nanoid(), title: t.slice(0, 60), content: t, category: `note:${project.id}`, favorite: false, variables: [], createdAt: Date.now(), updatedAt: Date.now() })
    reloadAll()
  }
  return (
    <Modal open onClose={onClose} title={`${project.icon ?? '📁'} ${project.name}`} wide footer={<><Button variant="ghost" onClick={() => { void db.projects.update(project.id, { updatedAt: Date.now() }); onChanged(); onClose() }}>Close</Button><Button variant="primary" onClick={() => { onNewChat(); onClose() }}>New chat in project</Button></>}>
      <div className="space-y-5">
        {project.instructions && <div className="rounded-lg border border-line bg-surface-overlay p-3 text-[13px]"><strong className="text-xs uppercase tracking-wide text-ink-faint">Project instructions</strong><p className="mt-1 whitespace-pre-wrap">{project.instructions}</p></div>}
        <section>
          <h4 className="mb-2 text-sm font-semibold">Conversations ({chats.length})</h4>
          {chats.length === 0 ? <p className="text-xs text-ink-faint">No chats attached yet.</p> : (
            <div className="space-y-1">{chats.map((c) => <button key={c.id} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-[13px] hover:border-accent" onClick={() => { nav(`/chat/${c.id}`); onClose() }}>{c.title} <span className="text-ink-faint text-[11px]">· {timeAgo(c.updatedAt)}</span></button>)}</div>
          )}
        </section>
        <section>
          <h4 className="mb-2 text-sm font-semibold">Project memory ({mems.length})</h4>
          {mems.length === 0 ? <p className="text-xs text-ink-faint">Nothing stored yet.</p> : (
            <div className="space-y-1">{mems.map((m) => <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]"><span className="truncate grow">{m.title}: <span className="text-ink-dim">{m.content.slice(0, 80)}</span></span>{!m.approved && <Badge tone="warn">pending</Badge>}<button aria-label="Delete memory" className="text-ink-faint hover:text-red-400" onClick={async () => { await db.memories.delete(m.id); reloadAll() }}><X size={13} /></button></div>)}</div>
          )}
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">Notes ({notes.length})</h4><Button size="sm" variant="secondary" onClick={() => void addNote()}><Plus size={12} /> Add note</Button></div>
          {notes.map((n) => <div key={n.id} className="mb-1 rounded-lg border border-line px-3 py-2 text-[13px]">{n.content}</div>)}
        </section>
      </div>
    </Modal>
  )
}

/* ================= PROMPT LIBRARY ================= */

const PROMPT_CATEGORIES = ['Coding', 'Writing', 'Learning', 'Business', 'Research', 'Translation', 'Productivity', 'Custom']

export function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[] | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [editing, setEditing] = useState<Prompt | 'new' | null>(null)
  const [running, setRunning] = useState<Prompt | null>(null)
  const toast = useAppStore((s) => s.toast)
  const reload = () => void db.prompts.toArray().then((ps) => setPrompts(ps.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)))
  useEffect(reload, [])

  const list = (prompts ?? []).filter((p) => (cat === 'all' || p.category === cat) && (!q || (p.title + p.content).toLowerCase().includes(q.toLowerCase())))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold">Prompt Library</h2>
          <p className="text-sm text-ink-dim">Reusable prompts with {'{{variables}}'} — filled in before sending.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> Save prompt</Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative grow max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input placeholder="Search prompts…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 h-9" aria-label="Search prompts" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category filter" className="h-9">
          <option value="all">All categories</option>
          {[...PROMPT_CATEGORIES, ...[...new Set((prompts ?? []).map((p) => p.category))]].filter((v, i, a) => a.indexOf(v) === i).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      {!prompts ? <div className="grid place-items-center py-10"><Spinner size={24} /></div> : list.length === 0 ? (
        <EmptyState title="No prompts found" message="Save frequently used instructions here. Use {{topic}} style placeholders for variables." />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <div key={p.id} className="rounded-xl border border-line bg-surface-raised p-3.5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button aria-label={p.favorite ? 'Unfavorite' : 'Favorite'} className={cx('shrink-0', p.favorite ? 'text-amber-400' : 'text-ink-faint hover:text-amber-300')} onClick={async () => { await db.prompts.update(p.id, { favorite: !p.favorite }); reload() }}><Star size={14} fill={p.favorite ? 'currentColor' : 'none'} /></button>
                <h4 className="text-sm font-semibold truncate grow">{p.title}</h4>
                <Badge>{p.category}</Badge>
              </div>
              <p className="text-[12.5px] text-ink-dim line-clamp-3 whitespace-pre-wrap grow">{p.content}</p>
              {p.variables.length > 0 && <div className="flex gap-1 flex-wrap">{p.variables.map((v) => <span key={v} className="rounded bg-surface-overlay border border-line px-1.5 py-0.5 text-[10px] font-mono">{'{{' + v + '}}'}</span>)}</div>}
              <div className="flex items-center gap-1">
                <Button size="sm" variant="primary" onClick={() => (p.variables.length ? setRunning(p) : void insertPrompt(p.content))}><Play size={12} /> Use</Button>
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(p.content); toast('success', 'Prompt copied') }}><Copy size={12} /></Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil size={12} /></Button>
                <Button size="sm" variant="ghost" className="ml-auto text-red-400" onClick={async () => { if (window.confirm('Delete this prompt?')) { await db.prompts.delete(p.id); reload() } }}><Trash2 size={12} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <PromptModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {running && <VariableModal prompt={running} onClose={() => setRunning(null)} />}
    </div>
  )
}

async function insertPrompt(content: string) {
  const { useChatStore } = await import('@/stores/chat')
  useChatStore.getState().setDraft('__new__', content)
  useAppStore.getState().toast('info', 'Inserted into the new-chat composer')
  window.location.hash = '#/'
}

function VariableModal({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const vars = useMemo(() => (prompt.variables.length ? prompt.variables : extractPromptVariables(prompt.content)), [prompt])
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(vars.map((v) => [v, ''])))
  const filled = fillVariables(prompt.content, vals)
  const send = async () => {
    onClose()
    window.location.hash = '#/'
    const { useChatStore } = await import('@/stores/chat')
    const st = useChatStore.getState()
    const chat = await st.newChat({})
    window.location.hash = `#/chat/${chat.id}`
    await st.sendMessage(filled)
  }
  return (
    <Modal open onClose={onClose} title={`Fill variables — ${prompt.title}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void send()} disabled={vars.some((v) => !vals[v]?.trim())}>Run prompt</Button></>}>
      <div className="space-y-3">
        {vars.map((v) => <Field key={v} label={v} required><Input value={vals[v] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [v]: e.target.value }))} placeholder={`Value for ${v}`} /></Field>)}
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Preview</h4>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-overlay p-3 text-xs max-h-48 overflow-y-auto">{filled}</pre>
        </div>
      </div>
    </Modal>
  )
}

function PromptModal({ initial, onClose, onSaved }: { initial: Prompt | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [category, setCategory] = useState(initial?.category ?? 'Custom')
  const save = async () => {
    if (!title.trim() || !content.trim()) return
    const p: Prompt = { id: initial?.id ?? nanoid(), title: title.trim(), content, category, favorite: initial?.favorite ?? false, variables: extractPromptVariables(content), createdAt: initial?.createdAt ?? Date.now(), updatedAt: Date.now() }
    if (initial) await db.prompts.update(initial.id, p)
    else await db.prompts.add(p)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit prompt' : 'Save prompt'} footer={<Button variant="primary" onClick={() => void save()} disabled={!title.trim() || !content.trim()}>Save</Button>}>
      <div className="space-y-4">
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">{PROMPT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Content" required hint="Use {{variable}} placeholders — you'll be asked to fill them before running."><Textarea rows={7} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

/* ================= ASSISTANTS ================= */

export function AssistantsPage() {
  const [assistants, setAssistants] = useState<Assistant[] | null>(null)
  const [editing, setEditing] = useState<Assistant | 'new' | null>(null)
  const reload = () => void db.assistants.toArray().then(setAssistants)
  useEffect(reload, [])

  const startChat = async (a: Assistant) => {
    const { useChatStore } = await import('@/stores/chat')
    const st = useChatStore.getState()
    const chat = await st.newChat({ assistantId: a.id, modelId: a.defaultModelId, title: `${a.name} session` })
    window.location.hash = `#/chat/${chat.id}`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Assistants</h2>
          <p className="text-sm text-ink-dim">Custom personas with their own instructions, model and memory policy — using the same provider infrastructure as normal chats.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><Plus size={15} /> New Assistant</Button>
      </div>
      {!assistants ? <div className="grid place-items-center py-10"><Spinner size={24} /></div> : assistants.length === 0 ? (
        <EmptyState title="No assistants yet" message="Try creating a Coding Assistant, Research Assistant, Writing Assistant, Translator or Tutor." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assistants.map((a) => (
            <div key={a.id} className="rounded-xl border border-line bg-surface-raised p-4 space-y-2">
              <div className="flex items-center gap-2.5">
                <Avatar src={a.avatar} name={a.name} />
                <div className="min-w-0"><h3 className="font-semibold truncate">{a.name}</h3><p className="text-[11px] text-ink-faint truncate">{a.description || 'Personalized assistant'}</p></div>
              </div>
              <p className="text-[12px] text-ink-dim line-clamp-2 whitespace-pre-wrap">{a.instructions}</p>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="primary" onClick={() => void startChat(a)}><MessagesSquare size={12} /> Start chat</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil size={12} /></Button>
                <Button size="sm" variant="ghost" className="ml-auto text-red-400" onClick={async () => { if (window.confirm(`Delete assistant "${a.name}"?`)) { await db.assistants.delete(a.id); reload() } }}><Trash2 size={12} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <AssistantModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function Avatar({ src, name }: { src?: string; name: string }) {
  return src ? <img src={src} alt="" className="h-9 w-9 rounded-full object-cover border border-line" />
    : <div className="grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_25%,var(--bg-overlay))] text-sm font-bold">{name.slice(0, 1)}</div>
}

const PRESETS = [
  { name: 'Coding Assistant', description: 'Writes, explains and reviews code', instructions: 'You are an expert software engineer. Provide complete working code, explain trade-offs, point out bugs and security issues. Prefer clarity over cleverness.', emoji: '💻' },
  { name: 'Research Assistant', description: 'Structured analysis with caveats', instructions: 'You are a meticulous research assistant. Organize answers with headings and bullets, distinguish established facts from speculation, and state uncertainty explicitly.', emoji: '🔎' },
  { name: 'Writing Assistant', description: 'Editing and style improvements', instructions: 'You are a professional editor. Improve clarity, tone and structure while preserving the author voice. Show revised text first, then brief notes.', emoji: '✍️' },
  { name: 'Translator', description: 'Accurate natural translation', instructions: 'You are a professional translator. Translate accurately and naturally, preserving formatting, idioms and register. Note ambiguities when relevant.', emoji: '🌐' },
  { name: 'Tutor', description: 'Patient step-by-step teaching', instructions: 'You are a patient tutor. Never just give the answer: ask guiding questions, break problems into steps, adapt to the learner level shown by their messages.', emoji: '🎓' },
  { name: 'General Assistant', description: 'Balanced everyday helper', instructions: 'You are a helpful general assistant. Be concise by default, expand when asked. Use markdown and code blocks where useful.', emoji: '🤖' }
]

function AssistantModal({ initial, onClose, onSaved }: { initial: Assistant | null; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState<Assistant>(initial ?? { id: nanoid(), name: '', description: '', avatar: '', instructions: '', defaultModelId: '', temperature: undefined, maxTokens: undefined, projectId: '', memoryAccess: true, enabledTools: [], createdAt: Date.now(), updatedAt: Date.now() })
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { void db.models.filter((m) => m.enabled).toArray().then((ms) => setModels(ms.map((m) => ({ id: m.id, name: m.name })))); void db.projects.toArray().then((ps) => setProjects(ps.map((p) => ({ id: p.id, name: p.name })))) }, [])
  const save = async () => {
    if (!a.name.trim() || !a.instructions.trim()) return
    const rec = { ...a, name: a.name.trim(), projectId: a.projectId || undefined, defaultModelId: a.defaultModelId || undefined, avatar: a.avatar || undefined, description: a.description || undefined, updatedAt: Date.now() }
    if (initial) await db.assistants.update(initial.id, rec)
    else await db.assistants.add(rec)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit assistant' : 'New Assistant'} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={!a.name.trim() || !a.instructions.trim()}>Save assistant</Button></>}>
      <div className="space-y-4">
        {!initial && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Start from a preset</h4>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => <button key={p.name} onClick={() => setA((s) => ({ ...s, name: p.name, description: p.description, instructions: p.instructions, avatar: p.emoji }))} className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:border-accent">{p.emoji} {p.name}</button>)}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assistant Name" required><Input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></Field>
          <Field label="Avatar (emoji or image URL)"><Input value={a.avatar ?? ''} onChange={(e) => setA({ ...a, avatar: e.target.value })} placeholder="🤖 or https://…" /></Field>
          <Field label="Default Model"><Select className="w-full" value={a.defaultModelId ?? ''} onChange={(e) => setA({ ...a, defaultModelId: e.target.value })}><option value="">Provider default / router picks</option>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="Associated Project"><Select className="w-full" value={a.projectId ?? ''} onChange={(e) => setA({ ...a, projectId: e.target.value })}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Temperature (if supported by model)"><Input type="number" step="0.1" min="0" max="2" value={a.temperature ?? ''} onChange={(e) => setA({ ...a, temperature: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
          <Field label="Max Output Tokens"><Input type="number" min="0" value={a.maxTokens ?? ''} onChange={(e) => setA({ ...a, maxTokens: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        </div>
        <Field label="Description"><Input value={a.description ?? ''} onChange={(e) => setA({ ...a, description: e.target.value })} /></Field>
        <Field label="System Instructions" required><Textarea rows={6} value={a.instructions} onChange={(e) => setA({ ...a, instructions: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm"><Toggle checked={a.memoryAccess} label="Memory access" onChange={(v) => setA({ ...a, memoryAccess: v })} /> Can read approved memory context</label>
          <span className="text-xs text-ink-faint self-center">Tool support depends on the selected model's capabilities — unavailable tools are never silently faked.</span>
        </div>
      </div>
    </Modal>
  )
}
