export type ProviderFormat = 'openai-compatible' | 'gemini' | 'custom'
export type ConnectionStatus = 'unknown' | 'ok' | 'error' | 'needs-attention'

export interface ModelCapabilities {
  streaming: boolean
  vision: boolean
  tools: boolean
  reasoning: boolean
  json: boolean
  imageInput: boolean
  audioInput: boolean
  audioOutput: boolean
  systemInstructions: boolean
}

export interface AIModel {
  id: string
  providerId: string
  name: string
  modelId: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities: ModelCapabilities
  enabled: boolean
  priority: number
  isDefault?: boolean
  createdAt: number
}

export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  format: ProviderFormat
  defaultModelId: string
  customHeaders?: Record<string, string>
  timeout: number
  maxTokens?: number
  enabled: boolean
  priority: number
  lastTestedAt?: number
  connectionStatus: ConnectionStatus
  createdAt: number
  updatedAt: number
}

export interface Attachment {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'text' | 'document' | 'audio' | 'other'
  dataUrl?: string // images kept as data URL for vision requests
  text?: string // extracted text for documents
}

export interface Message {
  id: string
  chatId: string
  parentMessageId?: string
  branchId?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: Attachment[]
  modelId?: string
  providerId?: string
  modelName?: string // historical metadata retained even if model deleted
  status: 'pending' | 'streaming' | 'complete' | 'error' | 'stopped'
  rating?: 'like' | 'dislike'
  error?: string
  createdAt: number
  updatedAt: number
}

export interface Chat {
  id: string
  title: string
  projectId?: string
  assistantId?: string
  folderId?: string
  modelId?: string
  providerId?: string
  pinned: boolean
  archived: boolean
  temporary: boolean
  createdAt: number
  updatedAt: number
}

export interface Memory {
  id: string
  scope: 'global' | 'chat' | 'project'
  scopeId?: string
  title: string
  content: string
  approved: boolean
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  description?: string
  icon?: string
  instructions?: string
  pinned: boolean
  archived: boolean
  createdAt: number
  updatedAt: number
}

export interface Prompt {
  id: string
  title: string
  content: string
  category: string
  favorite: boolean
  variables: string[]
  createdAt: number
  updatedAt: number
}

export interface Assistant {
  id: string
  name: string
  description?: string
  avatar?: string
  instructions: string
  defaultModelId?: string
  temperature?: number
  maxTokens?: number
  projectId?: string
  memoryAccess: boolean
  enabledTools: string[]
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  createdAt: number
}

export interface UsageLog {
  id: string
  chatId?: string
  providerId: string
  modelId: string
  promptChars: number
  completionChars: number
  latencyMs: number
  success: boolean
  error?: string
  createdAt: number
}

export type RoutingMode = 'manual' | 'failover' | 'smart'

export interface RouterSettings {
  mode: RoutingMode
  primaryModelId?: string
  secondaryModelId?: string
  fallbackModelIds: string[]
  maxRetries: number
  timeoutMs: number
  retryDelayMs: number
  failureCooldownMs: number
}

export interface AppSettings {
  general: { language: string; defaultModelId: string; startupPage: string; autoSave: boolean; confirmBeforeDelete: boolean }
  appearance: { theme: 'dark' | 'light' | 'system'; accent: string; fontFamily: string; fontSize: 'sm' | 'base' | 'lg'; messageWidth: 'narrow' | 'normal' | 'wide'; sidebarWidth: number; density: 'compact' | 'comfortable'; animations: boolean }
  chat: { enterToSend: boolean; markdown: boolean; codeHighlight: boolean; autoScroll: boolean; autoTitle: boolean; tempChat: boolean }
  voice: { sttLanguage: string; ttsVoice: string; ttsRate: number; autoRead: boolean; engine: 'browser' | 'whisper-local' }
  memory: { globalEnabled: boolean; chatEnabled: boolean; projectEnabled: boolean; approvalRequired: boolean }
  router: RouterSettings
  advanced: { debugMode: boolean; allowSaveUntested: boolean; exportIncludesKeys: boolean }
  shortcuts: Record<string, string>
}

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  streaming: true, vision: false, tools: false, reasoning: false, json: false,
  imageInput: false, audioInput: false, audioOutput: false, systemInstructions: true
}

export const SCHEMA_VERSION = 1

export interface WorkspaceProject {
  id: string
  name: string
  files: CodeFile[]
  createdAt: number
  updatedAt: number
}

export interface CodeFile {
  id: string
  projectId: string
  name: string
  language: string
  content: string
  dirty: boolean
}
