import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { db } from '@/database/db'
import type { Folder } from '@/types'
import { cx, Button, Input, Menu, ConfirmDialog } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { nanoid } from 'nanoid'
import { timeAgo } from '@/utils'
import {
  Plus, Search, MessageSquare, Pin, FolderPlus, Settings2, Code2, Brain,
  Archive, SlidersHorizontal, ChevronDown, ChevronRight, PanelLeftClose,
  PanelLeftOpen, MessagesSquare, BookMarked, Trash2, Pencil, FolderInput
} from 'lucide-react'

export function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const nav = useNavigate()
  const chats = useChatStore((s) => s.chats)
  const currentChatId = useChatStore((s) => s.currentChatId)
  const loadChats = useChatStore((s) => s.loadChats)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const togglePin = useChatStore((s) => s.togglePin)
  const toggleArchive = useChatStore((s) => s.toggleArchive)
  const renameChat = useChatStore((s) => s.renameChat)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const setMobileOpen = useAppStore((s) => s.setMobileNavOpen)
  const confirmBeforeDelete = useAppStore((s) => s.settings.general.confirmBeforeDelete)
  const toast = useAppStore((s) => s.toast)

  const [q, setQ] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  useEffect(() => { void loadChats(); void db.folders.toArray().then(setFolders) }, [loadChats])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = chats.filter((c) => !c.archived)
    if (!term) return list
    return list.filter((c) => c.title.toLowerCase().includes(term))
  }, [chats, q])

  const pinned = filtered.filter((c) => c.pinned && !c.folderId)
  const recent = filtered.filter((c) => !c.pinned && !c.folderId)
  const byFolder = (fid: string) => filtered.filter((c) => c.folderId === fid)

  const newFolder = async () => {
    const name = window.prompt('Folder name:')?.trim()
    if (!name) return
    const f: Folder = { id: nanoid(), name, createdAt: Date.now() }
    await db.folders.add(f)
    setFolders(await db.folders.toArray())
    setExpanded((e) => ({ ...e, [f.id]: true }))
  }

  const moveChat = async (chatId: string, folderId?: string) => {
    await db.chats.update(chatId, { folderId, updatedAt: Date.now() })
    await loadChats()
  }

  const ChatRow = ({ id, title, updatedAt, pinned: isPinned }: { id: string; title: string; updatedAt: number; pinned?: boolean }) => (
    <div
      draggable
      onDragStart={() => setDragId(id)}
      className={cx('group relative flex items-center rounded-lg', currentChatId === id ? 'bg-surface-overlay text-ink' : 'text-ink-dim hover:bg-surface-overlay/60 hover:text-ink')}
    >
      {renaming?.id === id ? (
        <input autoFocus className="w-full bg-transparent px-2.5 py-1.5 text-[13px] outline-none border-b border-accent"
          value={renaming.value}
          onChange={(e) => setRenaming({ id, value: e.target.value })}
          onBlur={() => { if (renaming.value.trim()) void renameChat(id, renaming.value.trim()); setRenaming(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} />
      ) : (
        <button className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left min-w-0"
          onClick={() => { nav(`/chat/${id}`); if (mobile) setMobileOpen(false) }}>
          {isPinned && <Pin size={11} className="shrink-0 text-[var(--accent)]" />}
          <span className="truncate text-[13px]">{title}</span>
          <span className="ml-auto shrink-0 text-[10px] text-ink-faint group-hover:hidden">{timeAgo(updatedAt)}</span>
        </button>
      )}
      <div className="absolute right-1 hidden group-hover:flex items-center bg-inherit">
        <Menu align="right" trigger={<button aria-label="Chat options" className="rounded p-1 text-ink-faint hover:text-ink"><MoreDot /></button>} items={[
          { label: 'Rename', icon: <Pencil size={13} />, onClick: () => setRenaming({ id, value: title }) },
          { label: isPinned ? 'Unpin' : 'Pin', icon: <Pin size={13} />, onClick: () => void togglePin(id) },
          { label: 'Archive', icon: <Archive size={13} />, onClick: () => { void toggleArchive(id); toast('info', 'Chat archived', 'Find it under Archived Chats.') } },
          ...folders.map((f) => ({ label: `Move to ${f.name}`, icon: <FolderInput size={13} />, onClick: () => void moveChat(id, f.id) })),
          { label: 'Delete', icon: <Trash2 size={13} />, danger: true, onClick: () => { if (confirmBeforeDelete) setConfirmDel(id); else void deleteChat(id) } }
        ]} />
      </div>
    </div>
  )

  const Section = ({ label, items, defaultOpen = true, folderId }: { label: string; items: { id: string; title: string; updatedAt: number; pinned?: boolean }[]; defaultOpen?: boolean; folderId?: string }) => {
    const open = folderId ? (expanded[folderId] ?? defaultOpen) : true
    if (items.length === 0 && folderId) return null
    return (
      <div className="mb-1">
        <button
          className={cx('flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint hover:text-ink-dim', !folderId && 'cursor-default')}
          onClick={() => folderId && setExpanded((e) => ({ ...e, [folderId]: !open }))}>
          {folderId && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
          {label}
        </button>
        {open && <div className="space-y-0.5">{items.map((c) => <ChatRow key={c.id} {...c} />)}</div>}
      </div>
    )
  }

  if (collapsed && !mobile) {
    return (
      <aside className="hidden md:flex h-full w-[56px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-raised py-3">
        <button aria-label="Expand sidebar" className="rounded-lg p-2 text-ink-dim hover:bg-surface-overlay hover:text-ink" onClick={() => setCollapsed(false)}><PanelLeftOpen size={17} /></button>
        <button aria-label="New chat" title="New chat" className="rounded-lg p-2 text-ink-dim hover:bg-surface-overlay hover:text-ink" onClick={() => { nav('/'); }}><Plus size={17} /></button>
        <button aria-label="Search" title="Search" className="rounded-lg p-2 text-ink-dim hover:bg-surface-overlay hover:text-ink" onClick={() => nav('/search')}><Search size={17} /></button>
        <button aria-label="Projects" title="Projects" className="rounded-lg p-2 text-ink-dim hover:bg-surface-overlay hover:text-ink" onClick={() => nav('/projects')}><FolderPlus size={17} /></button>
        <button aria-label="Memory" title="Memory" className="rounded-lg p-2 text-ink-dim hover:bg-surface-overlay hover:text-ink" onClick={() => nav('/memory')}><Brain size={17} /></button>
        <button aria-label="Settings" title="Settings" className="mt-auto rounded-lg p-2 text-ink-dim hover:bg-surface-overlay hover:text-ink" onClick={() => nav('/settings/general')}><SlidersHorizontal size={17} /></button>
      </aside>
    )
  }

  return (
    <aside className={cx('flex h-full flex-col border-r border-line bg-surface-raised', mobile ? 'w-full' : 'w-[var(--sidebar-w)] max-w-[82vw] shrink-0')}>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
        <div className="min-w-0">
          <div className="text-[14px] font-bold leading-tight truncate">Personal AI Studio</div>
          <div className="text-[10px] text-ink-faint leading-tight">Your Models. Your Intelligence.</div>
        </div>
        {!mobile && <button aria-label="Collapse sidebar" className="ml-auto rounded-lg p-1.5 text-ink-faint hover:bg-surface-overlay hover:text-ink" onClick={() => setCollapsed(true)}><PanelLeftClose size={16} /></button>}
        {mobile && <button aria-label="Close navigation" className="ml-auto rounded-lg p-1.5 text-ink-faint hover:bg-surface-overlay" onClick={() => setMobileOpen(false)}>✕</button>}
      </div>

      <div className="px-3 pb-2">
        <Button variant="primary" className="w-full" onClick={() => { nav('/'); if (mobile) setMobileOpen(false) }}>
          <Plus size={15} /> New Chat
        </Button>
      </div>

      <div className="px-3 pb-2 space-y-1">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input aria-label="Search conversations" placeholder="Search conversations…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8 text-[13px]" onFocus={() => { /* live filter below */ }} />
        </div>
      </div>

      <nav className="grow overflow-y-auto px-3 pb-3 space-y-1" aria-label="Main navigation">
        <Section label="Pinned" items={pinned} />
        <Section label="Recent chats" items={recent.slice(0, 25)} />

        {folders.map((f) => {
          const open = expanded[f.id] ?? true
          return (
            <div key={f.id} className="mb-1" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) void moveChat(dragId, f.id); setDragId(null) }}>
              <div className="flex items-center pr-1">
                <button className="flex grow items-center gap-1 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint hover:text-ink-dim"
                  onClick={() => setExpanded((e) => ({ ...e, [f.id]: !open }))}>
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 📁 {f.name}
                </button>
                <Menu align="right" trigger={<button aria-label={`Folder ${f.name} options`} className="rounded p-1 text-ink-faint hover:text-ink"><MoreDot /></button>} items={[
                  { label: 'Rename folder', icon: <Pencil size={13} />, onClick: async () => { const n = window.prompt('New folder name:', f.name)?.trim(); if (n) { await db.folders.update(f.id, { name: n }); setFolders(await db.folders.toArray()) } } },
                  { label: 'Delete folder', icon: <Trash2 size={13} />, danger: true, onClick: async () => { await db.folders.delete(f.id); await db.chats.where('folderId').equals(f.id).modify({ folderId: undefined }); setFolders(await db.folders.toArray()); void loadChats() } }
                ]} />
              </div>
              {open && <div className="space-y-0.5">{byFolder(f.id).map((c) => <ChatRow key={c.id} {...c} />)}</div>}
            </div>
          )
        })}

        <div className="pt-2 space-y-0.5 border-t border-line mt-2">
          {[
            { to: '/search', label: 'Search all chats', icon: <Search size={14} /> },
            { to: '/projects', label: 'Projects', icon: <MessagesSquare size={14} /> },
            { to: '/assistants', label: 'Assistants', icon: <BookMarked size={14} /> },
            { to: '/prompts', label: 'Prompt Library', icon: <MessageSquare size={14} /> },
            { to: '/workspace', label: 'Code Workspace', icon: <Code2 size={14} /> },
            { to: '/memory', label: 'Memory', icon: <Brain size={14} /> },
            { to: '/archived', label: 'Archived Chats', icon: <Archive size={14} /> },
            { to: '/settings/general', label: 'Settings', icon: <Settings2 size={14} /> }
          ].map((l) => (
            <NavLink key={l.to} to={l.to} onClick={() => mobile && setMobileOpen(false)}
              className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors', isActive ? 'bg-surface-overlay text-ink font-medium' : 'text-ink-dim hover:bg-surface-overlay/60 hover:text-ink')}>
              {l.icon}{l.label}
            </NavLink>
          ))}
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-dim hover:bg-surface-overlay/60 hover:text-ink" onClick={newFolder}>
            <FolderPlus size={14} /> Create folder
          </button>
        </div>
      </nav>

      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} danger
        onConfirm={() => confirmDel && void deleteChat(confirmDel)}
        title="Delete conversation?" message="This permanently deletes the conversation, its messages and its conversation memory from local storage. This cannot be undone." />
    </aside>
  )
}

function MoreDot() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
}
