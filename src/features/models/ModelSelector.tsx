import { useEffect, useState } from 'react'
import { db } from '@/database/db'
import type { AIModel } from '@/types'
import { cx, Select } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { Sparkles } from 'lucide-react'

interface Props {
  value?: string
  onChange: (modelId: string) => void
  compact?: boolean
  className?: string
  filterVision?: boolean
}

/** Model selector listing all enabled models grouped by provider. Mobile-friendly via native select. */
export function ModelSelector({ value, onChange, compact, className, filterVision }: Props) {
  const [models, setModels] = useState<AIModel[]>([])
  const [providerNames, setProviderNames] = useState<Record<string, string>>({})
  const streaming = useAppStore((s) => s.streamingChatId)

  useEffect(() => {
    let live = true
    const load = async () => {
      const ms = await db.models.filter((m) => m.enabled).toArray()
      const ps = await db.providers.toArray()
      if (!live) return
      setModels(ms.filter((m) => ps.some((p) => p.enabled && p.id === m.providerId)))
      setProviderNames(Object.fromEntries(ps.map((p) => [p.id, p.name])))
    }
    void load()
    return () => { live = false }
  }, [streaming])

  const filtered = filterVision ? models.filter((m) => m.capabilities.vision || m.capabilities.imageInput) : models
  const byProvider = filtered.reduce<Record<string, AIModel[]>>((acc, m) => {
    ;(acc[m.providerId] ??= []).push(m)
    return acc
  }, {})

  if (filtered.length === 0) {
    return (
      <button onClick={() => { window.location.hash = '#/settings/providers' }} className={cx('inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs text-ink-dim hover:text-ink hover:border-accent', className)}>
        <Sparkles size={13} /> Add a model to start
      </button>
    )
  }

  return (
    <div className={cx('relative inline-flex items-center', className)}>
      <Sparkles size={13} className="pointer-events-none absolute left-2.5 text-[var(--accent)]" />
      <Select
        aria-label="Select model"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={cx('pl-7 pr-6 max-w-[240px]', compact ? 'h-8 text-xs' : 'h-9 text-[13px]', 'bg-transparent border-line appearance-none cursor-pointer')}
      >
        {!value && <option value="" disabled>Select a model…</option>}
        {Object.entries(byProvider).map(([pid, ms]) => (
          <optgroup key={pid} label={providerNames[pid] ?? pid}>
            {ms.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.capabilities.vision ? ' 👁' : ''}{m.capabilities.reasoning ? ' 🧠' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  )
}
