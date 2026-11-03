import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { db, deleteChatCascade } from '@/database/db'
import type { Attachment, Chat, Message } from '@/types'
import { useAppStore } from './app'
import { routeAndStream, getRouterStats } from '@/services/ai/router/engine'
import type { ChatRequestMessage } from '@/services/ai/adapters'
import { completeOnce } from '@/services/ai/adapters'

export function activeBranchPath(messages: Message[], branchId?: string): Message[] {
  // Chronological view. Branches are materialized as separate chats that record
  // a shared branchId, so navigation between branches = switching chats while
  // the original conversation remains intact.
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt)
  if (!branchId) return sorted
  return sorted.filter((m) => !m.branchId || m.branchId === branchId)
}

export interface ChatState {
  chats: Chat[]
  messages: Message[]
  currentChatId: string | null
  loading: boolean
  error: string | null
  abortRef: AbortController | null
  drafts: Record<string, string>
  visibleBranch: Record<string, string | undefined> // chatId -> branchId shown
  pendingProject: string | null
  setPendingProject: (id: string | null) => void
  loadChats: () => Promise<void>
  openChat: (id: string) => Promise<void>
  newChat: (opts?: Partial<Chat>) => Promise<Chat>
  loadMessages: (chatId: string) => Promise<void>
  sendMessage: (text: string, attachments?: Attachment[], modelOverrideId?: string) => Promise<void>
  autoTitle: (chatId: string, firstText: string) => Promise<void>
  stopGeneration: () => void
  regenerate: (assistantMessageId: string) => Promise<void>
  continueGeneration: (assistantMessageId: string) => Promise<void>
  editUserMessage: (messageId: string, newText: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  branchFrom: (messageId: string) => Promise<string>
  switchBranch: (chatId: string, branchId?: string) => void
  renameChat: (id: string, title: string) => Promise<void>
  setChatModel: (chatId: string, modelId: string) => Promise<void>
  togglePin: (id: string) => Promise<void>
  toggleArchive: (id: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
  duplicateChat: (id: string) => Promise<void>
  setDraft: (chatId: string, text: string) => void
  rateMessage: (id: string, rating: 'like' | 'dislike' | undefined) => Promise<void>
  savePartial: (messageId: string, content: string) => Promise<void>
}

async function buildContext(chat: Chat, history: Message[]): Promise<ChatRequestMessage[]> {
  const s = useAppStore.getState().settings
  const out: ChatRequestMessage[] = []
  // 1. System instructions (assistant)
  if (chat.assistantId) {
    const a = await db.assistants.get(chat.assistantId)
    if (a?.instructions) out.push({ role: 'system', content: a.instructions })
  }
  // 2. Global instructions / memory (approved only)
  if (s.memory.globalEnabled) {
    const gm = await db.memories.where('scope').equals('global').filter((m) => m.approved).toArray()
    if (gm.length) out.push({ role: 'system', content: 'Global memory (user-approved facts):\n' + gm.map((m) => `- ${m.title}: ${m.content}`).join('\n') })
  }
  // 3. Project instructions + project memory
  if (chat.projectId) {
    const p = await db.projects.get(chat.projectId)
    if (p?.instructions) out.push({ role: 'system', content: `Project "${p.name}" instructions:\n${p.instructions}` })
    if (s.memory.projectEnabled) {
      const pm = await db.memories.where('scope').equals('project').and((m) => m.scopeId === chat.projectId && m.approved).toArray()
      if (pm.length) out.push({ role: 'system', content: 'Project memory:\n' + pm.map((m) => `- ${m.title}: ${m.content}`).join('\n') })
    }
  }
  // 4. Conversation memory (isolated per chat)
  if (s.memory.chatEnabled) {
    const cm = await db.memories.where('scope').equals('chat').and((m) => m.scopeId === chat.id && m.approved).toArray()
    if (cm.length) out.push({ role: 'system', content: 'Conversation memory:\n' + cm.map((m) => `- ${m.title}: ${m.content}`).join('\n') })
  }
  // 5. Recent conversation messages (context trimming ~ last 60 messages, char budget)
  let budget = 90000
  const recent: ChatRequestMessage[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.status === 'error' && !m.content) continue
    const entry: ChatRequestMessage = { role: m.role, content: m.content }
    const imgs = (m.attachments ?? []).filter((a) => a.kind === 'image' && a.dataUrl).map((a) => a.dataUrl!)
    if (imgs.length) entry.images = imgs
    // include extracted document text as explicit context
    const docs = (m.attachments ?? []).filter((a) => a.text)
    if (docs.length) entry.content += '\n\n' + docs.map((a) => `[Attached file: ${a.name}]\n"""\n${a.text}\n"""`).join('\n')
    budget -= entry.content.length
    if (budget < 0) { recent.unshift({ role: 'system', content: '[Earlier messages trimmed to fit context window.]' }); break }
    recent.unshift(entry)
  }
  out.push(...recent.filter((r) => r.content || r.images?.length))
  return out
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  messages: [],
  currentChatId: null,
  loading: false,
  error: null,
  abortRef: null,
  drafts: {},
  visibleBranch: {},
  pendingProject: null,
  setPendingProject: (id) => set({ pendingProject: id }),

  loadChats: async () => {
    const chats = await db.chats.orderBy('updatedAt').reverse().toArray()
    set({ chats })
  },

  openChat: async (id) => {
    set({ currentChatId: id, loading: true, error: null })
    await get().loadMessages(id)
    set({ loading: false })
  },

  loadMessages: async (chatId) => {
    const messages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt')
    set({ messages })
  },

  newChat: async (opts) => {
    const s = useAppStore.getState().settings
    const now = Date.now()
    const st = get()
    const pp = st.pendingProject
    if (pp) set({ pendingProject: null })
    const chat: Chat = {
      id: nanoid(), title: 'New chat', pinned: false, archived: false,
      temporary: s.chat.tempChat, createdAt: now, updatedAt: now,
      modelId: opts?.modelId ?? s.general.defaultModelId || undefined,
      ...(pp ? { projectId: pp } : {}),
      ...opts
    }
    await db.chats.add(chat)
    set((st) => ({ chats: [chat, ...st.chats], currentChatId: chat.id, messages: [] }))
    return chat
  },

  setDraft: (chatId, text) => set((st) => ({ drafts: { ...st.drafts, [chatId]: text } })),

  sendMessage: async (text, attachments = [], modelOverrideId) => {
    const st = get()
    const app = useAppStore.getState()
    let chat = st.currentChatId ? st.chats.find((c) => c.id === st.currentChatId) : undefined
    if (!chat) chat = await st.newChat(modelOverrideId ? { modelId: modelOverrideId } : undefined)

    if (!navigator.onLine) {
      app.toast('warning', 'Offline mode enabled', 'AI generation requires a network connection. Your message is not sent.')
    }

    const now = Date.now()
    const userMsg: Message = {
      id: nanoid(), chatId: chat.id, role: 'user', content: text,
      attachments, status: 'complete', createdAt: now, updatedAt: now,
      parentMessageId: st.messages[st.messages.length - 1]?.id
    }
    await db.messages.add(userMsg)
    const history = [...get().messages, userMsg]
    set({ messages: history })
    if (!chat.temporary) await db.chats.update(chat.id, { updatedAt: now })

    const assistantMsg: Message = {
      id: nanoid(), chatId: chat.id, role: 'assistant', content: '',
      status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
      parentMessageId: userMsg.id, branchId: userMsg.branchId,
      modelId: modelOverrideId ?? chat.modelId
    }
    await db.messages.add(assistantMsg)
    set({ messages: [...get().messages, assistantMsg] })

    const ctrl = new AbortController()
    set({ abortRef: ctrl })
    app.setStreaming(chat.id)

    // Live incremental persistence into memory; DB write on completion/stop.
    let acc = ''
    const t0 = performance.now()
    try {
      const ctx = await buildContext(chat, history.slice(0, -1))
      const assistant = chat.assistantId ? await db.assistants.get(chat.assistantId) : undefined
      const result = await routeAndStream({
        router: app.settings.router,
        chatModelId: modelOverrideId ?? assistant?.defaultModelId ?? chat.modelId,
        messages: ctx,
        temperature: assistant?.temperature,
        maxTokens: assistant?.maxTokens,
        signal: ctrl.signal,
        chatId: chat.id,
        onDelta: (d) => {
          acc += d
          set({ messages: get().messages.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc, status: 'streaming' } : m)) })
        }
      })
      const finalContent = result.text || acc
      const stopped = ctrl.signal.aborted
      const failed = !!result.error && !finalContent
      const update: Partial<Message> = {
        content: finalContent,
        status: failed ? 'error' : stopped ? 'stopped' : 'complete',
        updatedAt: Date.now(),
        modelId: result.model?.id, providerId: result.provider?.id,
        modelName: result.model ? `${result.model.name}` : undefined,
        error: failed ? result.error : undefined
      }
      await db.messages.update(assistantMsg.id, update)
      set({ messages: get().messages.map((m) => (m.id === assistantMsg.id ? { ...m, ...update } : m)) })
      if (failed) app.toast('error', 'Generation failed', result.error)
      if (result.attempts.length > 1 && !failed) app.toast('info', 'Failover used', result.attempts.map((a) => `${a.modelName}: ${a.error}`).join(' → '))

      // Auto-title from first exchange
      if (app.settings.chat.autoTitle && chat.title === 'New chat' && !failed && finalContent) {
        await get().autoTitle(chat.id, text)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unexpected error while generating.'
      await db.messages.update(assistantMsg.id, { status: 'error', error: msg, content: acc, updatedAt: Date.now() })
      set({ messages: get().messages.map((m) => (m.id === assistantMsg.id ? { ...m, status: 'error', error: msg, content: acc } : m)) })
      app.toast('error', 'Generation failed', msg)
    } finally {
      set({ abortRef: null })
      app.setStreaming(null)
      void t0
    }
  },

  autoTitle: async (chatId, firstText) => {
    const s = useAppStore.getState()
    const modelId = s.settings.general.defaultModelId || s.settings.router.primaryModelId
    let title = firstText.slice(0, 48).replace(/\n/g, ' ')
    try {
      if (modelId) {
        const model = await db.models.get(modelId)
        const provider = model ? await db.providers.get(model.providerId) : undefined
        if (model && provider?.enabled) {
          const out = await completeOnce({
            provider, model, timeoutMs: 15000,
            messages: [{ role: 'user', content: `Reply with ONLY a short title (max 6 words) for a conversation that starts with this message:\n"""\n${firstText.slice(0, 800)}\n"""` }]
          })
          if (out.trim()) title = out.trim().slice(0, 60)
        }
      }
    } catch { /* fall back to truncated text */ }
    await db.chats.update(chatId, { title })
    await get().loadChats()
  },

  stopGeneration: () => {
    const ctrl = get().abortRef
    if (ctrl) ctrl.abort()
  },

  savePartial: async (messageId, content) => {
    await db.messages.update(messageId, { content, updatedAt: Date.now() })
  },

  regenerate: async (assistantMessageId) => {
    const st = get()
    const msg = st.messages.find((m) => m.id === assistantMessageId)
    if (!msg) return
    // Remove this assistant message and everything after it, then re-send its parent user message.
    const idx = st.messages.findIndex((m) => m.id === assistantMessageId)
    const parentUser = [...st.messages.slice(0, idx)].reverse().find((m) => m.role === 'user')
    if (!parentUser) return
    const removeIds = st.messages.slice(idx).map((m) => m.id)
    await db.messages.bulkDelete(removeIds)
    set({ messages: st.messages.slice(0, idx) })
    await st.sendMessage(parentUser.content, parentUser.attachments, msg.modelId)
  },

  continueGeneration: async (assistantMessageId) => {
    const st = get()
    const msg = st.messages.find((m) => m.id === assistantMessageId)
    if (!msg || !msg.content) return
    // Ask the same model to continue where it left off.
    const chat = st.chats.find((c) => c.id === msg.chatId)!
    const placeholder: Message = { id: nanoid(), chatId: chat.id, role: 'assistant', content: '', status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), modelId: msg.modelId }
    await db.messages.add(placeholder)
    set({ messages: [...get().messages, placeholder] })
    const ctrl = new AbortController()
    set({ abortRef: ctrl })
    useAppStore.getState().setStreaming(chat.id)
    let acc = ''
    try {
      const history = get().messages.filter((m) => m.id !== placeholder.id)
      const ctx = await buildContext(chat, history.concat([{ ...msg, role: 'user', content: `Continue exactly where the following response was cut off, without repeating it:\n"""\n${msg.content.slice(-2000)}\n"""`, id: nanoid(), attachments: [], status: 'complete', createdAt: Date.now(), updatedAt: Date.now() } as Message]))
      const result = await routeAndStream({ router: useAppStore.getState().settings.router, chatModelId: msg.modelId ?? chat.modelId, messages: ctx, signal: ctrl.signal, chatId: chat.id, onDelta: (d) => { acc += d; set({ messages: get().messages.map((m) => (m.id === placeholder.id ? { ...m, content: acc, status: 'streaming' } : m)) }) } })
      const upd = { content: acc || result.text, status: (acc || result.text ? 'complete' : 'error') as Message['status'], updatedAt: Date.now() }
      await db.messages.update(placeholder.id, upd)
      set({ messages: get().messages.map((m) => (m.id === placeholder.id ? { ...m, ...upd } : m)) })
      if (upd.status === 'error') useAppStore.getState().toast('error', 'Could not continue', result.error)
    } finally {
      set({ abortRef: null })
      useAppStore.getState().setStreaming(null)
    }
  },

  editUserMessage: async (messageId, newText) => {
    const st = get()
    const idx = st.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    const after = st.messages.slice(idx + 1).map((m) => m.id)
    await db.messages.bulkDelete(after)
    await db.messages.update(messageId, { content: newText, updatedAt: Date.now() })
    const kept = { ...st.messages[idx], content: newText }
    set({ messages: [kept] })
    await st.sendMessage(newText, kept.attachments)
  },

  deleteMessage: async (messageId) => {
    await db.messages.delete(messageId)
    set({ messages: get().messages.filter((m) => m.id !== messageId) })
  },

  branchFrom: async (messageId) => {
    const st = get()
    const msg = st.messages.find((m) => m.id === messageId)
    if (!msg) return ''
    const branchId = nanoid()
    // Copy the lineage up to this message into a new chat that records its origin.
    const idx = st.messages.findIndex((m) => m.id === messageId)
    const lineage = st.messages.slice(0, idx + 1)
    const srcChat = st.chats.find((c) => c.id === msg.chatId)!
    const now = Date.now()
    const chat: Chat = { id: nanoid(), title: `${srcChat.title} (branch)`, pinned: false, archived: false, temporary: false, projectId: srcChat.projectId, assistantId: srcChat.assistantId, modelId: srcChat.modelId, providerId: srcChat.providerId, createdAt: now, updatedAt: now }
    await db.chats.add(chat)
    const copies: Message[] = lineage.map((m, i) => ({ ...m, id: nanoid(), chatId: chat.id, branchId, parentMessageId: i > 0 ? undefined : undefined, createdAt: now + i }))
    await db.messages.bulkAdd(copies)
    await get().loadChats()
    await get().openChat(chat.id)
    return chat.id
  },

  switchBranch: (chatId, branchId) => set((st) => ({ visibleBranch: { ...st.visibleBranch, [chatId]: branchId } })),

  renameChat: async (id, title) => {
    await db.chats.update(id, { title, updatedAt: Date.now() })
    await get().loadChats()
  },
  setChatModel: async (chatId, modelId) => {
    const m = await db.models.get(modelId)
    await db.chats.update(chatId, { modelId, providerId: m?.providerId, updatedAt: Date.now() })
    await get().loadChats()
  },
  togglePin: async (id) => {
    const c = get().chats.find((x) => x.id === id)
    await db.chats.update(id, { pinned: !c?.pinned })
    await get().loadChats()
  },
  toggleArchive: async (id) => {
    const c = get().chats.find((x) => x.id === id)
    await db.chats.update(id, { archived: !c?.archived })
    await get().loadChats()
  },
  deleteChat: async (id) => {
    await deleteChatCascade(id)
    if (get().currentChatId === id) set({ currentChatId: null, messages: [] })
    await get().loadChats()
  },
  duplicateChat: async (id) => {
    const c = get().chats.find((x) => x.id === id)
    if (!c) return
    const now = Date.now()
    const copy: Chat = { ...c, id: nanoid(), title: `${c.title} (copy)`, pinned: false, createdAt: now, updatedAt: now }
    const msgs = await db.messages.where('chatId').equals(id).toArray()
    await db.chats.add(copy)
    await db.messages.bulkAdd(msgs.map((m) => ({ ...m, id: nanoid(), chatId: copy.id })))
    await get().loadChats()
  },
  rateMessage: async (id, rating) => {
    await db.messages.update(id, { rating: rating as Message['rating'], updatedAt: Date.now() })
    set({ messages: get().messages.map((m) => (m.id === id ? { ...m, rating: rating as Message['rating'] } : m)) })
  }
}))

export { getRouterStats }
