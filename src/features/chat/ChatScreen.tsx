import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '@/database/db'
import type { Chat, Message } from '@/types'
import { cx, Button, Menu, Input, Badge, Spinner, EmptyState, Modal, Textarea } from '@/components/ui'
import { Composer, MessageBubble, WelcomeScreen, SelectionToolbar } from './components'
import { ModelSelector } from '@/features/models/ModelSelector'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSTT, useTTS } from '@/services/voice'
import { exportChatMarkdown, exportChatJSON } from '@/services/export'
import { Search, MoreHorizontal, Share2, Plus, ArrowDown, FolderInput, Archive, Trash2, GitBranch, X, Copy } from 'lucide-react'

export function ChatScreen() {
  const { chatId } = useParams()
  const nav = useNavigate()
  const store = useChatStore()
  const messages = useChatStore((s) => s.messages)
  const chats = useChatStore((s) => s.chats)
  const currentChatId = useChatStore((s) => s.currentChatId)
  const loading = useAppStore((s) => s.settingsLoaded)
  const streaming = useAppStore((s) => s.streamingChatId)
  const toast = useAppStore((s) => s.toast)
  const confirmBeforeDelete = useAppStore((s) => s.settings.general.confirmBeforeDelete)

  const chat: Chat | undefined = chats.find((c) => c.id === chatId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [findQ, setFindQ] = useState('')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [moveTo, setMoveTo] = useState(false)
  const [confirmDelMsg, setConfirmDelMsg] = useState<string | null>(null)

  // Load conversation when route changes
  useEffect(() => {
    if (!chatId || chatId === 'tmp') return
    if (currentChatId !== chatId) void store.openChat(chatId)
    else void store.loadChats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  // If route points at an unknown chat, try to load it directly (e.g., after import)
  useEffect(() => {
    if (chatId && chatId !== 'tmp' && !loading) return
    if (chatId && chatId !== 'tmp' && !chats.some((c) => c.id === chatId)) {
      void db.chats.get(chatId).then((c) => {
        if (!c) nav('/', { replace: true })
        else void store.openChat(chatId)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chats, loading])

  const autoScroll = useAppStore((s) => s.settings.chat.autoScroll)
  const nearBottom = useCallback(() => {
    const el = scrollRef.current
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160
  }, [])

  useEffect(() => {
    if (autoScroll && nearBottom()) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, autoScroll, nearBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 300)
  }

  const filteredMessages = useMemo(() => {
    const term = findQ.trim().toLowerCase()
    if (!term) return messages
    return messages.filter((m) => m.content.toLowerCase().includes(term))
  }, [messages, findQ])

  /* message action dispatch */
  const handleAction = async (a: string) => {
    if (a.startsWith('__edit:')) {
      const [, id, ...rest] = a.split(':')
      await store.editUserMessage(id, rest.join(':'))
      return
    }
    if (a.startsWith('__del:')) {
      const id = a.slice(6)
      if (confirmBeforeDelete) setConfirmDelMsg(id)
      else await store.deleteMessage(id)
      return
    }
    if (a.startsWith('__regen:')) return store.regenerate(a.slice(8))
    if (a.startsWith('__cont:')) return store.continueGeneration(a.slice(7))
    if (a.startsWith('__branch:')) {
      const newId = await store.branchFrom(a.slice(9))
      if (newId) { toast('success', 'Branch created', 'Original conversation is untouched.'); nav(`/chat/${newId}`) }
      return
    }
    if (a.startsWith('__forget:')) {
      const msg = messages.find((m) => m.id === a.slice(9))
      if (!msg || !chatId) return
      const mems = await db.memories.where('scope').equals('chat').and((m) => m.scopeId === chatId).toArray()
      const hit = mems.find((m) => msg.content.includes(m.content.slice(0, 60)) || m.content.includes(msg.content.slice(0, 60)))
      if (hit) { await db.memories.delete(hit.id); toast('success', 'Forgot memory', `"${hit.title}" removed from this conversation's memory.`) }
      else toast('info', 'No related memory found', 'Nothing matching this message in conversation memory.')
      return
    }
    if (a.startsWith('__projmem:')) {
      const msg = messages.find((m) => m.id === a.slice(10))
      if (!msg) return
      if (!chat?.projectId) { toast('warning', 'No project attached', 'Move this chat into a project first (header → Move to project).'); return }
      const title = window.prompt('Memory label:', msg.content.slice(0, 40))
      if (!title) return
      await db.memories.add({ id: nanoidish(), scope: 'project', scopeId: chat.projectId, title, content: msg.content, approved: true, createdAt: Date.now(), updatedAt: Date.now() })
      toast('success', 'Added to project memory')
      return
    }
    if (a.startsWith('__viewmem:')) {
      if (!chatId) return
      const mems = await db.memories.where('scope').equals('chat').and((m) => m.scopeId === chatId).toArray()
      const gm = useAppStore.getState().settings.memory.globalEnabled ? await db.memories.where('scope').equals('global').filter((m) => m.approved).toArray() : []
      toast('info', `Related memory: ${mems.length} chat + ${gm.length} global`, mems.map((m) => m.title).join(', ') || 'Conversation memory is empty. Use "Remember this" on any message.')
      return
    }
    if (a === '__followup') {
      const ta = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')
      ta?.focus()
      return
    }
    // plain prompt injection (selection toolbar / explain / summarize etc.)
    if (chatId) await store.sendMessage(a)
  }

  const nanoidish = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

  const shareText = useMemo(() => messages.map((m) => `${m.role}: ${m.content}`).join('\n\n'), [messages])

  if (!chatId || chatId === 'tmp' || !chat) {
    if (chatId && chatId !== 'tmp' && loading && !chat) return <div className="grid h-full place-items-center"><Spinner size={26} /></div>
    return (
      <div className="flex h-full flex-col">
        <WelcomeScreen onPick={(t) => useChatStore.setState({ drafts: { __new__: t } })} recent={chats.filter((c) => !c.archived).slice(0, 5)} />
        <Composer />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col min-w-0">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-line bg-surface/80 backdrop-blur px-3 sm:px-4 py-2.5 shrink-0">
        <div className="min-w-0 grow">
          <h1 className="truncate text-[14px] sm:text-[15px] font-semibold">{chat.title}</h1>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            {streaming === chat.id ? <Badge tone="accent">generating…</Badge> : <Badge tone="ok">ready</Badge>}
            {chat.temporary && <Badge tone="warn">temporary</Badge>}
            {chat.projectId && <span>· project</span>}
            {chat.assistantId && <span>· assistant</span>}
          </div>
        </div>
        <ModelSelector compact value={chat.modelId} onChange={(m) => void store.setChatModel(chat.id, m)} className="hidden sm:flex" />
        <Button variant="ghost" size="icon" aria-label="Search within conversation" onClick={() => setSearchOpen((v) => !v)}><Search size={16} /></Button>
        <Button variant="ghost" size="icon" aria-label="Share conversation" onClick={() => setShareOpen(true)}><Share2 size={16} /></Button>
        <Button variant="ghost" size="icon" aria-label="New chat" onClick={() => nav('/')}><Plus size={16} /></Button>
        <Menu align="right" trigger={<Button variant="ghost" size="icon" aria-label="More options"><MoreHorizontal size={16} /></Button>} items={[
          { label: 'Rename', icon: <Input size={13} />, onClick: () => { const t = window.prompt('Conversation title:', chat.title); if (t?.trim()) void store.renameChat(chat.id, t.trim()) } },
          { label: chat.pinned ? 'Unpin' : 'Pin', icon: <GitBranch size={13} />, onClick: () => void store.togglePin(chat.id) },
          { label: 'Move to project…', icon: <FolderInput size={13} />, onClick: () => setMoveTo(true) },
          { label: 'Duplicate', icon: <Copy size={13} />, onClick: () => void store.duplicateChat(chat.id) },
          { label: 'Export as Markdown', icon: <ArrowDown size={13} />, onClick: () => exportChatMarkdown(chat.id, chat.title, messages) },
          { label: 'Export as JSON', icon: <ArrowDown size={13} />, onClick: () => exportChatJSON(chat.id, chat.title) },
          { label: 'Archive', icon: <Archive size={13} />, onClick: () => { void store.toggleArchive(chat.id); nav('/') } },
          { label: 'Delete chat', icon: <Trash2 size={13} />, danger: true, onClick: () => { if (confirmBeforeDelete) { if (window.confirm('Delete this conversation permanently?')) { void store.deleteChat(chat.id); nav('/') } } else { void store.deleteChat(chat.id); nav('/') } } }
        ]} />
      </header>

      {searchOpen && (
        <div className="border-b border-line bg-surface-raised px-3 py-2 flex items-center gap-2 shrink-0">
          <Search size={14} className="text-ink-faint" />
          <Input autoFocus placeholder="Find in this conversation…" value={findQ} onChange={(e) => setFindQ(e.target.value)} className="h-8 text-[13px]" aria-label="Find in conversation" />
          <span className="text-xs text-ink-faint whitespace-nowrap">{filteredMessages.length} match{filteredMessages.length === 1 ? '' : 'es'}</span>
          <button aria-label="Close find bar" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => { setSearchOpen(false); setFindQ('') }}><X size={14} /></button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="grow overflow-y-auto relative">
        <div className="mx-auto w-full max-w-3xl px-2 sm:px-4 py-3">
          {messages.length === 0 ? (
            <EmptyState title="No messages yet" message="Ask anything — responses stream live from your configured provider." />
          ) : (
            (findQ ? filteredMessages : messages).map((m) => <MessageBubble key={m.id} msg={m} onAction={(a) => void handleAction(a)} />)
          )}
        </div>
        {showScrollBtn && (
          <button aria-label="Scroll to latest" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
            className="sticky bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-surface-raised p-2 shadow-lg hover:border-accent">
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      <Composer chatId={chat.id} />
      <SelectionToolbar onAction={(p) => void handleAction(p)} />

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share conversation" footer={<Button variant="primary" onClick={() => { void navigator.clipboard.writeText(shareText); toast('success', 'Transcript copied to clipboard') }}>Copy transcript</Button>}>
        <p className="text-sm text-ink-dim mb-3">Sharing copies the transcript to your clipboard — nothing is uploaded anywhere. Export files instead via the ⋯ menu.</p>
        <Textarea readOnly rows={8} value={shareText.slice(0, 4000)} className="text-xs font-mono" />
      </Modal>

      <ProjectPickerModal open={moveTo} onClose={() => setMoveTo(false)} chatId={chat.id} />

      <Modal open={!!confirmDelMsg} onClose={() => setConfirmDelMsg(null)} title="Delete message?" footer={
        <>
          <Button variant="ghost" onClick={() => setConfirmDelMsg(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (confirmDelMsg) void store.deleteMessage(confirmDelMsg); setConfirmDelMsg(null) }}>Delete</Button>
        </>
      }>
        <p className="text-sm text-ink-dim">This removes the message permanently from local storage.</p>
      </Modal>
    </div>
  )
}

function ProjectPickerModal({ open, onClose, chatId }: { open: boolean; onClose: () => void; chatId: string }) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const toast = useAppStore((s) => s.toast)
  useEffect(() => { if (open) void db.projects.toArray().then(setProjects) }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Move conversation to project">
      {projects.length === 0 ? (
        <p className="text-sm text-ink-dim">No projects yet. Create one under Projects first.</p>
      ) : (
        <div className="space-y-1.5">
          <button className="w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent" onClick={async () => { await db.chats.update(chatId, { projectId: undefined }); toast('success', 'Removed from project'); onClose(); void useChatStore.getState().loadChats() }}>No project</button>
          {projects.map((p) => (
            <button key={p.id} className="w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent" onClick={async () => { await db.chats.update(chatId, { projectId: p.id }); toast('success', 'Moved to project', p.name); onClose(); void useChatStore.getState().loadChats() }}>{p.name}</button>
          ))}
        </div>
      )}
    </Modal>
  )
}

/** Voice mode overlay (hands-free loop) */
export function VoiceModeBar() {
  const [active, setActive] = useState(false)
  const tts = useTTS()
  const stt = useSTT()
  const settings = useAppStore((s) => s.settings)
  const toast = useAppStore((s) => s.toast)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const phase = useRef<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')

  const cycle = useCallback(async () => {
    if (!active) return
    if (!('speechSynthesis' in window)) { toast('error', 'Voice mode unavailable', 'This browser lacks speech synthesis.'); setActive(false); return }
    // Record one utterance using MediaRecorder + Web Speech dictation combined flow:
    phase.current = 'listening'
    let transcript = ''
    await new Promise<void>((resolve) => {
      if (!stt.listening) {
        stt.start(settings.voice.sttLanguage, (final) => { transcript += final + ' ' }, () => { /* interim */ })
      }
      const iv = setInterval(() => {
        if (phase.current !== 'listening') { clearInterval(iv); return }
      }, 500)
      setTimeout(() => { clearInterval(iv); stt.stop(); resolve() }, 6000)
    })
    if (!transcript.trim()) { toast('info', 'Voice mode', 'No speech captured in this window. Press the mic again.'); phase.current = 'idle'; return }
    phase.current = 'thinking'
    await sendMessage(`[Voice mode] ${transcript.trim()}`)
    const last = useChatStore.getState().messages.filter((m: Message) => m.role === 'assistant').slice(-1)[0]
    if (last?.content) {
      phase.current = 'speaking'
      tts.speak(last.content, { voiceURI: settings.voice.ttsVoice || undefined, rate: settings.voice.ttsRate, onEnd: () => { phase.current = 'idle' } })
    } else phase.current = 'idle'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => { if (active) void cycle() }, [active, cycle])

  return (
    <div className="fixed bottom-24 right-4 z-40 flex flex-col gap-2">
      {!active ? (
        <button aria-label="Start hands-free voice mode" onClick={() => setActive(true)} className="rounded-full border border-line bg-surface-raised px-3.5 py-2.5 text-xs font-medium shadow-xl hover:border-accent flex items-center gap-2">🎙 Voice mode</button>
      ) : (
        <div className="rounded-2xl border border-line bg-surface-raised p-2.5 shadow-xl space-y-1.5">
          <div className="text-[11px] text-ink-dim capitalize">Phase: {phase.current}</div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => void cycle()}>🎙 Speak</Button>
            {tts.speaking && <Button size="sm" variant="danger" onClick={() => { tts.stop() }}>⏹ Interrupt</Button>}
            <Button size="sm" variant="ghost" onClick={() => { setActive(false); stt.cancel(); tts.stop() }}>Exit</Button>
          </div>
        </div>
      )}
    </div>
  )
}
