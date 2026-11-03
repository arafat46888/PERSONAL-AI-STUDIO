import { db } from '@/database/db'
import { SCHEMA_VERSION } from '@/types'
import { downloadBlob, downloadText } from '@/services/storage/files'

export const APP_VERSION = '1.0.0'

export interface BackupPayload {
  app: 'personal-ai-studio'
  version: string
  schemaVersion: number
  exportedAt: number
  includesKeys: boolean
  counts: Record<string, number>
  data: {
    chats: unknown[]
    messages: unknown[]
    providers: unknown[]
    models: unknown[]
    memories: unknown[]
    projects: unknown[]
    prompts: unknown[]
    assistants: unknown[]
    folders: unknown[]
    settings: unknown[]
  }
}

export interface ExportCategories {
  chats: boolean
  providers: boolean
  memories: boolean
  projects: boolean
  prompts: boolean
  assistants: boolean
  settings: boolean
}

const ALL_ON: ExportCategories = { chats: true, providers: true, memories: true, projects: true, prompts: true, assistants: true, settings: true }

/** Build a backup. API keys are stripped unless explicitly requested. */
export async function buildBackup(chatIds?: string[], cats: Partial<ExportCategories> = {}, includeKeys = false): Promise<BackupPayload> {
  const c = { ...ALL_ON, ...cats }
  let chats: unknown[] = []
  let messages: unknown[] = []
  if (c.chats) {
    if (chatIds?.length) {
      chats = await db.chats.where('id').anyOf(chatIds).toArray()
      messages = await db.messages.where('chatId').anyOf(chatIds).toArray()
    } else {
      chats = await db.chats.toArray()
      messages = await db.messages.toArray()
    }
  }
  const providers = c.providers ? await db.providers.toArray() : []
  const safeProviders = includeKeys ? providers : providers.map((p) => ({ ...p, apiKey: '' }))
  const data = {
    chats,
    messages,
    providers: safeProviders,
    models: c.providers ? await db.models.toArray() : [],
    memories: c.memories ? await db.memories.toArray() : [],
    projects: c.projects ? await db.projects.toArray() : [],
    prompts: c.prompts ? await db.prompts.toArray() : [],
    assistants: c.assistants ? await db.assistants.toArray() : [],
    folders: c.settings ? await db.folders.toArray() : [],
    settings: c.settings ? await db.settings.toArray() : []
  }
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as unknown[]).length]))
  return { app: 'personal-ai-studio', version: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), includesKeys: includeKeys, counts, data }
}

export async function exportJSON(filename?: string, chatIds?: string[], cats?: Partial<ExportCategories>, includeKeys = false) {
  const payload = await buildBackup(chatIds, cats, includeKeys)
  downloadText(JSON.stringify(payload, null, 2), filename ?? `ai-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
  return payload
}

export async function exportZIP(chatIds?: string[], includeKeys = false) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const payload = await buildBackup(chatIds, {}, includeKeys)
  zip.file('backup.json', JSON.stringify(payload, null, 2))
  // Human-readable markdown per chat
  if (!chatIds) {
    for (const chat of (payload.data.chats as { id: string; title: string }[])) {
      const msgs = (payload.data.messages as { role: string; content: string; createdAt: number; modelName?: string }[]).filter((m) => (m as { chatId: string }).chatId === chat.id)
      const md = [`# ${chat.title}`, '', ...msgs.map((m) => `**${m.role}${m.modelName ? ` (${m.modelName})` : ''}** — ${new Date(m.createdAt).toLocaleString()}\n\n${m.content}\n---`)].join('\n')
      zip.file(`chats/${sanitize(chat.title)}-${chat.id.slice(0, 6)}.md`, md)
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `ai-studio-backup-${new Date().toISOString().slice(0, 10)}.zip`)
}

function sanitize(s: string) {
  return s.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'chat'
}

export function exportChatMarkdown(chatId: string, title: string, messages: { role: string; content: string; modelName?: string; createdAt: number }[]) {
  const md = [`# ${title}`, `Exported ${new Date().toLocaleString()} from Personal AI Studio`, '', ...messages.map((m) => `**${m.role}${m.modelName ? ` (${m.modelName})` : ''}**\n\n${m.content}\n\n---\n`)].join('\n')
  downloadText(md, `${sanitize(title)}.md`, 'text/markdown')
}

export function exportChatJSON(chatId: string, title: string) {
  void (async () => {
    const payload = await buildBackup([chatId])
    downloadText(JSON.stringify(payload, null, 2), `${sanitize(title)}.json`, 'application/json')
  })()
}

/* ---------------- Import ---------------- */

export interface ImportReport { added: Record<string, number>; skippedDuplicates: number; errors: string[] }

export function validateBackup(text: string): { ok: boolean; payload?: BackupPayload; error?: string } {
  try {
    const j = JSON.parse(text)
    if (j.app !== 'personal-ai-studio') return { ok: false, error: 'Not a Personal AI Studio backup file.' }
    if (typeof j.schemaVersion !== 'number') return { ok: false, error: 'Backup is missing a schema version.' }
    if (j.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `Backup schema v${j.schemaVersion} is newer than this app supports (v${SCHEMA_VERSION}). Update the application first.` }
    if (!j.data || typeof j.data !== 'object') return { ok: false, error: 'Backup has no data section.' }
    return { ok: true, payload: j as BackupPayload }
  } catch {
    return { ok: false, error: 'File is not valid JSON.' }
  }
}

export async function importBackup(payload: BackupPayload, mode: 'merge' | 'replace', selected: Partial<ExportCategories>): Promise<ImportReport> {
  const report: ImportReport = { added: {}, skippedDuplicates: 0, errors: [] }
  const on = (k: keyof ExportCategories) => selected[k] !== false
  try {
    if (on('chats')) {
      if (mode === 'replace') { const all = await db.chats.toArray(); for (const c of all) await db.chats.delete(c.id); await db.messages.clear() }
      const existingChats = new Set((await db.chats.toArray()).map((c) => c.id))
      const existingMsgs = new Set((await db.messages.toArray()).map((m) => m.id))
      const chats = (payload.data.chats ?? []) as Parameters<typeof db.chats.add>[0][]
      const msgs = (payload.data.messages ?? []) as Parameters<typeof db.messages.add>[0][]
      const newChats = chats.filter((c) => !existingChats.has(c.id))
      const newMsgs = msgs.filter((m) => !existingMsgs.has(m.id))
      report.skippedDuplicates += chats.length - newChats.length + msgs.length - newMsgs.length
      if (newChats.length) await db.chats.bulkAdd(newChats)
      if (newMsgs.length) await db.messages.bulkAdd(newMsgs)
      report.added.chats = newChats.length
      report.added.messages = newMsgs.length
    }
    if (on('providers')) {
      const ex = new Set((await db.providers.toArray()).map((p) => p.id))
      const provs = (payload.data.providers ?? []).filter((p) => !ex.has((p as { id: string }).id))
      if (provs.length) await db.providers.bulkAdd(provs as never)
      const exM = new Set((await db.models.toArray()).map((m) => m.id))
      const mods = (payload.data.models ?? []).filter((m) => !exM.has((m as { id: string }).id))
      if (mods.length) await db.models.bulkAdd(mods as never)
      report.added.providers = provs.length
      report.added.models = mods.length
    }
    if (on('memories')) {
      const ex = new Set((await db.memories.toArray()).map((m) => m.id))
      const items = (payload.data.memories ?? []).filter((m) => !ex.has((m as { id: string }).id))
      if (items.length) await db.memories.bulkAdd(items as never)
      report.added.memories = items.length
    }
    if (on('projects')) {
      const ex = new Set((await db.projects.toArray()).map((m) => m.id))
      const items = (payload.data.projects ?? []).filter((m) => !ex.has((m as { id: string }).id))
      if (items.length) await db.projects.bulkAdd(items as never)
      report.added.projects = items.length
    }
    if (on('prompts')) {
      const ex = new Set((await db.prompts.toArray()).map((m) => m.id))
      const items = (payload.data.prompts ?? []).filter((m) => !ex.has((m as { id: string }).id))
      if (items.length) await db.prompts.bulkAdd(items as never)
      report.added.prompts = items.length
    }
    if (on('assistants')) {
      const ex = new Set((await db.assistants.toArray()).map((m) => m.id))
      const items = (payload.data.assistants ?? []).filter((m) => !ex.has((m as { id: string }).id))
      if (items.length) await db.assistants.bulkAdd(items as never)
      report.added.assistants = items.length
    }
    if (on('settings')) {
      const items = (payload.data.settings ?? []) as { key: string; value: unknown }[]
      for (const it of items) await db.settings.put(it)
      report.added.settings = items.length
    }
    await db.backups.add({ id: `imp-${Date.now()}`, date: Date.now(), version: payload.schemaVersion, meta: JSON.stringify({ from: payload.version, mode, report: report.added }) })
  } catch (e) {
    report.errors.push(e instanceof Error ? e.message : 'Import failed midway. Some categories may already be restored.')
  }
  return report
}
