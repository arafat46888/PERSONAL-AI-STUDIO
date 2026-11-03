import { nanoid } from 'nanoid'
// JSZip imported lazily where needed

import type { Attachment } from '@/types'

/* ---------- File text extraction (lazy-loaded heavy libs) ---------- */

const TEXT_EXT = ['txt', 'md', 'json', 'csv', 'log', 'yml', 'yaml', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sh', 'sql']

export function fileKind(file: File): Attachment['kind'] {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'document'
  if (file.type.startsWith('text/') || TEXT_EXT.includes(ext)) return 'text'
  if (file.type === 'application/json') return 'text'
  return 'other'
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('Failed to read file.'))
    r.readAsDataURL(file)
  })
}

export async function extractFileText(file: File, onProgress?: (p: number) => void): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const kind = fileKind(file)
  if (kind === 'image' || kind === 'audio') return ''
  if (kind === 'text' || ['json', 'csv', 'xml', 'html'].includes(ext)) {
    onProgress?.(50)
    const text = await file.text()
    onProgress?.(100)
    return text.slice(0, 200000)
  }
  if (ext === 'pdf') {
    onProgress?.(10)
    try {
      const pdfjsLib = await import('pdfjs-dist')
      const mod = (pdfjsLib as any).default ?? pdfjsLib
      if (mod.GlobalWorkerOptions) {
        const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url') as unknown as { default: string }).default
        mod.GlobalWorkerOptions.workerSrc = workerSrc
      }
      const data = await file.arrayBuffer()
      const doc = await mod.getDocument({ data }).promise
      let out = ''
      for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
        const page = await doc.getPage(i)
        const tc = await page.getTextContent()
        out += tc.items.map((it: { str: string }) => it.str).join(' ') + '\n\n'
        onProgress?.(Math.round((i / Math.min(doc.numPages, 50)) * 100))
      }
      return out.slice(0, 200000)
    } catch {
      throw new Error('PDF parsing is unavailable in this build. Convert the PDF to text and attach the .txt file.')
    }
  }
  if (ext === 'docx') {
    onProgress?.(30)
    try {
      const mammoth = await import('mammoth/mammoth.browser.js')
      const arr = await file.arrayBuffer()
      const res = await mammoth.extractRawText({ arrayBuffer: arr })
      onProgress?.(100)
      return String(res.value ?? '').slice(0, 200000)
    } catch {
      throw new Error('Could not read this DOCX file. Try another file or paste the text directly.')
    }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    onProgress?.(30)
    try {
      const XLSX = await import('xlsx')
      const arr = await file.arrayBuffer()
      const wb = XLSX.read(arr)
      let out = ''
      for (const name of wb.SheetNames.slice(0, 10)) {
        out += `## Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name]) + '\n\n'
      }
      onProgress?.(100)
      return out.slice(0, 200000)
    } catch {
      throw new Error('Could not read this spreadsheet. Try another file or export it as CSV.')
    }
  }
  return ''
}

export async function buildAttachment(file: File, onProgress?: (p: number) => void): Promise<Attachment> {
  const kind = fileKind(file)
  const att: Attachment = { id: nanoid(), name: file.name, mime: file.type || 'application/octet-stream', size: file.size, kind }
  if (kind === 'image') {
    if (file.size > 8 * 1024 * 1024) throw new Error(`Image "${file.name}" exceeds the 8 MB limit.`)
    att.dataUrl = await readFileAsDataUrl(file)
    onProgress?.(100)
  } else if (kind !== 'audio' && kind !== 'other') {
    if (file.size > 10 * 1024 * 1024) throw new Error(`File "${file.name}" exceeds the 10 MB limit.`)
    try {
      att.text = await extractFileText(file, onProgress)
    } catch (e) {
      att.text = ''
      throw e
    }
  } else {
    onProgress?.(100)
  }
  return att
}

/* ---------- Download helpers ---------- */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function downloadText(text: string, filename: string, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}
