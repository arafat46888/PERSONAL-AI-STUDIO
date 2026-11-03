import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ where: vi.fn(), insert: vi.fn() }))
vi.mock('drizzle-orm/netlify-db', () => ({
  drizzle: () => ({
    select: () => ({ from: () => ({ where: mocks.where }) }),
    insert: mocks.insert
  })
}))
import handler from '../netlify/functions/workspace.mts'

describe('workspace endpoint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects mutations from another origin', async () => {
    const response = await handler(new Request('https://studio.example/.netlify/functions/workspace', {
      method: 'POST', headers: { origin: 'https://unrelated.example' }
    }))
    expect(response.status).toBe(403)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('returns project data without its ownership field', async () => {
    mocks.where.mockResolvedValue([{ id: 'project', owner: 'test-owner', name: 'Example', files: [], createdAt: 1, updatedAt: 1 }])
    const response = await handler(new Request('https://studio.example/.netlify/functions/workspace'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual([{ id: 'project', name: 'Example', files: [], createdAt: 1, updatedAt: 1 }])
  })

  it('rejects invalid file payloads before writing', async () => {
    const response = await handler(new Request('https://studio.example/.netlify/functions/workspace', {
      method: 'POST', headers: { origin: 'https://studio.example', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'project', name: 'Example', files: [{ content: 123 }] })
    }))
    expect(response.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
