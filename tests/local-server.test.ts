import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-local-server-'))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => tmpDir }
})

// Import after the homedir mock is registered so the data dir resolves under tmpDir.
const { ConfigService } = await import('../src/services/config.service.js')
const { LocalServerService } = await import('../src/services/local-server.service.js')

const kbDir = path.join(tmpDir, '.kb')
const servePath = path.join(kbDir, '.serve.json')

function freshKbDir() {
  if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  fs.mkdirSync(kbDir, { recursive: true })
}

function writeServeFile(content: string | object) {
  const body = typeof content === 'string' ? content : JSON.stringify(content)
  fs.writeFileSync(servePath, body, 'utf-8')
}

// A PID that is overwhelmingly unlikely to exist on any system.
// `process.kill(2 ** 22, 0)` reliably throws ESRCH on linux + macOS.
const DEAD_PID = 4_194_303

function makeService() {
  const config = new ConfigService()
  return new LocalServerService(config)
}

describe('LocalServerService.refresh', () => {
  beforeEach(() => {
    freshKbDir()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('returns null when the tempfile does not exist', async () => {
    const svc = makeService()
    const info = await svc.refresh()
    expect(info).toBeNull()
    expect(svc.getCached()).toBeNull()
  })

  it('deletes the file and returns null when JSON is bogus', async () => {
    writeServeFile('not-json {')
    const svc = makeService()
    const info = await svc.refresh()
    expect(info).toBeNull()
    expect(fs.existsSync(servePath)).toBe(false)
    expect(svc.getCached()).toBeNull()
  })

  it('deletes the file and returns null when the recorded PID is dead', async () => {
    writeServeFile({
      port: 4141,
      pid: DEAD_PID,
      secret: null,
      startedAt: new Date().toISOString(),
      embeddingModel: 'Xenova/bge-base-en-v1.5',
    })
    const svc = makeService()
    const info = await svc.refresh()
    expect(info).toBeNull()
    expect(fs.existsSync(servePath)).toBe(false)
  })

  it('returns null but KEEPS the file when fetch times out (live PID)', async () => {
    writeServeFile({
      port: 4141,
      pid: process.pid, // self is guaranteed alive
      secret: null,
      startedAt: new Date().toISOString(),
      embeddingModel: 'Xenova/bge-base-en-v1.5',
    })

    // Simulate a fetch that hangs forever — AbortController will reject it.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          // Reject when the abort signal fires.
          const signal = init?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('aborted')
              ;(err as any).name = 'AbortError'
              reject(err)
            })
          }
        })
      }),
    )

    const svc = makeService()
    const info = await svc.refresh()
    expect(info).toBeNull()
    // File must NOT be deleted — the server may just be busy.
    expect(fs.existsSync(servePath)).toBe(true)
  })

  it('returns the parsed info when PID is live and ping returns 2xx', async () => {
    const expected = {
      port: 4141,
      pid: process.pid,
      secret: 'topsecret',
      startedAt: new Date().toISOString(),
      embeddingModel: 'Xenova/bge-base-en-v1.5',
    }
    writeServeFile(expected)

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const svc = makeService()
    const info = await svc.refresh()
    expect(info).toEqual(expected)
    expect(svc.getCached()).toEqual(expected)
    expect(fs.existsSync(servePath)).toBe(true)

    // Confirms we forward the bearer token.
    const callArgs = fetchMock.mock.calls[0]
    expect(callArgs[0]).toBe('http://localhost:4141/api')
    const headers = (callArgs[1] as RequestInit | undefined)?.headers as Record<string, string>
    expect(headers?.Authorization).toBe('Bearer topsecret')
  })
})

describe('LocalServerService.write / clear', () => {
  beforeEach(() => {
    freshKbDir()
  })

  afterEach(() => {
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('write() persists info with 0600 mode and clear() removes it', () => {
    const svc = makeService()
    const info = {
      port: 4141,
      pid: process.pid,
      secret: null,
      startedAt: new Date().toISOString(),
      embeddingModel: 'Xenova/bge-base-en-v1.5',
    }
    svc.write(info)
    expect(fs.existsSync(servePath)).toBe(true)
    const stat = fs.statSync(servePath)
    // Mode includes the file type bits — mask to permission bits.
    expect(stat.mode & 0o777).toBe(0o600)

    svc.clear()
    expect(fs.existsSync(servePath)).toBe(false)
  })

  it('clear() is a no-op when the file is already gone', () => {
    const svc = makeService()
    expect(() => svc.clear()).not.toThrow()
  })
})
