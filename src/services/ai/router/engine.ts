import { db } from '@/database/db'
import type { AIModel, Provider, RouterSettings, UsageLog } from '@/types'
import type { ChatRequestMessage, CompletionParams } from './adapters'
import { dispatch, ProviderError } from './adapters'
import { nanoid } from 'nanoid'

export interface RouteResult {
  text: string
  model: AIModel
  provider: Provider
  stopped?: boolean
  error?: string
  attempts: { modelName: string; error: string }[]
  latencyMs: number
}

interface Cooldown { until: number }
const cooldowns = new Map<string, Cooldown>()
const stats = { total: 0, failures: 0, recentLatencies: [] as number[], lastSuccessModel: '' as string, recentFailures: [] as { model: string; error: string; at: number }[] }

export function getRouterStats() {
  const avg = stats.recentLatencies.length ? Math.round(stats.recentLatencies.reduce((a, b) => a + b, 0) / stats.recentLatencies.length) : 0
  return { ...stats, averageLatencyMs: avg }
}

/** Classify task heuristically for smart routing. */
export function classifyTask(text: string, hasImages: boolean): 'vision' | 'coding' | 'reasoning' | 'long-context' | 'json' | 'general' {
  if (hasImages) return 'vision'
  const t = text.toLowerCase()
  if (/```|def |function |class |import |error|bug|stack trace|compil|typescript|python|javascript|code/.test(t)) return 'coding'
  if (/\b(json)\b.*\b(schema|output|format)\b|\brespond with json\b/.test(t)) return 'json'
  if (/prove|derive|step-by-step|step by step|complex|analyz(e|s).*thorough|reason|math|theorem/.test(t)) return 'reasoning'
  if (t.length > 4000) return 'long-context'
  return 'general'
}

function capabilityRequirement(task: ReturnType<typeof classifyTask>): (m: AIModel) => boolean {
  switch (task) {
    case 'vision': return (m) => m.capabilities.vision || m.capabilities.imageInput
    case 'coding': return (m) => /code|cod|dev|program/i.test(m.name + m.modelId) || m.capabilities.streaming
    case 'reasoning': return (m) => m.capabilities.reasoning
    case 'long-context': return (m) => (m.contextWindow ?? 0) >= 64000
    case 'json': return (m) => m.capabilities.json
    default: return () => true
  }
}

async function loadPair(modelId: string): Promise<{ model: AIModel; provider: Provider } | null> {
  const model = await db.models.get(modelId)
  if (!model) return null
  const provider = await db.providers.get(model.providerId)
  if (!provider) return null
  return { model, provider }
}

function inCooldown(id: string): boolean {
  const c = cooldowns.get(id)
  return !!c && c.until > Date.now()
}

function setCooldown(id: string, ms: number) {
  cooldowns.set(id, { until: Date.now() + ms })
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true })
  })

/**
 * Build the ordered candidate list according to routing mode.
 * Never endlessly retries: bounded by maxRetries and candidate count.
 */
export async function buildCandidates(router: RouterSettings, chatModelId: string | undefined, task: ReturnType<typeof classifyTask>): Promise<string[]> {
  const enabled = await db.models.filter((m) => m.enabled).toArray()
  const providers = new Map((await db.providers.filter((p) => p.enabled).toArray()).map((p) => [p.id, p]))
  const usable = enabled.filter((m) => providers.has(m.providerId))
  const reqOk = capabilityRequirement(task)

  let ordered: string[] = []
  const push = (id?: string) => { if (id && !ordered.includes(id) && usable.some((m) => m.id === id)) ordered.push(id) }

  if (router.mode === 'manual') {
    push(chatModelId)
    push(router.primaryModelId)
  } else if (router.mode === 'smart') {
    // prefer capability-matching models by priority, then everything else
    const matched = usable.filter(reqOk).sort((a, b) => a.priority - b.priority)
    matched.forEach((m) => push(m.id))
    push(chatModelId)
  } else {
    push(router.primaryModelId)
    push(chatModelId)
    push(router.secondaryModelId)
  }
  router.fallbackModelIds.forEach(push)
  usable.sort((a, b) => a.priority - b.priority).forEach((m) => push(m.id))
  return ordered.slice(0, Math.max(1, router.maxRetries + 1))
}

export interface StreamRequest {
  router: RouterSettings
  chatModelId?: string
  messages: ChatRequestMessage[]
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  onDelta: (t: string) => void
  chatId?: string
}

export async function routeAndStream(req: StreamRequest): Promise<RouteResult> {
  const started = Date.now()
  const hasImages = req.messages.some((m) => m.images?.length)
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const task = classifyTask(lastUser, hasImages)
  const candidates = await buildCandidates(req.router, req.chatModelId, task)
  const attempts: { modelName: string; error: string }[] = []

  if (candidates.length === 0) {
    return { text: '', model: undefined as unknown as AIModel, provider: undefined as unknown as Provider, attempts: [{ modelName: '-', error: 'No enabled models found. Configure a provider first.' }], latencyMs: 0, error: 'No configured models available. Add a provider and model in Settings → Providers.' }
  }

  let gotPartial = false
  for (const modelId of candidates) {
    if (req.signal.aborted) break
    const pair = await loadPair(modelId)
    if (!pair) continue
    const { model, provider } = pair
    if (!provider.enabled) { attempts.push({ modelName: model.name, error: 'Provider disabled' }); continue }
    if (inCooldown(model.id)) { attempts.push({ modelName: model.name, error: 'In failure cooldown — skipped' }); continue }
    if (hasImages && !(model.capabilities.vision || model.capabilities.imageInput)) {
      attempts.push({ modelName: model.name, error: 'Model does not support image input' })
      continue
    }
    // Guard: never resend once partial output was received for this request.
    if (gotPartial) break

    let text = ''
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    req.signal.addEventListener('abort', onAbort)
    const timer = setTimeout(() => ctrl.abort(), req.router.timeoutMs || provider.timeout || 60000)
    try {
      const params: CompletionParams = { provider, model, messages: req.messages, temperature: req.temperature, maxTokens: req.maxTokens, signal: ctrl.signal, onDelta: (d) => { text += d; gotPartial = true; req.onDelta(d) } }
      const full = await dispatch(params)
      clearTimeout(timer)
      req.signal.removeEventListener('abort', onAbort)
      const finalText = text || full
      stats.total++
      stats.lastSuccessModel = model.name
      stats.recentLatencies.push(Date.now() - started)
      if (stats.recentLatencies.length > 20) stats.recentLatencies.shift()
      cooldowns.delete(model.id)
      void logUsage({ id: nanoid(), chatId: req.chatId, providerId: provider.id, modelId: model.modelId, promptChars: JSON.stringify(req.messages).length, completionChars: finalText.length, latencyMs: Date.now() - started, success: true, createdAt: Date.now() })
      return { text: finalText, model, provider, attempts, latencyMs: Date.now() - started, stopped: req.signal.aborted }
    } catch (e) {
      clearTimeout(timer)
      req.signal.removeEventListener('abort', onAbort)
      const err = e as ProviderError
      const aborted = req.signal.aborted
      const msg = err instanceof ProviderError ? err.message : err instanceof DOMException && err.name === 'AbortError' ? (aborted ? 'Cancelled by user.' : `Timed out after ${req.router.timeoutMs}ms.`) : String(err?.message ?? 'Network failure')
      attempts.push({ modelName: model.name, error: msg })
      stats.total++
      stats.failures++
      stats.recentFailures.push({ model: model.name, error: msg, at: Date.now() })
      if (stats.recentFailures.length > 10) stats.recentFailures.shift()
      void logUsage({ id: nanoid(), chatId: req.chatId, providerId: provider.id, modelId: model.modelId, promptChars: 0, completionChars: text.length, latencyMs: Date.now() - started, success: false, error: msg, createdAt: Date.now() })

      if (aborted) {
        // User stop: persist whatever partial text we have.
        return { text, model, provider, attempts, latencyMs: Date.now() - started, stopped: true }
      }
      if (err instanceof ProviderError) {
        if (err.status === 401 || err.status === 403) {
          await db.providers.update(provider.id, { connectionStatus: 'needs-attention', updatedAt: Date.now() })
          // Non-retryable auth failure: skip to next candidate provider's models.
          setCooldown(model.id, req.router.failureCooldownMs || 60000)
          continue
        }
        if (err.retryable) {
          setCooldown(model.id, req.router.failureCooldownMs || 60000)
          if (err.retryAfterMs) await sleep(Math.min(err.retryAfterMs, 30000), req.signal)
          else await sleep(req.router.retryDelayMs || 1000, req.signal)
          continue
        }
      }
      // Unsupported model / bad request / invalid format: try fallback anyway.
      setCooldown(model.id, (req.router.failureCooldownMs || 60000) / 2)
      if (gotPartial) {
        return { text, model, provider, attempts, latencyMs: Date.now() - started, error: msg }
      }
    }
  }
  const lastErr = attempts[attempts.length - 1]?.error ?? 'All configured models failed.'
  return { text: gotPartial ? '' : '', model: undefined as unknown as AIModel, provider: undefined as unknown as Provider, attempts, latencyMs: Date.now() - started, error: lastErr }
}

async function logUsage(log: UsageLog) {
  try { await db.usageLogs.add(log) } catch { /* non-critical */ }
}
