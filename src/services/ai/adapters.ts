import type { Provider, AIModel } from '@/types'

export interface ChatRequestMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[] // data URLs, only sent to vision-capable models
}

export interface CompletionParams {
  provider: Provider
  model: AIModel
  messages: ChatRequestMessage[]
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  jsonMode?: boolean
  onDelta: (text: string) => void
}

export class ProviderError extends Error {
  constructor(
    public status: number | null,
    public retryable: boolean,
    message: string,
    public retryAfterMs?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Map HTTP status to a friendly, safe message (never leaks secrets). */
export function describeHttpError(status: number, body?: string): string {
  const map: Record<number, string> = {
    400: 'Bad request — the provider rejected the payload.',
    401: 'Invalid API key or missing authentication.',
    403: 'Access forbidden — your key may lack permission for this model.',
    404: 'Model or endpoint not found at this provider.',
    408: 'Request timed out on the provider side.',
    413: 'Payload too large — reduce attachments or conversation length.',
    429: 'Rate limit exceeded — please wait before retrying.',
    500: 'Provider internal error.',
    502: 'Provider gateway error.',
    503: 'Provider unavailable.',
    504: 'Provider upstream timeout.'
  }
  let msg = map[status] ?? `HTTP error ${status}.`
  if (body && body.length < 300) {
    try {
      const j = JSON.parse(body)
      const detail = j?.error?.message ?? j?.message
      if (typeof detail === 'string') msg += ` (${detail.slice(0, 160)})`
    } catch {
      /* ignore non-JSON bodies */
    }
  }
  return msg
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  return b + path
}

function authHeaders(p: Provider): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(p.customHeaders ?? {}) }
  if (p.apiKey) {
    if (p.format === 'gemini') h['x-goog-api-key'] = p.apiKey
    else h['Authorization'] = `Bearer ${p.apiKey}`
  }
  return h
}

/* ---------------- OpenAI-compatible Chat Completions ---------------- */

async function openaiChatComplete(params: CompletionParams): Promise<string> {
  const { provider, model, messages, signal, onDelta } = params
  const oaiMessages = messages.map((m) => {
    if (m.role === 'user' && m.images && m.images.length > 0 && model.capabilities.vision) {
      return {
        role: m.role,
        content: [
          ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          { type: 'text', text: m.content }
        ]
      }
    }
    return { role: m.role, content: m.content }
  })
  const body: Record<string, unknown> = {
    model: model.modelId,
    messages: oaiMessages,
    stream: true
  }
  if (params.temperature !== undefined) body.temperature = params.temperature
  const mt = params.maxTokens ?? model.maxOutputTokens ?? provider.maxTokens
  if (mt) body.max_tokens = mt
  if (params.jsonMode && model.capabilities.json) body.response_format = { type: 'json_object' }

  const res = await fetch(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(provider),
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const retryAfter = res.headers.get('retry-after')
    throw new ProviderError(res.status, isRetryableStatus(res.status), describeHttpError(res.status, text), retryAfter ? Number(retryAfter) * 1000 : undefined)
  }
  return consumeSSE(res, (data) => {
    try {
      const j = JSON.parse(data)
      const delta = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text ?? ''
      if (delta) onDelta(delta)
      return delta
    } catch {
      return ''
    }
  })
}

/* ---------------- Gemini native ---------------- */

async function geminiComplete(params: CompletionParams): Promise<string> {
  const { provider, model, messages, signal, onDelta } = params
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.images && model.capabilities.vision
          ? m.images.map((img) => ({ inline_data: { mime_type: img.split(':')[1]?.split(';')[0] || 'image/png', data: img.split(',')[1] } }))
          : []),
        { text: m.content }
      ]
    }))
  const body: Record<string, unknown> = { contents }
  if (system && model.capabilities.systemInstructions) body.system_instruction = { parts: [{ text: system }] }
  const genCfg: Record<string, unknown> = {}
  if (params.temperature !== undefined) genCfg.temperature = params.temperature
  const mt = params.maxTokens ?? model.maxOutputTokens ?? provider.maxTokens
  if (mt) genCfg.max_output_tokens = mt
  if (params.jsonMode && model.capabilities.json) genCfg.responseMimeType = 'application/json'
  if (Object.keys(genCfg).length) body.generationConfig = genCfg

  const url = joinUrl(provider.baseUrl, `/models/${encodeURIComponent(model.modelId)}:streamGenerateContent?alt=sse`)
  const res = await fetch(url, { method: 'POST', headers: authHeaders(provider), body: JSON.stringify(body), signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProviderError(res.status, isRetryableStatus(res.status), describeHttpError(res.status, text))
  }
  return consumeSSE(res, (data) => {
    try {
      const j = JSON.parse(data)
      const delta = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
      if (delta) onDelta(delta)
      return delta
    } catch {
      return ''
    }
  })
}

/* ---------------- Shared SSE consumer (real streaming) ---------------- */

async function consumeSSE(res: Response, onData: (data: string) => string): Promise<string> {
  if (!res.body) throw new ProviderError(null, false, 'Provider returned no response stream.')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      full += onData(data)
    }
  }
  return full
}

/* ---------------- Non-streaming helper (tests / titles) ---------------- */

export async function completeOnce(params: Omit<CompletionParams, 'onDelta' | 'signal'> & { signal?: AbortSignal; timeoutMs?: number }): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), params.timeoutMs ?? 20000)
  if (params.signal) params.signal.addEventListener('abort', () => ctrl.abort())
  let out = ''
  try {
    const p = { ...params, signal: ctrl.signal, onDelta: (t: string) => { out += t } }
    await dispatch(p)
  } finally {
    clearTimeout(timer)
  }
  return out
}

export function dispatch(params: CompletionParams): Promise<string> {
  switch (params.provider.format) {
    case 'gemini':
      return geminiComplete(params)
    case 'openai-compatible':
    case 'custom': // custom adapters reuse OpenAI-compatible wire format unless extended
      return openaiChatComplete(params)
  }
}

/* ---------------- Connection test (real request) ---------------- */

export async function testProviderConnection(provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'format' | 'customHeaders' | 'timeout'>, modelId: string): Promise<{ ok: boolean; message: string }> {
  const testMsg: ChatRequestMessage[] = [{ role: 'user', content: 'ping' }]
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), provider.timeout || 20000)
    try {
      const res = await fetch(joinUrl(provider.baseUrl, provider.format === 'gemini' ? `/models/${encodeURIComponent(modelId)}:generateContent` : '/chat/completions'), {
        method: 'POST',
        headers: (() => {
          const h: Record<string, string> = { 'Content-Type': 'application/json', ...(provider.customHeaders ?? {}) }
          if (provider.apiKey) {
            if (provider.format === 'gemini') h['x-goog-api-key'] = provider.apiKey
            else h['Authorization'] = `Bearer ${provider.apiKey}`
          }
          return h
        })(),
        body: JSON.stringify(
          provider.format === 'gemini'
            ? { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }
            : { model: modelId, messages: testMsg, max_tokens: 1 }
        ),
        signal: ctrl.signal
      })
      if (res.ok) return { ok: true, message: 'Test successful — provider responded.' }
      const text = await res.text().catch(() => '')
      return { ok: false, message: describeHttpError(res.status, text) }
    } finally {
      clearTimeout(t)
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, message: 'Connection test timed out.' }
    return { ok: false, message: 'Network failure — could not reach the provider. Check the Base URL and your connection.' }
  }
}

/* ---------------- Model discovery (GET /models when available) ---------------- */

export async function fetchProviderModels(provider: Provider): Promise<{ id: string; name?: string }[]> {
  if (provider.format === 'gemini') {
    const res = await fetch(joinUrl(provider.baseUrl, '/models?pageSize=200'), { headers: authHeaders(provider) })
    if (!res.ok) throw new ProviderError(res.status, false, describeHttpError(res.status, await res.text().catch(() => '')))
    const j = await res.json()
    return (j.models ?? []).map((m: { name: string }) => ({ id: m.name.replace(/^models\//, ''), name: m.name.replace(/^models\//, '') }))
  }
  const res = await fetch(joinUrl(provider.baseUrl, '/models'), { headers: authHeaders(provider) })
  if (!res.ok) throw new ProviderError(res.status, false, describeHttpError(res.status, await res.text().catch(() => '')))
  const j = await res.json()
  const list = Array.isArray(j) ? j : j.data ?? j.models ?? []
  return list.map((m: { id?: string; name?: string }) => ({ id: m.id ?? m.name ?? '', name: m.name ?? m.id }))
}
