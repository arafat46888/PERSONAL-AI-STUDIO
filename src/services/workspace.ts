import type { CodeFile, WorkspaceProject } from '@/types'

async function request<T>(method: string, id?: string, body?: unknown): Promise<T> {
  const response = await fetch(`/.netlify/functions/workspace${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!response.ok) throw new Error('Workspace request failed. Please try again.')
  return response.json()
}
export const workspace = {
  list: () => request<WorkspaceProject[]>('GET'),
  files: async (id: string) => (await request<WorkspaceProject>('GET', id)).files,
  create: (project: WorkspaceProject) => request<WorkspaceProject>('POST', undefined, project),
  save: (id: string, files: CodeFile[]) => request<WorkspaceProject>('PUT', id, { files }),
  remove: (id: string) => request<{ ok: boolean }>('DELETE', id)
}
