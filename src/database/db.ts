import Dexie, { type Table } from 'dexie'
import type { Chat, Message, Provider, AIModel, Memory, Project, Prompt, Assistant, Folder, UsageLog } from '@/types'

export class StudioDB extends Dexie {
  chats!: Table<Chat, string>
  messages!: Table<Message, string>
  providers!: Table<Provider, string>
  models!: Table<AIModel, string>
  memories!: Table<Memory, string>
  projects!: Table<Project, string>
  prompts!: Table<Prompt, string>
  assistants!: Table<Assistant, string>
  folders!: Table<Folder, string>
  usageLogs!: Table<UsageLog, string>
  settings!: Table<{ key: string; value: unknown }, string>
  backups!: Table<{ id: string; date: number; version: number; meta: string }, string>

  constructor() {
    super('personal-ai-studio')
    this.version(1).stores({
      chats: 'id, updatedAt, projectId, assistantId, folderId, pinned, archived, title',
      messages: 'id, chatId, createdAt, parentMessageId, branchId, [chatId+createdAt]',
      providers: 'id, name, enabled, priority',
      models: 'id, providerId, modelId, enabled',
      memories: 'id, scope, scopeId, title',
      projects: 'id, name, pinned, archived',
      prompts: 'id, category, favorite',
      assistants: 'id, name, projectId',
      folders: 'id, name',
      usageLogs: 'id, chatId, providerId, createdAt',
      settings: 'key',
      backups: 'id, date'
    })
  }
}

export const db = new StudioDB()

/** Cascading delete: chat + its messages + its chat-scoped memories. */
export async function deleteChatCascade(chatId: string) {
  await db.transaction('rw', [db.chats, db.messages, db.memories], async () => {
    await db.messages.where('chatId').equals(chatId).delete()
    await db.memories.where('scope').equals('chat').and((m) => m.scopeId === chatId).delete()
    await db.chats.delete(chatId)
  })
}

export async function deleteProjectCascade(projectId: string) {
  await db.transaction('rw', [db.projects, db.chats, db.memories], async () => {
    await db.chats.where('projectId').equals(projectId).modify({ projectId: undefined })
    await db.memories.where('scope').equals('project').and((m) => m.scopeId === projectId).delete()
    await db.projects.delete(projectId)
  })
}

export async function deleteProviderCascade(providerId: string) {
  await db.transaction('rw', [db.providers, db.models], async () => {
    await db.models.where('providerId').equals(providerId).delete()
    await db.providers.delete(providerId)
  })
}

export async function estimateStorage(): Promise<{ used: number; quota: number } | null> {
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate()
    return { used: e.usage ?? 0, quota: e.quota ?? 0 }
  }
  return null
}
