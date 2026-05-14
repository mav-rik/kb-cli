import Database from 'better-sqlite3'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'
import { buildFtsQuery } from '../utils/fts-query.js'

const CREATE_CHUNKS_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    heading_path,
    heading,
    title,
    tags,
    content,
    content='',
    contentless_delete=1,
    tokenize='porter unicode61'
  )
`

// chunks_fts.rowid IS chunks.rowid — the atscript-db `chunks` table is the bridge
// from FTS5's required INTEGER rowid back to our TEXT chunk id. Callers must
// upsert into `chunks` BEFORE calling chunkFts.upsert, and must call
// chunkFts.deleteByDoc BEFORE deleting from `chunks` (otherwise the rowid lookup
// returns nothing and orphans the FTS rows).
export class ChunkFtsService {
  private connections: Map<string, Database.Database> = new Map()

  constructor(private config: ConfigService) {}

  private getDb(kb: string): Database.Database {
    const existing = this.connections.get(kb)
    if (existing) return existing

    const dbPath = path.join(this.config.getDataDir(), kb, 'index.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    // Auto-cleanup of the previous rowid-mapping design. Dropping chunks_fts
    // alongside chunks_fts_rowid is intentional: its rowids referenced the
    // mapping table, not chunks.rowid, so it's garbage under the new schema.
    // Recovery path is `kb reindex`.
    const legacyRowidExists = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks_fts_rowid'`,
    ).get()
    if (legacyRowidExists) {
      db.exec(`DROP TABLE IF EXISTS chunks_fts`)
      db.exec(`DROP TABLE IF EXISTS chunks_fts_rowid`)
    }

    db.exec(CREATE_CHUNKS_FTS)
    this.connections.set(kb, db)
    return db
  }

  ensureTables(kb: string): void {
    this.getDb(kb)
  }

  upsert(
    kb: string,
    row: {
      id: string
      docId: string
      headingPath?: string
      heading?: string
      title: string
      tags: string[]
      content: string
    },
  ): void {
    const db = this.getDb(kb)
    const selectChunkRowid = db.prepare(`SELECT rowid FROM chunks WHERE id = ?`)
    const deleteFts = db.prepare(`DELETE FROM chunks_fts WHERE rowid = ?`)
    const insertFts = db.prepare(
      `INSERT INTO chunks_fts(rowid, heading_path, heading, title, tags, content) VALUES(?, ?, ?, ?, ?, ?)`,
    )

    const chunkRow = selectChunkRowid.get(row.id) as { rowid: number | bigint } | undefined
    if (!chunkRow) {
      throw new Error(
        `chunk id ${row.id} not in chunks table; call upsertChunks before chunkFts.upsert`,
      )
    }

    db.transaction(() => {
      deleteFts.run(chunkRow.rowid)
      insertFts.run(
        chunkRow.rowid,
        row.headingPath ?? '',
        row.heading ?? '',
        row.title,
        row.tags.join(' '),
        row.content,
      )
    })()
  }

  delete(kb: string, id: string): void {
    const db = this.getDb(kb)
    const selectChunkRowid = db.prepare(`SELECT rowid FROM chunks WHERE id = ?`)
    const chunkRow = selectChunkRowid.get(id) as { rowid: number | bigint } | undefined
    if (!chunkRow) return
    db.prepare(`DELETE FROM chunks_fts WHERE rowid = ?`).run(chunkRow.rowid)
  }

  deleteByDoc(kb: string, docId: string): void {
    const db = this.getDb(kb)
    const chunksExists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunks'`)
      .get()
    if (!chunksExists) return
    db.prepare(
      `DELETE FROM chunks_fts WHERE rowid IN (SELECT rowid FROM chunks WHERE docId = ?)`,
    ).run(docId)
  }

  search(kb: string, query: string, limit: number): { id: string; rank: number }[] {
    const ftsExpr = buildFtsQuery(query)
    if (!ftsExpr) return []
    const db = this.getDb(kb)

    try {
      // Weight order: heading_path, heading, title, tags, content.
      // Heading boost calibrated empirically against the booking wiki A/B —
      // see RESULTS-01.md / RESULTS-02.md. 3.0 let short meta-sections
      // outrank substantive ones; 2.0 keeps headings useful without dominating.
      return db.prepare(`
        SELECT chunks.id AS id, bm25(chunks_fts, 2.0, 2.0, 2.0, 1.0, 1.0) AS rank
        FROM chunks_fts
        JOIN chunks ON chunks.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsExpr, limit) as { id: string; rank: number }[]
    } catch {
      return []
    }
  }

  dropAll(kb: string): void {
    const db = this.getDb(kb)
    db.exec(`DROP TABLE IF EXISTS chunks_fts`)
    db.exec(`DROP TABLE IF EXISTS chunks_fts_rowid`)
    db.exec(CREATE_CHUNKS_FTS)
  }
}
