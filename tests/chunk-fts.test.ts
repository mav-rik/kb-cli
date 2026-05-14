import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-chunk-fts-'))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => tmpDir }
})

const { ConfigService } = await import('../src/services/config.service.js')
const { ChunkFtsService } = await import('../src/services/chunk-fts.service.js')

const kbDir = path.join(tmpDir, '.kb')

function freshKbDir() {
  if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(kbDir, 'wiki'), { recursive: true })
}

function makeService() {
  return new ChunkFtsService(new ConfigService())
}

// The new design uses chunks.rowid as the FTS5 join key, so the `chunks` table
// must exist and contain a row for every chunk id we hand to chunkFts.upsert.
// We create a minimal mirror of the atscript-db schema (id PK + docId) here so
// the unit tests stay isolated from IndexService.
function seedChunks(rows: { id: string; docId: string }[]) {
  fs.mkdirSync(path.join(kbDir, 'wiki'), { recursive: true })
  const db = new Database(path.join(kbDir, 'wiki', 'index.db'))
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, docId TEXT NOT NULL)`)
    const insert = db.prepare(`INSERT OR IGNORE INTO chunks (id, docId) VALUES (?, ?)`)
    for (const r of rows) insert.run(r.id, r.docId)
  } finally {
    db.close()
  }
}

describe('ChunkFtsService', () => {
  beforeEach(() => {
    freshKbDir()
  })

  afterEach(() => {
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true, force: true })
  })

  it('upsert + search returns inserted chunk id for content match', () => {
    seedChunks([
      { id: 'c1', docId: 'd1' },
      { id: 'c2', docId: 'd1' },
      { id: 'c3', docId: 'd2' },
    ])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', heading: 'Alpha', headingPath: 'Alpha', title: 'D1', tags: [], content: 'banana fruit ripe' })
    svc.upsert('wiki', { id: 'c2', docId: 'd1', heading: 'Beta', headingPath: 'Beta', title: 'D1', tags: [], content: 'orange citrus' })
    svc.upsert('wiki', { id: 'c3', docId: 'd2', heading: 'Gamma', headingPath: 'Gamma', title: 'D2', tags: [], content: 'apple crunchy' })

    const hits = svc.search('wiki', 'banana', 10)
    expect(hits.length).toBe(1)
    expect(hits[0].id).toBe('c1')
  })

  it('upsert + search produces hits whose count matches inserted matches', () => {
    seedChunks([
      { id: 'c1', docId: 'd1' },
      { id: 'c2', docId: 'd1' },
    ])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'D1', tags: [], content: 'banana fruit ripe' })
    svc.upsert('wiki', { id: 'c2', docId: 'd1', title: 'D1', tags: [], content: 'orange citrus' })
    const hits = svc.search('wiki', 'banana', 10)
    expect(hits.length).toBe(1)
    expect(typeof hits[0].rank).toBe('number')
  })

  it('BM25 weights heading higher than content (depends on id retrieval)', () => {
    seedChunks([
      { id: 'a', docId: 'd1' },
      { id: 'b', docId: 'd2' },
    ])
    const svc = makeService()
    svc.upsert('wiki', { id: 'a', docId: 'd1', heading: 'kubernetes', headingPath: 'kubernetes', title: 'T1', tags: [], content: 'unrelated text here' })
    svc.upsert('wiki', { id: 'b', docId: 'd2', heading: 'Other', headingPath: 'Other', title: 'T2', tags: [], content: 'we use kubernetes for deployment' })

    const hits = svc.search('wiki', 'kubernetes', 10)
    expect(hits.length).toBe(2)
    expect(hits[0].id).toBe('a')
  })

  it('delete by id removes only that row', () => {
    seedChunks([{ id: 'c1', docId: 'd1' }])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'unique-token' })
    expect(svc.search('wiki', 'unique-token', 10).length).toBe(1)
    svc.delete('wiki', 'c1')
    expect(svc.search('wiki', 'unique-token', 10).length).toBe(0)
  })

  it('deleteByDoc removes every chunk of a doc', () => {
    seedChunks([
      { id: 'c1', docId: 'd1' },
      { id: 'c2', docId: 'd1' },
      { id: 'c3', docId: 'd1' },
    ])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'apple' })
    svc.upsert('wiki', { id: 'c2', docId: 'd1', title: 'T', tags: [], content: 'banana' })
    svc.upsert('wiki', { id: 'c3', docId: 'd1', title: 'T', tags: [], content: 'cherry' })

    svc.deleteByDoc('wiki', 'd1')
    expect(svc.search('wiki', 'apple', 10).length).toBe(0)
    expect(svc.search('wiki', 'banana', 10).length).toBe(0)
    expect(svc.search('wiki', 'cherry', 10).length).toBe(0)
  })

  it('FTS table is contentless — indexed column reads return null', async () => {
    seedChunks([{ id: 'c1', docId: 'd1' }])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'probe-banana fruit' })

    const db = new Database(path.join(kbDir, 'wiki', 'index.db'))
    try {
      const matched = db.prepare(`SELECT count(*) as n FROM chunks_fts WHERE chunks_fts MATCH ?`).get('"probe-banana"') as { n: number }
      expect(matched.n).toBe(1)

      const row = db.prepare(`SELECT content, title FROM chunks_fts WHERE chunks_fts MATCH ?`).get('"probe-banana"') as { content: string | null; title: string | null }
      expect(row.content).toBeNull()
      expect(row.title).toBeNull()
    } finally {
      db.close()
    }
  })

  it('dropAll empties the FTS table and search returns []', () => {
    seedChunks([
      { id: 'c1', docId: 'd1' },
      { id: 'c2', docId: 'd2' },
    ])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'banana' })
    svc.upsert('wiki', { id: 'c2', docId: 'd2', title: 'T', tags: [], content: 'apple' })
    expect(svc.search('wiki', 'banana', 10).length).toBe(1)

    svc.dropAll('wiki')

    expect(svc.search('wiki', 'banana', 10).length).toBe(0)
    expect(svc.search('wiki', 'apple', 10).length).toBe(0)
  })

  it('upsert same chunk id twice replaces the row — no duplicates in FTS', async () => {
    seedChunks([{ id: 'c1', docId: 'd1' }])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'apple' })
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'banana' })

    expect(svc.search('wiki', 'apple', 10).length).toBe(0)
    expect(svc.search('wiki', 'banana', 10).length).toBe(1)

    const db = new Database(path.join(kbDir, 'wiki', 'index.db'))
    try {
      const ftsCount = db.prepare(`SELECT count(*) as n FROM chunks_fts`).get() as { n: number }
      expect(ftsCount.n).toBe(1)
    } finally {
      db.close()
    }
  })

  it('upsert throws clearly when chunk id is missing from chunks table', () => {
    // No seedChunks call — the chunks row for c1 does not exist.
    seedChunks([])
    const svc = makeService()
    expect(() =>
      svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'apple' }),
    ).toThrow(/not in chunks table/)
  })

  it('legacy chunks_fts_rowid table is auto-dropped on first connection', async () => {
    fs.mkdirSync(path.join(kbDir, 'wiki'), { recursive: true })
    const dbPath = path.join(kbDir, 'wiki', 'index.db')
    {
      const db = new Database(dbPath)
      db.exec(`CREATE TABLE chunks_fts_rowid (rowid INTEGER PRIMARY KEY, chunk_id TEXT, doc_id TEXT)`)
      db.exec(`CREATE VIRTUAL TABLE chunks_fts USING fts5(heading_path, heading, title, tags, content, content='', contentless_delete=1)`)
      db.prepare(`INSERT INTO chunks_fts_rowid(chunk_id, doc_id) VALUES (?, ?)`).run('stale', 'd1')
      db.close()
    }

    // First connection should drop both legacy tables and recreate chunks_fts.
    makeService().ensureTables('wiki')

    const db = new Database(dbPath)
    try {
      const legacy = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks_fts_rowid'`).get()
      expect(legacy).toBeUndefined()
      const fts = db.prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table','virtual') AND name='chunks_fts'`).get()
      // chunks_fts is a virtual table, sqlite_master records it as type='table'
      expect(fts).toBeDefined()
    } finally {
      db.close()
    }
  })

  it('malformed/empty query returns [] without throwing', () => {
    seedChunks([{ id: 'c1', docId: 'd1' }])
    const svc = makeService()
    svc.upsert('wiki', { id: 'c1', docId: 'd1', title: 'T', tags: [], content: 'banana' })
    expect(svc.search('wiki', '', 10)).toEqual([])
    expect(svc.search('wiki', '!!!@@@###', 10)).toEqual([])
  })
})
