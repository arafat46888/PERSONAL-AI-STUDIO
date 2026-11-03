import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell, SettingsLayout, GeneralSettings, RouterSettings, AppearanceSettings, ChatSettings, VoiceSettings, MemorySettings, DataSettings, PrivacySettings, ShortcutSettings, AdvancedSettings, AboutSettings } from '@/features/settings/pages'
import { ChatScreen } from '@/features/chat/ChatScreen'
import { ProvidersSettings, ModelsSettings } from '@/features/providers/ProvidersSettings'
import { MemoryPage, ProjectsPage, PromptsPage, AssistantsPage } from '@/features/projects/pages'
import { SearchPage, ArchivedPage, ComparePage } from '@/features/search/pages'
import { useAppStore } from '@/stores/app'
import { Spinner } from '@/components/ui'

// Code-split heavy features
const CodeWorkspacePage = lazy(() => import('@/features/coding/CodeWorkspace').then((m) => ({ default: m.CodeWorkspacePage })))

function Loading() { return <div className="grid h-full place-items-center"><Spinner size={26} /></div> }

export function AppRoutes() {
  const loaded = useAppStore((s) => s.settingsLoaded)
  const startup = useAppStore((s) => s.settings.general.startupPage)
  const loc = useLocation()

  // Apply appearance every render cycle of settings
  useEffect(() => { /* handled by store subscription in App */ }, [])

  if (!loaded) return <Loading />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={startup === 'chat' || loc.pathname === '/' ? <ChatScreen /> : <Navigate to={`/${startup}`} replace />} />
        <Route path="/chat/:chatId" element={<ChatScreen />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/assistants" element={<AssistantsPage />} />
        <Route path="/prompts" element={<PromptsPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/archived" element={<ArchivedPage />} />
        <Route path="/workspace" element={<Suspense fallback={<Loading />}><CodeWorkspacePage /></Suspense>} />
        <Route path="/settings" element={<Navigate to="/settings/general" replace />}>
          <Route path="general" element={<GeneralSettings />} />
          <Route path="providers" element={<ProvidersSettings />} />
          <Route path="models" element={<ModelsSettings />} />
          <Route path="router" element={<RouterSettings />} />
          <Route path="appearance" element={<AppearanceSettings />} />
          <Route path="chat" element={<ChatSettings />} />
          <Route path="voice" element={<VoiceSettings />} />
          <Route path="memory" element={<MemorySettings />} />
          <Route path="data" element={<DataSettings />} />
          <Route path="privacy" element={<PrivacySettings />} />
          <Route path="shortcuts" element={<ShortcutSettings />} />
          <Route path="advanced" element={<AdvancedSettings />} />
          <Route path="about" element={<AboutSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
