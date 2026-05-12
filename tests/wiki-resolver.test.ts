import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-resolver-'))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => tmpDir }
})

const { ConfigService } = await import('../src/services/config.service.js')

describe('wiki-resolver', () => {
  const kbDir = path.join(tmpDir, '.kb')

  beforeEach(() => {
    fs.mkdirSync(kbDir, { recursive: true })
    fs.writeFileSync(path.join(kbDir, 'config.json'), JSON.stringify({ defaultWiki: 'default' }))
  })

  afterEach(() => {
    fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('resolves explicit local wiki', () => {
    fs.writeFileSync(path.join(kbDir, 'remotes.json'), JSON.stringify({ remotes: {} }))
    const svc = new ConfigService()

    const ref = svc.resolveWiki('mylocal')

    expect(ref).toEqual({ type: 'local', name: 'mylocal' })
  })

  it('resolves remote wiki by name', () => {
    fs.writeFileSync(
      path.join(kbDir, 'remotes.json'),
      JSON.stringify({
        remotes: {
          myserver: {
            url: 'http://remote:3000',
            secret: 'token123',
            attachedWikis: { docs: { alias: null } },
          },
        },
      }),
    )
    const svc = new ConfigService()

    const ref = svc.resolveWiki('docs')

    expect(ref).toEqual({
      type: 'remote',
      name: 'docs',
      localAlias: 'docs',
      remoteKb: 'myserver',
      url: 'http://remote:3000',
      secret: 'token123',
    })
  })

  it('resolves remote wiki by alias', () => {
    fs.writeFileSync(
      path.join(kbDir, 'remotes.json'),
      JSON.stringify({
        remotes: {
          myserver: {
            url: 'http://remote:3000',
            attachedWikis: { 'original-name': { alias: 'notes' } },
          },
        },
      }),
    )
    const svc = new ConfigService()

    const ref = svc.resolveWiki('notes')

    expect(ref).toEqual({
      type: 'remote',
      name: 'original-name',
      localAlias: 'notes',
      remoteKb: 'myserver',
      url: 'http://remote:3000',
      secret: undefined,
    })
  })

  it('uses defaultWiki when no explicit name', () => {
    fs.writeFileSync(path.join(kbDir, 'remotes.json'), JSON.stringify({ remotes: {} }))
    const svc = new ConfigService()

    const ref = svc.resolveWiki()

    expect(ref).toEqual({ type: 'local', name: 'default' })
  })

  it('resolveWikiName returns string', () => {
    fs.writeFileSync(
      path.join(kbDir, 'remotes.json'),
      JSON.stringify({
        remotes: {
          srv: {
            url: 'http://x:3000',
            attachedWikis: { wiki1: { alias: 'w1' } },
          },
        },
      }),
    )
    const svc = new ConfigService()

    expect(svc.resolveWikiName('w1')).toBe('wiki1')
    expect(svc.resolveWikiName('localwiki')).toBe('localwiki')
  })
})
