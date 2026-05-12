import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { RemoteConfigService } from '../src/services/remote-config.service.js'

describe('RemoteConfigService', () => {
  let tmpDir: string
  let service: RemoteConfigService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-config-test-'))
    service = new RemoteConfigService(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('load returns empty config when file does not exist', () => {
    const config = service.load()
    expect(config).toEqual({ remotes: {} })
  })

  it('addRemote adds a remote', () => {
    service.addRemote('origin', 'http://localhost:3000')
    const remote = service.getRemote('origin')
    expect(remote).not.toBeNull()
    expect(remote!.url).toBe('http://localhost:3000')
    expect(remote!.attachedWikis).toEqual({})
  })

  it('addRemote stores PAT', () => {
    service.addRemote('origin', 'http://localhost:3000', 'secret-token')
    const remote = service.getRemote('origin')
    expect(remote!.pat).toBe('secret-token')
  })

  it('removeRemote removes a remote', () => {
    service.addRemote('origin', 'http://localhost:3000')
    service.removeRemote('origin')
    expect(service.getRemote('origin')).toBeNull()
  })

  it('listRemotes lists all remotes with wiki counts', () => {
    service.addRemote('r1', 'http://r1.test')
    service.addRemote('r2', 'http://r2.test')
    service.attachWiki('r1', 'wiki-a')
    service.attachWiki('r1', 'wiki-b')
    const list = service.listRemotes()
    expect(list).toHaveLength(2)
    const r1 = list.find((r) => r.name === 'r1')!
    expect(r1.wikiCount).toBe(2)
    expect(r1.url).toBe('http://r1.test')
    const r2 = list.find((r) => r.name === 'r2')!
    expect(r2.wikiCount).toBe(0)
  })

  it('attachWiki attaches a wiki to a remote', () => {
    service.addRemote('origin', 'http://localhost:3000')
    const result = service.attachWiki('origin', 'my-wiki')
    expect(result.error).toBeUndefined()
    const remote = service.getRemote('origin')!
    expect(remote.attachedWikis['my-wiki']).toEqual({ alias: null })
  })

  it('attachWiki respects alias', () => {
    service.addRemote('origin', 'http://localhost:3000')
    const result = service.attachWiki('origin', 'my-wiki', 'local-name')
    expect(result.error).toBeUndefined()
    const remote = service.getRemote('origin')!
    expect(remote.attachedWikis['my-wiki']).toEqual({ alias: 'local-name' })
  })

  it('attachWiki returns error on name conflict', () => {
    service.addRemote('r1', 'http://r1.test')
    service.addRemote('r2', 'http://r2.test')
    service.attachWiki('r1', 'shared-name')
    const result = service.attachWiki('r2', 'shared-name')
    expect(result.error).toContain('already used')
  })

  it('attachWiki returns error for nonexistent remote', () => {
    const result = service.attachWiki('nope', 'wiki')
    expect(result.error).toContain('not found')
  })

  it('detachWiki detaches a wiki by its local name', () => {
    service.addRemote('origin', 'http://localhost:3000')
    service.attachWiki('origin', 'my-wiki')
    const result = service.detachWiki('my-wiki')
    expect(result.error).toBeUndefined()
    const remote = service.getRemote('origin')!
    expect(remote.attachedWikis['my-wiki']).toBeUndefined()
  })

  it('detachWiki detaches using the alias', () => {
    service.addRemote('origin', 'http://localhost:3000')
    service.attachWiki('origin', 'my-wiki', 'aliased')
    const result = service.detachWiki('aliased')
    expect(result.error).toBeUndefined()
    const remote = service.getRemote('origin')!
    expect(remote.attachedWikis['my-wiki']).toBeUndefined()
  })

  it('detachWiki returns error when not found', () => {
    const result = service.detachWiki('nonexistent')
    expect(result.error).toContain('No attached wiki found')
  })

  it('resolveRemoteWiki resolves by wiki name', () => {
    service.addRemote('origin', 'http://localhost:3000', 'tok')
    service.attachWiki('origin', 'my-wiki')
    const resolved = service.resolveRemoteWiki('my-wiki')
    expect(resolved).toEqual({
      remoteName: 'origin',
      wikiName: 'my-wiki',
      url: 'http://localhost:3000',
      pat: 'tok',
    })
  })

  it('resolveRemoteWiki resolves by alias', () => {
    service.addRemote('origin', 'http://localhost:3000')
    service.attachWiki('origin', 'my-wiki', 'aliased')
    const resolved = service.resolveRemoteWiki('aliased')
    expect(resolved).not.toBeNull()
    expect(resolved!.wikiName).toBe('my-wiki')
    expect(resolved!.remoteName).toBe('origin')
  })

  it('resolveRemoteWiki returns null for unknown name', () => {
    expect(service.resolveRemoteWiki('unknown')).toBeNull()
  })

  it('getAllAttachedNames returns all effective local names', () => {
    service.addRemote('r1', 'http://r1.test')
    service.addRemote('r2', 'http://r2.test')
    service.attachWiki('r1', 'wiki-a')
    service.attachWiki('r1', 'wiki-b', 'b-alias')
    service.attachWiki('r2', 'wiki-c')
    const names = service.getAllAttachedNames()
    expect(names.sort()).toEqual(['b-alias', 'wiki-a', 'wiki-c'])
  })

  it('caching returns stale data after external file modification', () => {
    service.addRemote('origin', 'http://localhost:3000')
    const configPath = path.join(tmpDir, 'remotes.json')
    const modified = { remotes: { other: { url: 'http://other.test', attachedWikis: {} } } }
    fs.writeFileSync(configPath, JSON.stringify(modified), 'utf-8')
    const config = service.load()
    expect(config.remotes['origin']).toBeDefined()
    expect(config.remotes['other']).toBeUndefined()
  })
})
