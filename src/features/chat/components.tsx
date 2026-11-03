import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { nanoid } from 'nanoid'
import {
  Send, Square, Paperclip, Mic, MicOff, ImagePlus, Wrench, Globe, Brain,
  Clock, MoreHorizontal, Copy, RotateCcw, Pencil, Play, Pause, CircleStop, Languages,
  Sparkles, ListChecks, BrainCog, BookmarkPlus, StickyNote, ThumbsUp, ThumbsDown,
  GitBranch, Trash2, X, Check, Loader2, AlertTriangle, Eye
} from 'lucide-react'
import { cx, Button, Menu, Textarea, Badge } from '@/components/ui'
import { Markdown } from '@/components/common/Markdown'
import { ModelSelector } from '@/features/models/ModelSelector'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSTT, useTTS, startRecording, speechRecognitionSupported, type RecorderHandle } from '@/services/voice'
import { buildAttachment } from '@/services/storage/files'
import { db } from '@/database/db'
import type { AIModel, Attachment, Message } from '@/types'
import { timeAgo } from '@/utils'

/* ================= Composer ================= */

export function Composer({ chatId, initialModel }: { chatId?: string; initialModel?: string }) {
  const nav = useNavigate()
  const settings = useAppStore((s) => s.settings)
  const toast = useAppStore((s) => s.toast)
  const streaming = useAppStore((s) => s.streamingChatId)
  const store = useChatStore()
  const drafts = useChatStore((s) => s.drafts)
  const setDraft = useChatStore((s) => s.setDraft)
  const key = chatId ?? '__new__'
  const text = drafts[key] ?? ''
  const setText = (v: string) => setDraft(key, v)

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null)
  const [modelOverride, setModelOverride] = useState<string | undefined>(initialModel)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tempChat, setTempChat] = useState(settings.chat.tempChat)
  const [thinking, setThinking] = useState(false)
  const [webSearch] = useState(false) // No verified search integration is configured — toggle stays disabled.
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)

  const stt = useSTT()
  const [recording, setRecording] = useState(false)
  const recHandle = useRef<RecorderHandle | null>(null)
  const recTimer = useRef<number | undefined>(undefined)
  const [recSecs, setRecSecs] = useState(0)

  const isStreaming = !!streaming && (!chatId || streaming === chatId)

  // Auto-expand textarea
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'
  }, [text])

  const doSend = useCallback(async () => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    if (isStreaming) return
    setText('')
    const atts = attachments
    setAttachments([])
    if (!chatId) {
      const chat = await store.newChat({ modelId: modelOverride, temporary: tempChat })
      nav(`/chat/${chat.id}`)
      await useChatStore.getState().sendMessage(t, atts, modelOverride)
    } else {
      await store.sendMessage(t, atts, modelOverride)
    }
    void thinking // reserved: passed to providers that expose reasoning modes in a future adapter hook
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, attachments, chatId, isStreaming, modelOverride, tempChat, thinking, nav])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const enterToSend = settings.chat.enterToSend
    if (e.key === 'Enter' && !e.shiftKey) {
      if (enterToSend && !e.nativeEvent.isComposing) { e.preventDefault(); void doSend() }
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); void doSend()
    }
  }

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      setUploading({ name: file.name, pct: 0 })
      try {
        const att = await buildAttachment(file, (p) => setUploading({ name: file.name, pct: p }))
        setAttachments((a) => [...a, att])
        if (att.kind === 'document' && !att.text) toast('warning', 'No text extracted', `"${file.name}" could not be parsed. Install the matching parser or paste its contents.`)
      } catch (err) {
        toast('error', 'Upload failed', err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(null)
      }
    }
  }

  const hasImages = attachments.some((a) => a.kind === 'image')

  const toggleDictation = () => {
    if (stt.listening) { stt.stop(); return }
    if (!speechRecognitionSupported()) { toast('warning', 'Not supported here', 'Live dictation needs a browser with the Web Speech API (Chrome/Edge). You can still record audio and transcribe it.'); return }
    stt.start(settings.voice.sttLanguage, (final) => setText((textRef.current + ' ' + final).trim()))
  }
  const textRef = useRef(text)
  textRef.current = text

  const toggleRecord = async () => {
    if (recording) {
      window.clearInterval(recTimer.current)
      const blob = await recHandle.current?.stop()
      setRecording(false)
      if (blob && blob.size > 1500) {
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })
        const att: Attachment = { id: nanoid(), name: file.name, mime: blob.type, size: blob.size, kind: 'audio' }
        if (settings.voice.engine === 'browser') {
          toast('info', 'Audio attached', 'Browser engine cannot transcribe files. Configure a local Whisper endpoint in Settings → Voice to enable transcription.')
          setAttachments((a) => [...a, att])
        }
      }
      return
    }
    try {
      const { handle } = await startRecording()
      recHandle.current = handle
      setRecording(true)
      setRecSecs(0)
      recTimer.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000)
    } catch {
      toast('error', 'Microphone permission denied', 'Allow microphone access in your browser to record.')
    }
  }

  return (
    <div className={cx('mx-auto w-full max-w-3xl px-3 sm:px-4 pb-2 sm:pb-3 pt-1')}>
      {stt.error && <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300"><AlertTriangle size={13} />{stt.error}</div>}
      {uploading && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs text-ink-dim">
          <Loader2 size={12} className="animate-spin" /> Processing {uploading.name}…
          <div className="h-1.5 grow overflow-hidden rounded-full bg-surface-overlay"><div className="h-full bg-accent transition-all" style={{ width: `${uploading.pct}%` }} /></div>
        </div>
      )}
      <div className={cx('rounded-2xl border bg-surface-raised shadow-lg transition-colors', 'border-line focus-within:border-[var(--accent)]')}>
        {(attachments.length > 0 || stt.listening || recording) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            {stt.listening && <Badge tone="accent"><Mic size={11} className="animate-pulse" /> Listening… {stt.interim && <span className="italic normal-case font-normal ml-1 truncate max-w-[180px]">{stt.interim}</span>}</Badge>}
            {recording && <Badge tone="error"><CircleStop size={11} /> REC {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}</Badge>}
            {attachments.map((a) => (
              <span key={a.id} className="group relative inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-overlay px-2 py-1 text-xs max-w-[220px]">
                {a.kind === 'image' && a.dataUrl
                  ? <img src={a.dataUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
                  : a.kind === 'audio' ? <Mic size={13} /> : <Paperclip size={12} />}
                <span className="truncate">{a.name}</span>
                {a.kind === 'document' && a.text === '' && <AlertTriangle size={11} className="text-amber-400" aria-label="No text extracted" />}
                <button aria-label={`Remove ${a.name}`} className="ml-0.5 rounded-full p-0.5 hover:bg-surface text-ink-faint hover:text-ink" onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5 px-2.5 py-2">
          <textarea
            ref={taRef}
            rows={1}
            aria-label="Message input"
            placeholder={isStreaming ? 'Generating… you can still type' : 'Message… (Enter to send, Shift+Enter for newline)'}
            className="max-h-[220px] min-h-[24px] w-full resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-ink-faint"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); void addFiles(fs) } }}
          />
          {!isStreaming ? (
            <Button variant="primary" size="icon" aria-label="Send message" disabled={!text.trim() && attachments.length === 0} onClick={() => void doSend()} className="mb-0.5 rounded-xl h-9 w-9">
              <Send size={16} />
            </Button>
          ) : (
            <Button variant="danger" size="icon" aria-label="Stop generation" onClick={() => store.stopGeneration()} className="mb-0.5 rounded-xl h-9 w-9">
              <Square size={14} fill="currentColor" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
          <input ref={fileRef} type="file" hidden multiple accept=".txt,.md,.json,.csv,.pdf,.docx,.xlsx,.log,.yml,.yaml,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.go,.rs,.rb,.php,.sh,.sql" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          <input ref={imgRef} type="file" hidden multiple accept="image/*" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          <Button variant="ghost" size="icon" aria-label="Attach file" title="Attach document" onClick={() => fileRef.current?.click()} className="h-8 w-8"><Paperclip size={15} /></Button>
          <Button variant="ghost" size="icon" aria-label="Attach image" title="Attach image" onClick={() => imgRef.current?.click()} className="h-8 w-8"><ImagePlus size={15} /></Button>
          <Button variant="ghost" size="icon" aria-label={recording ? 'Stop recording' : 'Record audio'} title="Voice recording" onClick={() => void toggleRecord()} className={cx('h-8 w-8', recording && 'text-red-400')}>{recording ? <MicOff size={15} /> : <Mic size={15} />}</Button>
          <Button variant="ghost" size="icon" aria-label="Dictate with speech recognition" title="Speech dictation" onClick={toggleDictation} className={cx('h-8 w-8', stt.listening && 'text-[var(--accent)]')}><Sparkles size={15} /></Button>
          <div className="mx-1 h-4 w-px bg-[var(--border)]" />
          <ModelSelector value={modelOverride ?? (chatId ? useChatStore.getState().chats.find((c) => c.id === chatId)?.modelId : settings.general.defaultModelId)} onChange={(m) => { setModelOverride(m); if (chatId) void store.setChatModel(chatId, m) }} compact />
          <div className="relative ml-auto">
            <Button variant="ghost" size="icon" aria-label="Tools menu" title="Tools & modes" onClick={() => setToolsOpen((v) => !v)} className={cx('h-8 w-8', toolsOpen && 'bg-surface-overlay')}><Wrench size={14} /></Button>
            {toolsOpen && (
              <div className="absolute bottom-10 right-0 z-30 w-60 rounded-xl border border-line bg-surface-raised p-2 shadow-xl space-y-1 fade-up" role="menu">
                <ToolRow checked={tempChat} onToggle={(v) => { setTempChat(v); if (chatId) void db.chats.update(chatId, { temporary: v }) }}>
                  <Clock size={13} /> Temporary chat <span className="text-ink-faint text-[11px] ml-auto">not saved</span>
                </ToolRow>
                <ToolRow checked={thinking} disabled={!selectedModelSupportsReasoning(modelOverride, chatId)} onToggle={setThinking} hintIfDisabled="Selected model does not advertise reasoning support.">
                  <Brain size={13} /> Thinking mode
                </ToolRow>
                <ToolRow checked={false} disabled onToggle={() => {}} hintIfDisabled="No web search provider is configured. Add one under Settings → Providers to enable this.">
                  <Globe size={13} /> Web search
                </ToolRow>
              </div>
            )}
          </div>
          <Menu align="right" trigger={<Button variant="ghost" size="icon" aria-label="More composer options" className="h-8 w-8"><MoreHorizontal size={15} /></Button>} items={[
            { label: 'Clear draft', icon: <Trash2 size={13} />, onClick: () => setText(''), disabled: !text },
            { label: tempChat ? 'Turn off temporary chat' : 'Turn on temporary chat', icon: <Clock size={13} />, onClick: () => setTempChat((v) => !v) },
            { label: 'Compare models', icon: <Eye size={13} />, onClick: () => { (window as unknown as { __comparePrefill?: string }).__comparePrefill = text; nav('/compare') } }
          ]} />
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-ink-faint">
        <span>{hasImages ? 'Images require a vision-capable model — Smart Routing will pick one.' : 'Responses stream live from your configured providers.'}</span>
        <span>{text.length.toLocaleString()} chars</span>
      </div>
    </div>
  )
}

function ToolRow({ checked, onToggle, children, disabled, hintIfDisabled }: { checked: boolean; onToggle: (v: boolean) => void; children: React.ReactNode; disabled?: boolean; hintIfDisabled?: string }) {
  return (
    <button role="menuitemcheckbox" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onToggle(!checked)}
      className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]', disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-overlay text-left')}>
      <span className={cx('flex h-4 w-4 items-center justify-center rounded border', checked ? 'bg-accent border-accent text-white' : 'border-line')}>{checked && <Check size={10} />}</span>
      {children}
      {disabled && hintIfDisabled && <span className="sr-only">{hintIfDisabled}</span>}
    </button>
  )
}

function selectedModelSupportsReasoning(modelOverride?: string, chatId?: string) {
  const chatModelId = chatId ? useChatStore.getState().chats.find((c) => c.id === chatId)?.modelId : undefined
  const id = modelOverride ?? chatModelId ?? useAppStore.getState().settings.general.defaultModelId
  if (!id) return false
  const cache = (window as unknown as { __modelCache?: Record<string, AIModel | null> }).__modelCache
  if (cache && id in cache) return !!cache[id]?.capabilities.reasoning
  void db.models.get(id).then((m) => {
    const c = ((window as unknown as { __modelCache?: Record<string, AIModel | null> }).__modelCache ??= {})
    c[id] = m ?? null
  })
  return true // optimistic until lookup completes
}

/* ================= Message bubble + actions ================= */

interface MsgProps { msg: Message; onAction: (a: string) => void }

export function MessageBubble({ msg, onAction }: MsgProps) {
  const settings = useAppStore((s) => s.settings)
  const toast = useAppStore((s) => s.toast)
  const tts = useTTS()
  const rateMessage = useChatStore((s) => s.rateMessage)
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(msg.content)
  const [copied, setCopied] = useState(false)
  const isUser = msg.role === 'user'
  const speaking = tts.utteranceId === `msg-${msg.id}`

  const copy = async () => {
    await navigator.clipboard.writeText(msg.content)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
    toast('success', 'Message copied')
  }

  const readAloud = () => {
    if (speaking) { tts.stop(); return }
    if (!('speechSynthesis' in window)) { toast('warning', 'Text-to-speech unsupported', 'This browser does not provide SpeechSynthesis.'); return }
    tts.speak(msg.content, { voiceURI: settings.voice.ttsVoice || undefined, rate: settings.voice.ttsRate, onStart: () => useTTS.setState({ utteranceId: `msg-${msg.id}` }) })
  }

  const rememberThis = async () => {
    const title = window.prompt('Give this memory a short label:', msg.content.slice(0, 40))
    if (!title) return
    await db.memories.add({ id: nanoid(), scope: 'chat', scopeId: msg.chatId, title, content: msg.content, approved: true, createdAt: Date.now(), updatedAt: Date.now() })
    toast('success', 'Saved to conversation memory', 'Only this conversation can see it.')
  }

  const saveAsNote = async () => {
    await db.prompts.add({ id: nanoid(), title: `Note: ${msg.content.slice(0, 30)}`, content: msg.content, category: 'Custom', favorite: false, variables: [], createdAt: Date.now(), updatedAt: Date.now() })
    toast('success', 'Saved as note in Prompt Library')
  }

  const translate = () => onAction(`Translate the following message into another language. Ask me which language first if unclear.\n"""\n${msg.content}\n"""`)
  const explain = () => onAction(`Explain the following content in more detail, simply and clearly:\n"""\n${msg.content}\n"""`)
  const summarize = () => onAction(`Summarize the following content in concise bullet points:\n"""\n${msg.content}\n"""`)

  return (
    <div className={cx('msg-gap group flex gap-3 py-4', isUser && 'flex-row-reverse')}>
      <div className={cx('flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full border border-line text-xs font-bold', isUser ? 'bg-surface-overlay' : 'bg-[color-mix(in_srgb,var(--accent)_25%,var(--bg-raised))] text-white')}>
        {isUser ? 'You' : <Sparkles size={14} />}
      </div>
      <div className={cx('min-w-0 max-w-[calc(100%-3rem)]', isUser && 'text-right')}>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className={cx('mb-2 flex flex-wrap gap-2', isUser && 'justify-end')}>
            {msg.attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs max-w-[240px]">
                {a.kind === 'image' && a.dataUrl ? <img src={a.dataUrl} alt={a.name} className="h-10 w-10 rounded-md object-cover cursor-zoom-in" title={a.name} onClick={() => window.open(a.dataUrl, '_blank', 'noopener')} />
                  : a.kind === 'audio' ? <Mic size={13} /> : <Paperclip size={12} />}
                <span className="truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className={cx('inline-block rounded-2xl px-4 py-2.5 text-left text-[15px] leading-relaxed', isUser ? 'bg-[color-mix(in_srgb,var(--accent)_16%,var(--bg-raised))] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)]' : 'bg-surface-raised border border-line', msg.status === 'error' && 'border-red-500/40')}>
          {editing ? (
            <div className="w-[min(560px,70vw)]">
              <Textarea value={editVal} onChange={(e) => setEditVal(e.target.value)} rows={4} autoFocus />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditVal(msg.content) }}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={() => { setEditing(false); onAction(`__edit:${msg.id}:${editVal}`) }}>Save & resend</Button>
              </div>
            </div>
          ) : msg.content ? (
            <Markdown content={msg.content} streaming={msg.status === 'streaming'} />
          ) : msg.status === 'streaming' || msg.status === 'pending' ? (
            <span className="dot-typing inline-flex items-center"><span /><span /><span /></span>
          ) : null}
          {msg.status === 'stopped' && <div className="mt-1 text-[11px] text-amber-400">Generation stopped — partial response saved.</div>}
          {msg.status === 'error' && msg.error && <div className="mt-1 text-[12px] text-red-400">{msg.error}</div>}
        </div>

        {/* meta line */}
        <div className={cx('mt-1 flex items-center gap-2 text-[11px] text-ink-faint', isUser && 'justify-end')}>
          {msg.modelName && <span>{msg.modelName}</span>}
          <span>{timeAgo(msg.createdAt)}</span>
          {msg.rating === 'like' && <ThumbsUp size={11} className="text-emerald-400" />}
          {msg.rating === 'dislike' && <ThumbsDown size={11} className="text-red-400" />}
        </div>

        {/* actions */}
        <div className={cx('mt-1 flex flex-wrap items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100', isUser && 'justify-end')}>
          <ActBtn label={copied ? 'Copied' : 'Copy'} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</ActBtn>
          {isUser ? (
            <>
              <ActBtn label="Edit & resend" onClick={() => setEditing(true)}><Pencil size={13} /></ActBtn>
              <ActBtn label="Delete" onClick={() => onAction(`__del:${msg.id}`)}><Trash2 size={13} /></ActBtn>
            </>
          ) : (
            <>
              <ActBtn label="Regenerate" onClick={() => onAction(`__regen:${msg.id}`)} disabled={!!useAppStore.getState().streamingChatId}><RotateCcw size={13} /></ActBtn>
              {(msg.status === 'stopped' || msg.status === 'error') && <ActBtn label="Continue generating" onClick={() => onAction(`__cont:${msg.id}`)}><Play size={13} /></ActBtn>}
              <ActBtn label={speaking ? 'Stop reading' : 'Read aloud'} onClick={readAloud}>{speaking ? <Pause size={13} /> : <Play size={13} />}</ActBtn>
              {tts.speaking && !speaking && <ActBtn label="Stop other playback" onClick={() => tts.stop()}><CircleStop size={13} /></ActBtn>}
              <ActBtn label="Translate" onClick={translate}><Languages size={13} /></ActBtn>
              <ActBtn label="Explain" onClick={explain}><ListChecks size={13} /></ActBtn>
              <ActBtn label="Summarize" onClick={summarize}><ListChecks size={13} /></ActBtn>
              <ActBtn label="Ask follow-up" onClick={() => onAction('__followup')}><Send size={12} /></ActBtn>
              <Menu align="left" trigger={<button aria-label="More message actions" className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-overlay hover:text-ink"><MoreHorizontal size={14} /></button>} items={[
                { label: 'Remember this (conversation memory)', icon: <BrainCog size={13} />, onClick: () => void rememberThis() },
                { label: 'Forget related memory', icon: <Brain size={13} />, onClick: () => onAction(`__forget:${msg.id}`) },
                { label: 'Add to project memory', icon: <BookmarkPlus size={13} />, onClick: () => onAction(`__projmem:${msg.id}`) },
                { label: 'View related memory', icon: <Eye size={13} />, onClick: () => onAction(`__viewmem:${msg.id}`) },
                { label: 'Save as note', icon: <StickyNote size={13} />, onClick: () => void saveAsNote() },
                { label: msg.rating === 'like' ? 'Remove like' : 'Like', icon: <ThumbsUp size={13} />, onClick: () => void rateMessage(msg.id, msg.rating === 'like' ? undefined : 'like') },
                { label: msg.rating === 'dislike' ? 'Remove dislike' : 'Dislike', icon: <ThumbsDown size={13} />, onClick: () => void rateMessage(msg.id, msg.rating === 'dislike' ? undefined : 'dislike') },
                { label: 'Retry', icon: <RotateCcw size={13} />, onClick: () => onAction(`__regen:${msg.id}`) },
                { label: 'Branch from here', icon: <GitBranch size={13} />, onClick: () => onAction(`__branch:${msg.id}`) },
                { label: 'Delete', icon: <Trash2 size={13} />, danger: true, onClick: () => onAction(`__del:${msg.id}`) }
              ]} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ActBtn({ label, children, onClick, disabled }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button title={label} aria-label={label} disabled={disabled} onClick={onClick} className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-overlay hover:text-ink disabled:opacity-40">{children}</button>
}

/* ================= Selection toolbar (Ask selected text) ================= */

const SELECTION_ACTIONS = [
  { id: 'ask', label: 'Ask AI', prompt: (t: string) => `Regarding this selected text, answer my follow-up question. Selected text:\n"""\n${t}\n"""` },
  { id: 'explain', label: 'Explain', prompt: (t: string) => `Explain the following selected text clearly:\n"""\n${t}\n"""` },
  { id: 'summarize', label: 'Summarize', prompt: (t: string) => `Summarize the following selected text:\n"""\n${t}\n"""` },
  { id: 'translate', label: 'Translate', prompt: (t: string) => `Translate the following selected text. Ask me for the target language if needed:\n"""\n${t}\n"""` },
  { id: 'rewrite', label: 'Rewrite', prompt: (t: string) => `Rewrite the following selected text with improved clarity while preserving meaning:\n"""\n${t}\n"""` },
  { id: 'simplify', label: 'Simplify', prompt: (t: string) => `Simplify the following selected text for a beginner:\n"""\n${t}\n"""` },
  { id: 'grammar', label: 'Fix Grammar', prompt: (t: string) => `Correct grammar and spelling in the following text and show only the corrected version:\n"""\n${t}\n"""` },
  { id: 'code', label: 'Generate Code', prompt: (t: string) => `Based on the following description, generate working code:\n"""\n${t}\n"""` },
  { id: 'copy', label: 'Copy', prompt: null }
]

export function SelectionToolbar({ onAction }: { onAction: (prompt: string) => void }) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)
  const toast = useAppStore((s) => s.toast)

  useEffect(() => {
    let timer = 0
    const handler = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const s = window.getSelection()
        const text = s?.toString().trim() ?? ''
        if (!text || text.length < 2 || !s || s.rangeCount === 0) { setSel(null); return }
        const node = s.anchorNode
        let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null
        // Do not intercept selections inside editable fields
        if (el?.closest('textarea, input, [contenteditable="true"], .no-select-toolbar')) { setSel(null); return }
        // Only within message content
        if (!el?.closest('.md')) { setSel(null); return }
        const rect = s.getRangeAt(0).getBoundingClientRect()
        setSel({ text, x: rect.left + rect.width / 2, y: rect.top - 8 })
      }, 250)
    }
    document.addEventListener('mouseup', handler)
    document.addEventListener('touchend', handler)
    document.addEventListener('selectionchange', handler)
    return () => { document.removeEventListener('mouseup', handler); document.removeEventListener('touchend', handler); document.removeEventListener('selectionchange', handler); window.clearTimeout(timer) }
  }, [])

  if (!sel) return null
  return createPortalEl(
    <div className="fixed z-50 -translate-x-1/2 -translate-y-full" style={{ left: Math.max(140, Math.min(window.innerWidth - 140, sel.x)), top: Math.max(70, sel.y) }} role="toolbar" aria-label="Selection actions">
      <div className="fade-up flex max-w-[92vw] items-center gap-0.5 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1 shadow-2xl">
        {SELECTION_ACTIONS.map((a) => (
          <button key={a.id} className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-dim hover:bg-surface-overlay hover:text-ink"
            onClick={() => {
              if (a.id === 'copy') { void navigator.clipboard.writeText(sel.text); toast('success', 'Copied selection') }
              else if (a.prompt) { onAction(a.prompt(sel.text)); setSel(null); window.getSelection()?.removeAllRanges() }
            }}>{a.label}</button>
        ))}
        <button aria-label="Close selection toolbar" className="rounded-lg p-1.5 text-ink-faint hover:text-ink" onClick={() => setSel(null)}><X size={13} /></button>
      </div>
    </div>
  )
}

function createPortalEl(el: React.ReactElement) {
  return createPortal(el, document.body)
}

/* ================= New-chat welcome screen ================= */

const SUGGESTIONS = [
  { icon: <LightbulbIcon />, label: 'Explain something', prompt: 'Explain ' },
  { icon: <Code2Icon />, label: 'Write code', prompt: 'Write code that ' },
  { icon: <FileIcon />, label: 'Analyze a document', prompt: 'Analyze this document and highlight key insights: ' },
  { icon: <GradIcon />, label: 'Help me learn', prompt: 'Create a step-by-step learning plan for ' },
  { icon: <SparkIcon />, label: 'Generate an idea', prompt: 'Generate creative ideas for ' },
  { icon: <BugIcon />, label: 'Fix a programming error', prompt: 'Help me fix this programming error:\n```\n\n```' }
]

export function WelcomeScreen({ onPick, recent }: { onPick: (text: string) => void; recent: { id: string; title: string }[] }) {
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-8">
      <div className="w-full max-w-2xl text-center fade-up">
        <img src="/icons/icon.svg" alt="Personal AI Studio logo" className="mx-auto h-16 w-16 rounded-2xl shadow-lg" />
        <h1 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight">Welcome to Personal AI Studio</h1>
        <p className="mt-2 text-sm text-ink-dim">Your models, your intelligence, your workspace. Connect any OpenAI-compatible or Gemini provider below and everything stays on this device.</p>
        <div className="mt-3 flex justify-center"><ComposerSlotHint /></div>
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} onClick={() => onPick(s.prompt)} className="group flex items-center gap-2.5 rounded-xl border border-line bg-surface-raised px-3.5 py-3 text-left text-[13px] font-medium text-ink-dim hover:border-[var(--accent)] hover:text-ink transition-colors">
              <span className="text-[var(--accent)]">{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
        {recent.length > 0 && (
          <div className="mt-8 text-left">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Recent conversations</h3>
            <div className="flex flex-wrap gap-2">
              {recent.slice(0, 5).map((r) => (
                <button key={r.id} onClick={() => { window.location.hash = `#/chat/${r.id}` }} className="rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-dim hover:text-ink hover:border-[var(--accent)] truncate max-w-[220px]">
                  {r.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ComposerSlotHint() {
  const [count, setCount] = useState(-1)
  useEffect(() => { void db.providers.count().then(setCount) }, [])
  if (count === 0) return <Badge tone="warn">No providers yet — open Settings → Providers to connect your own API keys.</Badge>
  if (count < 0) return null
  return <Badge tone="ok">{count} provider{count > 1 ? 's' : ''} configured locally</Badge>
}

function LightbulbIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg> }
function Code2Icon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg> }
function FileIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg> }
function GradIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10 12 5 2 10l10 5 10-5zM6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg> }
function SparkIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3 1.9 5.7L19.5 11l-5.6 2.3L12 19l-1.9-5.7L4.5 11l5.6-2.3z"/></svg> }
function BugIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m8 2 1.9 3.9M16 2l-1.9 3.9"/><rect x="8" y="6" width="8" height="12" rx="4"/><path d="M8 10H4m16 0h-4M8 14H3m18 0h-5M8 18l-2.5 2.5M16 18l2.5 2.5"/></svg> }


