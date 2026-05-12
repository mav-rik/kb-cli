import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { ActivityLogService } from '../src/services/activity-log.service.js'
import { ConfigService } from '../src/services/config.service.js'

let tmpDir: string
let configService: ConfigService
let logService: ActivityLogService

describe('ActivityLogService', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-log-test-'))
    const kbDir = path.join(tmpDir, 'test-wiki')
    fs.mkdirSync(kbDir, { recursive: true })

    configService = { getDataDir: () => tmpDir } as unknown as ConfigService
    logService = new ActivityLogService(configService)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when no logs exist', () => {
    const entries = logService.recent('test-wiki', 10)
    expect(entries).toEqual([])
  })

  it('logs an entry and retrieves it', () => {
    logService.log('test-wiki', 'add', 'my-doc', 'initial creation')

    const entries = logService.recent('test-wiki', 10)
    expect(entries).toHaveLength(1)
    expect(entries[0].operation).toBe('add')
    expect(entries[0].docId).toBe('my-doc')
    expect(entries[0].details).toBe('initial creation')
    expect(entries[0].timestamp).toBeTruthy()
  })

  it('logs without optional fields', () => {
    logService.log('test-wiki', 'note')

    const entries = logService.recent('test-wiki', 10)
    expect(entries).toHaveLength(1)
    expect(entries[0].operation).toBe('note')
    expect(entries[0].docId).toBeNull()
    expect(entries[0].details).toBeNull()
  })

  it('returns entries in reverse chronological order', () => {
    logService.log('test-wiki', 'add', 'doc-1')
    logService.log('test-wiki', 'update', 'doc-2')
    logService.log('test-wiki', 'delete', 'doc-3')

    const entries = logService.recent('test-wiki', 10)
    expect(entries).toHaveLength(3)
    expect(entries[0].operation).toBe('delete')
    expect(entries[1].operation).toBe('update')
    expect(entries[2].operation).toBe('add')
  })

  it('respects limit parameter', () => {
    logService.log('test-wiki', 'add', 'doc-1')
    logService.log('test-wiki', 'add', 'doc-2')
    logService.log('test-wiki', 'add', 'doc-3')

    const entries = logService.recent('test-wiki', 2)
    expect(entries).toHaveLength(2)
  })

  it('isolates logs between wikis', () => {
    const wiki2Dir = path.join(tmpDir, 'other-wiki')
    fs.mkdirSync(wiki2Dir, { recursive: true })

    logService.log('test-wiki', 'add', 'doc-a')
    logService.log('other-wiki', 'update', 'doc-b')

    const entries1 = logService.recent('test-wiki', 10)
    const entries2 = logService.recent('other-wiki', 10)
    expect(entries1).toHaveLength(1)
    expect(entries1[0].docId).toBe('doc-a')
    expect(entries2).toHaveLength(1)
    expect(entries2[0].docId).toBe('doc-b')
  })

  it('logs manual note entries (agent sessions)', () => {
    logService.log('test-wiki', 'note', undefined, 'Ingested 3 docs about auth patterns. Found overlap with existing session-management doc.')

    const entries = logService.recent('test-wiki', 10)
    expect(entries).toHaveLength(1)
    expect(entries[0].operation).toBe('note')
    expect(entries[0].docId).toBeNull()
    expect(entries[0].details).toContain('Ingested 3 docs')
  })
})
