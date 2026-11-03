import { create } from 'zustand'

/* ---------- Speech-to-Text (Web Speech API when supported) ---------- */

type SR = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: unknown) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type SRCtor = new () => SR

export function speechRecognitionSupported(): boolean {
  return !!(window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).SpeechRecognition
    || !!(window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition
}

interface STTState {
  listening: boolean
  interim: string
  error: string | null
  rec: SR | null
  start: (lang: string, onFinal: (text: string) => void, onInterim?: (t: string) => void) => void
  stop: () => void
  cancel: () => void
}

export const useSTT = create<STTState>((set, get) => ({
  listening: false,
  interim: '',
  error: null,
  rec: null,
  start: (lang, onFinal, onInterim) => {
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) { set({ error: 'Speech recognition is not supported in this browser. Try Chrome/Edge, or record audio and transcribe with a local Whisper engine.' }); return }
    get().cancel()
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    let finalText = ''
    rec.onresult = (eRaw) => {
      const e = eRaw as { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) { finalText += r[0].transcript + ' '; onFinal(r[0].transcript) }
        else interim += r[0].transcript
      }
      set({ interim })
      onInterim?.(interim)
    }
    rec.onerror = (ev) => {
      const map: Record<string, string> = { 'not-allowed': 'Microphone permission denied.', 'no-speech': 'No speech detected.', network: 'Speech recognition network error.', 'service-not-allowed': 'Speech service unavailable in this browser.' }
      set({ error: map[ev.error] ?? `Speech recognition error: ${ev.error}`, listening: false })
    }
    rec.onend = () => set({ listening: false, interim: '' })
    try { rec.start() } catch { /* already started */ }
    set({ rec, listening: true, error: null })
  },
  stop: () => { get().rec?.stop(); set({ listening: false }) },
  cancel: () => { const r = get().rec; if (r) { r.onresult = null; r.onend = null; r.abort?.() }; set({ listening: false, interim: '', rec: null }) }
}))

/* ---------- Audio recording (MediaRecorder) ---------- */

export interface RecorderHandle { stop: () => Promise<Blob>; cancel: () => void }

export async function startRecording(): Promise<{ recorder: MediaRecorder; stream: MediaStream; handle: RecorderHandle }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mr = new MediaRecorder(stream)
  const chunks: Blob[] = []
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise<Blob>((res) => { mr.onstop = () => res(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })) })
  mr.start()
  return {
    recorder: mr,
    stream,
    handle: {
      stop: async () => { mr.stop(); stream.getTracks().forEach((t) => t.stop()); return done },
      cancel: () => { try { mr.stop() } catch { /* noop */ } stream.getTracks().forEach((t) => t.stop()) }
    }
  }
}

/* ---------- Text-to-Speech (SpeechSynthesis) ---------- */

interface TTSState {
  speaking: boolean
  paused: boolean
  utteranceId: string | null
  voices: SpeechSynthesisVoice[]
  refreshVoices: () => void
  speak: (text: string, opts: { voiceURI?: string; rate?: number; lang?: string; onStart?: () => void; onEnd?: () => void }) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function ttsSupported(): boolean {
  return 'speechSynthesis' in window
}

export const useTTS = create<TTSState>((set, get) => ({
  speaking: false,
  paused: false,
  utteranceId: null,
  voices: [],
  refreshVoices: () => {
    if (!ttsSupported()) return
    set({ voices: window.speechSynthesis.getVoices() })
  },
  speak: (text, opts) => {
    if (!ttsSupported()) { set({ speaking: false }); return }
    window.speechSynthesis.cancel() // stop any other response being played
    const u = new SpeechSynthesisUtterance(text)
    const v = get().voices.find((x) => x.voiceURI === opts.voiceURI)
    if (v) u.voice = v
    u.rate = opts.rate ?? 1
    u.lang = opts.lang ?? v?.lang ?? 'en-US'
    const id = Math.random().toString(36).slice(2)
    u.onstart = () => { set({ speaking: true, paused: false, utteranceId: id }); opts.onStart?.() }
    u.onend = () => { set({ speaking: false, paused: false, utteranceId: null }); opts.onEnd?.() }
    u.onerror = () => { set({ speaking: false, paused: false, utteranceId: null }); opts.onEnd?.() }
    window.speechSynthesis.speak(u)
  },
  pause: () => { if (ttsSupported()) { window.speechSynthesis.pause(); set({ paused: true }) } },
  resume: () => { if (ttsSupported()) { window.speechSynthesis.resume(); set({ paused: false }) } },
  stop: () => { if (ttsSupported()) window.speechSynthesis.cancel(); set({ speaking: false, paused: false, utteranceId: null }) }
}))

if (ttsSupported()) {
  window.speechSynthesis.onvoiceschanged = () => useTTS.getState().refreshVoices()
  useTTS.getState().refreshVoices()
}
