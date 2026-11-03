import { useAppStore } from '@/stores/app'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap'
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm', lg: 'h-11 px-5 text-[15px]', icon: 'h-9 w-9 shrink-0' }
  const variants = {
    primary: 'bg-accent text-white hover:bg-[var(--accent-hover)] shadow-sm',
    secondary: 'bg-surface-raised border border-line text-ink hover:bg-surface-overlay',
    ghost: 'text-ink-dim hover:text-ink hover:bg-surface-overlay',
    danger: 'bg-[var(--danger)] text-white hover:opacity-90',
    outline: 'border border-accent text-accent hover:bg-surface-overlay'
  }
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('h-10 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent outline-none transition-colors', className)} {...rest} />
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent outline-none resize-y transition-colors', className)} {...rest} />
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('h-10 rounded-lg border border-line bg-surface-raised px-2.5 text-sm text-ink focus:border-accent outline-none', className)} {...rest}>
      {children}
    </select>
  )
}

export function Field({ label, hint, required, children, htmlFor }: { label: string; hint?: string; required?: boolean; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="block space-y-1.5" htmlFor={htmlFor}>
      <span className="text-[13px] font-medium text-ink">
        {label} {required && <span className="text-[var(--danger)]">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-border')}>
      <span className={cx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx('fade-up flex max-h-[92vh] w-full flex-col rounded-t-2xl sm:rounded-2xl border border-line bg-surface-raised shadow-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5 shrink-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog"><X size={17} /></Button>
        </div>
        <div className="overflow-y-auto px-5 py-4 grow">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3.5 flex justify-end gap-2 shrink-0 safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; danger?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>Confirm</Button>
      </>
    }>
      <p className="text-sm text-ink-dim">{message}</p>
    </Modal>
  )
}

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'ok' | 'error' | 'warn' | 'accent' }) {
  const tones = { default: 'bg-surface-overlay text-ink-dim', ok: 'bg-emerald-500/15 text-emerald-400', error: 'bg-red-500/15 text-red-400', warn: 'bg-amber-500/15 text-amber-400', accent: 'bg-indigo-500/15 text-[var(--accent)]' }
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>
}

export function EmptyState({ icon, title, message, action }: { icon?: React.ReactNode; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center px-6">
      <div className="text-ink-faint">{icon ?? <div className="h-12 w-12 rounded-2xl bg-surface-overlay border border-line" />}</div>
      <div>
        <h3 className="font-semibold text-[15px]">{title}</h3>
        {message && <p className="mt-1 text-sm text-ink-dim max-w-sm">{message}</p>}
      </div>
      {action}
    </div>
  )
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-ink-dim" />
}

/** Dropdown menu that closes on outside click / Escape. */
export function Menu({ trigger, items, align = 'right' }: { trigger: React.ReactNode; items: { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <div onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}>{trigger}</div>
      {open && (
        <div className={cx('absolute z-40 mt-1 min-w-[190px] rounded-xl border border-line bg-surface-raised p-1 shadow-xl fade-up', align === 'right' ? 'right-0' : 'left-0')} role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-40', it.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-ink hover:bg-surface-overlay')}
              onClick={() => { setOpen(false); it.onClick() }}>
              {it.icon}<span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-overlay p-1 border border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors', value === t.id ? 'bg-surface-raised text-ink shadow-sm border border-line' : 'text-ink-dim hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Toaster() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  return <div aria-live="polite" className="fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
    {toasts.map((toast) => <div key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'} className="rounded-xl border border-line bg-surface-raised p-4 shadow-lg">
      <div className="flex items-center gap-3"><strong>{toast.title}</strong><button aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={16} /></button></div>
      {toast.detail && <p className="mt-1 text-sm text-ink-dim">{toast.detail}</p>}
    </div>)}
  </div>
}
