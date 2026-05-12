import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-fts-'))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => tmpDir }
})

const { ConfigService } = await import('../src/services/config.service.js')
const { FtsService, buildFtsQuery } = await import('../src/services/fts.service.js')

const kbDir = path.join(tmpDir, '.kb')

describe('buildFtsQuery', () => {
  it('multi-word query becomes OR of quoted tokens', () => {
    expect(buildFtsQuery('vault credentials rotation')).toBe(
      '"vault" OR "credentials" OR "rotation"',
    )
  })

  it('single-word query is one quoted token (no OR)', () => {
    expect(buildFtsQuery('vault')).toBe('"vault"')
  })

  it('splits on punctuation as well as whitespace', () => {
    expect(buildFtsQuery('r12-partner-bank')).toBe('"r12" OR "partner" OR "bank"')
  })

  it('lowercases tokens to match the porter+unicode61 indexing', () => {
    expect(buildFtsQuery('VaUlT')).toBe('"vault"')
  })

  it('empty or pure-punctuation input returns empty string', () => {
    expect(buildFtsQuery('')).toBe('')
    expect(buildFtsQuery('   ')).toBe('')
    expect(buildFtsQuery('---!!!')).toBe('')
  })

  it('collapses consecutive whitespace/punctuation', () => {
    expect(buildFtsQuery('a   b,, c')).toBe('"a" OR "b" OR "c"')
  })
})

describe('FtsService.search', () => {
  beforeEach(() => {
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
    fs.mkdirSync(kbDir, { recursive: true })
  })

  it('ranks partial-match docs sensibly (2-of-3 still appears)', () => {
    const config = new ConfigService()
    const fts = new FtsService(config)
    // Pre-create the wiki dir so getDb finds the path.
    fs.mkdirSync(path.join(kbDir, 'w'), { recursive: true })

    // Doc A: has "vault" + "credentials" but not "rotation"
    fts.upsert(
      'w',
      'vault-creds',
      'Vault AWS Credentials',
      ['vault', 'aws', 'credentials'],
      'How services obtain AWS credentials via Vault STS. Refreshed by sidecar every 15 minutes.',
    )
    // Doc B: has all three tokens
    fts.upsert(
      'w',
      'qiss-infra',
      'QISS Infrastructure',
      ['qiss', 'aws'],
      'Provisions Vault role for credentials rotation across environments.',
    )
    // Doc C: has only one token
    fts.upsert(
      'w',
      'aws-setup',
      'AWS Accounts Setup',
      ['aws', 'cloud'],
      'Creating and managing AWS accounts via the bk CLI tool.',
    )

    const results = fts.search('w', 'vault credentials rotation', 10)

    // Both the 3-of-3 and the 2-of-3 docs must surface; the 1-of-1 (only "aws")
    // should NOT, because none of {vault, credentials, rotation} appears in it.
    const ids = results.map((r) => r.id)
    expect(ids).toContain('vault-creds')
    expect(ids).toContain('qiss-infra')
    expect(ids).not.toContain('aws-setup')

    // The 3-of-3 doc should outrank (lower bm25 = better) the 2-of-3 doc.
    const ranks = Object.fromEntries(results.map((r) => [r.id, r.rank]))
    expect(ranks['qiss-infra']).toBeLessThan(ranks['vault-creds'])
  })

  it('empty query returns empty results without throwing', () => {
    const config = new ConfigService()
    const fts = new FtsService(config)
    fs.mkdirSync(path.join(kbDir, 'w'), { recursive: true })
    fts.upsert('w', 'a', 'A', [], 'body')

    expect(fts.search('w', '', 10)).toEqual([])
    expect(fts.search('w', '   ', 10)).toEqual([])
  })
})
