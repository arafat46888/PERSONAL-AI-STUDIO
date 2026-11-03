import { drizzle } from 'drizzle-orm/netlify-db'
import { and, eq } from 'drizzle-orm'
import { workspaceProjects } from '../../db/schema.js'

function publicProject({ owner: _owner, ...project }: typeof workspaceProjects.$inferSelect) {
  return project
}

export default async (req: Request) => {
  const url = new URL(req.url)
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return new Response('Method not allowed', { status: 405 })
  if (req.method !== 'GET' && req.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 })
  const existing = req.headers.get('cookie')?.match(/(?:^|;\s*)workspace_owner=([a-f0-9-]{36})(?:;|$)/)?.[1]
  const owner = existing ?? crypto.randomUUID()
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (!existing) headers.set('Set-Cookie', `workspace_owner=${owner}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000`)
  const db = drizzle()
  const id = url.searchParams.get('id')
  const filter = id ? and(eq(workspaceProjects.owner, owner), eq(workspaceProjects.id, id)) : eq(workspaceProjects.owner, owner)
  try {
    if (req.method === 'GET') {
      const rows = await db.select().from(workspaceProjects).where(filter)
      if (id && !rows[0]) return new Response('Not found', { status: 404, headers })
      return Response.json(id ? publicProject(rows[0]) : rows.map(publicProject), { headers })
    }
    if (req.method === 'DELETE') {
      if (!id) return new Response('Missing id', { status: 400, headers })
      await db.delete(workspaceProjects).where(filter)
      return Response.json({ ok: true }, { headers })
    }
    const body = await req.json()
    if (!Array.isArray(body.files) || body.files.length > 200 || body.files.some((f: unknown) => !f || typeof f !== 'object' || !['id', 'name', 'language', 'content', 'projectId'].every((key) => typeof (f as Record<string, unknown>)[key] === 'string'))) return new Response('Invalid files', { status: 400, headers })
    if (JSON.stringify(body).length > 4_000_000) return new Response('Workspace too large', { status: 413, headers })
    if (req.method === 'POST') {
      if (typeof body.id !== 'string' || typeof body.name !== 'string' || !body.name.trim()) return new Response('Invalid project', { status: 400, headers })
      const [row] = await db.insert(workspaceProjects).values({ id: body.id, owner, name: body.name, files: body.files, createdAt: Date.now(), updatedAt: Date.now() }).returning()
      return Response.json(publicProject(row), { status: 201, headers })
    }
    if (!id) return new Response('Missing id', { status: 400, headers })
    const [row] = await db.update(workspaceProjects).set({ files: body.files, updatedAt: Date.now() }).where(filter).returning()
    return row ? Response.json(publicProject(row), { headers }) : new Response('Not found', { status: 404, headers })
  } catch {
    return new Response('Workspace request failed', { status: 500, headers })
  }
}
