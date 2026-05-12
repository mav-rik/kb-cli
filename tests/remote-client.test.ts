import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteClient, RemoteError } from '../src/services/remote-client.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  }
}

function textResponse(text: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/plain' }),
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  }
}

describe('RemoteClient', () => {
  let client: RemoteClient

  beforeEach(() => {
    client = new RemoteClient()
    mockFetch.mockReset()
  })

  it('health returns parsed JSON', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'ok' }))

    const result = await client.health('http://localhost:3000')

    expect(result).toEqual({ status: 'ok' })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/health',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    )
  })

  it('search builds correct query params', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    await client.search('http://localhost:3000', 'docs', 'hello', 10, 'hybrid')

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/search?')
    expect(url).toContain('q=hello')
    expect(url).toContain('limit=10')
    expect(url).toContain('mode=hybrid')
    expect(url).toContain('wiki=docs')
  })

  it('addDoc sends POST with wiki in body', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'new-doc' }))

    await client.addDoc('http://localhost:3000', 'mywiki', {
      title: 'Test',
      category: 'notes',
      tags: ['a'],
      content: 'body',
    })

    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body).toEqual({ title: 'Test', category: 'notes', tags: ['a'], content: 'body', wiki: 'mywiki' })
  })

  it('sets Authorization header when secret provided', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'ok' }))

    await client.health('http://localhost:3000', 'my-secret')

    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers['Authorization']).toBe('Bearer my-secret')
  })

  it('omits Authorization header when no secret', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'ok' }))

    await client.health('http://localhost:3000')

    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers['Authorization']).toBeUndefined()
  })

  it('throws RemoteError on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404))

    await expect(client.health('http://localhost:3000')).rejects.toThrow(RemoteError)

    try {
      await client.health('http://localhost:3000')
    } catch (e: any) {
      expect(e).toBeInstanceOf(RemoteError)
      expect(e.status).toBe(404)
      expect(e.message).toContain('not found')
      expect(e.url).toBe('http://localhost:3000/api/health')
    }
  })

  it('returns text when content-type is not JSON', async () => {
    mockFetch.mockResolvedValue(textResponse('plain text'))

    const result = await client.health('http://localhost:3000')

    expect(result).toBe('plain text')
  })

  it('strips trailing slash from url', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'ok' }))

    await client.health('http://localhost:3000/')

    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:3000/api/health')
  })

  it('logAdd sends POST /api/log with op, doc, details', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ logged: true }))

    await client.logAdd('http://localhost:3000', 'mywiki', 'ingest', 'my-doc', 'added new info', 'my-secret')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/log')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toBe('Bearer my-secret')
    const body = JSON.parse(opts.body)
    expect(body).toEqual({ wiki: 'mywiki', op: 'ingest', doc: 'my-doc', details: 'added new info' })
  })

  it('logAdd handles optional doc and details', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ logged: true }))

    await client.logAdd('http://localhost:3000', 'mywiki', 'note', undefined, undefined)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({ wiki: 'mywiki', op: 'note', doc: undefined, details: undefined })
  })

  it('log fetches GET /api/log with wiki and limit', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ timestamp: '2025-01-01', operation: 'add', docId: 'x' }]))

    const result = await client.log('http://localhost:3000', 'mywiki', 5, 'my-secret')

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/log?')
    expect(url).toContain('wiki=mywiki')
    expect(url).toContain('limit=5')
    expect(result).toHaveLength(1)
    expect(result[0].operation).toBe('add')
  })
})
