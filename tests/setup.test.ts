import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { upsertMemo } from '../src/controllers/setup.controller.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-setup-test-'))

const BODY = '## kb\n\nHello world body.\n- one\n- two'

function read(name: string): string {
  return fs.readFileSync(path.join(tmpDir, name), 'utf-8')
}

function write(name: string, content: string): string {
  const p = path.join(tmpDir, name)
  fs.writeFileSync(p, content)
  return p
}

describe('upsertMemo', () => {
  beforeEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true })
    }
  })

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true })
    }
  })

  it('creates file when absent', () => {
    const filePath = path.join(tmpDir, 'NEW.md')
    expect(upsertMemo(filePath, BODY)).toBe('created')
    const content = read('NEW.md')
    expect(content).toContain('<!-- kb-cli:start')
    expect(content).toContain('<!-- kb-cli:end -->')
    expect(content).toContain('Hello world body.')
  })

  it('appends to existing file without markers', () => {
    const filePath = write('EXISTING.md', '# User notes\n\nThis is my file.\n')
    expect(upsertMemo(filePath, BODY)).toBe('appended')
    const content = read('EXISTING.md')
    expect(content).toMatch(/^# User notes/)
    expect(content).toContain('This is my file.')
    expect(content).toContain('<!-- kb-cli:start')
    expect(content).toContain('Hello world body.')
  })

  it('replaces content between markers (idempotent)', () => {
    const filePath = path.join(tmpDir, 'IDEMPOTENT.md')
    upsertMemo(filePath, BODY) // first write
    const first = read('IDEMPOTENT.md')
    expect(upsertMemo(filePath, BODY)).toBe('replaced') // second write
    const second = read('IDEMPOTENT.md')
    expect(second).toBe(first) // byte-identical
  })

  it('replaces with updated body, preserves surrounding content', () => {
    const filePath = write('MIXED.md', '# Top header\n\nPreserved before.\n\n')
    upsertMemo(filePath, 'first version body')
    const between = read('MIXED.md')
    fs.appendFileSync(filePath, '\n\nPreserved after.\n')
    upsertMemo(filePath, 'second version body')
    const final = read('MIXED.md')
    expect(final).toContain('# Top header')
    expect(final).toContain('Preserved before.')
    expect(final).toContain('Preserved after.')
    expect(final).toContain('second version body')
    expect(final).not.toContain('first version body')
    expect(between).not.toBe(final)
  })

  it('appends when start marker is malformed (no end marker)', () => {
    const filePath = write(
      'BROKEN.md',
      '# Notes\n\n<!-- kb-cli:start v=0.1.0 -->\nstray content with no end\n\nmore text\n',
    )
    expect(upsertMemo(filePath, BODY)).toBe('appended')
    const content = read('BROKEN.md')
    expect(content).toContain('stray content with no end') // existing kept
    expect(content).toContain('Hello world body.') // new block appended
    // Two start markers now exist — user's broken file is preserved, fresh block is added.
    const startMarkers = content.match(/<!--\s*kb-cli:start/g) || []
    expect(startMarkers.length).toBe(2)
  })

  it('marker regex tolerates different version tags', () => {
    const oldBlock =
      '# Header\n\n<!-- kb-cli:start v=0.0.1 -->\nold body\n<!-- kb-cli:end -->\n\nfooter line\n'
    const filePath = write('OLD_VERSION.md', oldBlock)
    expect(upsertMemo(filePath, BODY)).toBe('replaced')
    const content = read('OLD_VERSION.md')
    expect(content).not.toContain('old body')
    expect(content).toContain('Hello world body.')
    expect(content).toContain('footer line') // surrounding content preserved
  })

  it('creates parent directories when missing', () => {
    const filePath = path.join(tmpDir, 'nested', 'sub', 'FILE.md')
    expect(upsertMemo(filePath, BODY)).toBe('created')
    expect(fs.existsSync(filePath)).toBe(true)
  })
})
