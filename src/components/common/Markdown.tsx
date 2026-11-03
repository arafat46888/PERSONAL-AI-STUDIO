import { memo, useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import { Copy, Check, Download } from 'lucide-react'
import { downloadText } from '@/services/storage/files'
import { useAppStore } from '@/stores/app'

// Register a focused set of common languages to keep the bundle lean.
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'

hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('jsx', typescript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('java', java)
hljs.registerLanguage('c', cpp)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)

marked.setOptions({ breaks: true, gfm: true })

const PurifyConfig = {
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i
}

export function renderMarkdown(src: string, highlight = true): string {
  let html: string
  try {
    html = marked.parse(src ?? '', { async: false }) as string
  } catch {
    html = `<p>${escapeHtml(src ?? '')}</p>`
  }
  // Sanitize rendered HTML (security requirement).
  html = DOMPurify.sanitize(html, PurifyConfig) as unknown as string
  if (highlight) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('pre code').forEach((el) => {
      const cls = [...el.classList].find((c) => c.startsWith('language-'))
      const lang = cls?.slice(9)
      try {
        if (lang && hljs.getLanguage(lang)) el.innerHTML = hljs.highlight(el.textContent ?? '', { language: lang }).value
        else el.innerHTML = hljs.highlightAuto(el.textContent ?? '').value
        el.classList.add('hljs')
      } catch { /* keep plain */ }
    })
    // Restrict external links
    doc.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer nofollow')
    })
    html = doc.body.innerHTML
  }
  return html
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Attach copy/download buttons to code blocks after render. */
function decorateCodeBlocks(root: HTMLElement | null, mdEnabled: boolean) {
  if (!root || !mdEnabled) return
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.codeblock-actions')) return
    const wrap = document.createElement('div')
    wrap.className = 'codeblock-actions'
    const langLabel = document.createElement('span')
    langLabel.className = 'text-[10px] uppercase tracking-wide text-ink-faint self-center mr-1'
    const codeEl = pre.querySelector('code')
    const langCls = codeEl ? [...codeEl.classList].find((c) => c.startsWith('language-')) : undefined
    langLabel.textContent = langCls?.slice(9) ?? ''
    const copyBtn = document.createElement('button')
    copyBtn.className = 'rounded-md bg-surface-raised border border-line px-2 py-1 text-[11px] text-ink-dim hover:text-ink flex items-center gap-1'
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy'
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(codeEl?.textContent ?? '')
      copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>Copied'
      setTimeout(() => { copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy' }, 1500)
    })
    const dlBtn = document.createElement('button')
    dlBtn.className = 'rounded-md bg-surface-raised border border-line px-2 py-1 text-[11px] text-ink-dim hover:text-ink'
    dlBtn.textContent = 'Download'
    dlBtn.addEventListener('click', () => downloadText(codeEl?.textContent ?? '', `snippet.${langCls?.slice(9) ?? 'txt'}`))
    wrap.append(langLabel, copyBtn, dlBtn)
    pre.appendChild(wrap)
  })
}

interface Props { content: string; streaming?: boolean; className?: string }

export const Markdown = memo(function Markdown({ content, streaming, className }: Props) {
  const settings = useAppStore((s) => s.settings)
  const ref = useRef<HTMLDivElement>(null)
  const mdEnabled = settings.chat.markdown
  const html = useMemo(() => {
    if (!mdEnabled) return null
    return renderMarkdown(content, settings.chat.codeHighlight)
  }, [content, mdEnabled, settings.chat.codeHighlight])

  useEffect(() => {
    if (mdEnabled) decorateCodeBlocks(ref.current, mdEnabled)
  }, [html, mdEnabled])

  if (!mdEnabled || html === null) {
    return <div ref={ref} className={className}><pre className="whitespace-pre-wrap font-[inherit] text-inherit m-0">{content}</pre></div>
  }
  return <div ref={ref} className={`md ${streaming ? 'typing-cursor' : ''} ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />
})

export { Copy, Check, Download }
