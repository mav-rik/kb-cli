import * as path from 'node:path'
import * as fs from 'node:fs'
import { DbSpace } from '@atscript/db'
import { syncSchema } from '@atscript/db/sync'
import { SqliteAdapter, BetterSqlite3Driver } from '@atscript/db-sqlite'
import { Document } from '../models/document.as'
import { Link } from '../models/link.as'
import { Chunk } from '../models/chunk.as'
import { ConfigService } from './config.service.js'

// Exclude the `embedding` blob from every Document read — callers never
// need the raw vector outside IndexService.semanticSearch / setEmbedding.
const DOC_READ_CONTROLS = { $select: { embedding: 0 } } as const
const CHUNK_READ_CONTROLS = { $select: { embedding: 0 } } as const

interface RawDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  exec(sql: string): void
}

export class IndexService {
  private spaces: Map<string, DbSpace> = new Map()
  private drivers: Map<string, BetterSqlite3Driver> = new Map()
  private configService: ConfigService

  constructor(configService?: ConfigService) {
    this.configService = configService ?? new ConfigService()
  }

  private getDbPath(kb: string): string {
    const dataDir = this.configService.getDataDir()
    return path.join(dataDir, kb, 'index.db')
  }

  private ensureKbDir(kb: string): void {
    const dir = path.dirname(this.getDbPath(kb))
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  async getSpace(kb: string): Promise<DbSpace> {
    const existing = this.spaces.get(kb)
    if (existing) return existing

    this.ensureKbDir(kb)
    const dbPath = this.getDbPath(kb)
    const driver = new BetterSqlite3Driver(dbPath, { vector: true })
    // v1 wikis carry triggers from the removed `@db.index.fulltext` annotation
    // on Chunk.content, plus a stale atscript-db model snapshot that makes
    // insertOne write the OLD field list (no fromLine/toLine/embedding/etc.).
    // Drop the FTS triggers, the chunks table, and the cached snapshots so
    // syncSchema rebuilds the chunks table from the current model. Idempotent.
    const rawDb = (driver as unknown as { db: RawDb }).db
    for (const t of ['chunks__fts__chunk_search__ai', 'chunks__fts__chunk_search__ad', 'chunks__fts__chunk_search__au']) {
      rawDb.exec(`DROP TRIGGER IF EXISTS "${t}"`)
    }
    rawDb.exec(`DROP TABLE IF EXISTS "chunks__fts__chunk_search"`)
    try {
      const hasLegacyContent = rawDb
        .prepare(`SELECT 1 as ok FROM pragma_table_info('chunks') WHERE name = 'content'`)
        .get() as { ok: number } | undefined
      const hasOrphanVec = rawDb
        .prepare(`SELECT 1 as ok FROM sqlite_master WHERE name = 'chunks__vec__embedding'`)
        .get() as { ok: number } | undefined
      const hasChunksTable = rawDb
        .prepare(`SELECT 1 as ok FROM sqlite_master WHERE name = 'chunks' AND type = 'table'`)
        .get() as { ok: number } | undefined
      const staleSync = rawDb
        .prepare(`SELECT 1 as ok FROM __atscript_control WHERE _id = 'synced_tables' AND value LIKE '%"name":"chunks"%'`)
        .get() as { ok: number } | undefined
      if (hasLegacyContent || (hasOrphanVec && !hasChunksTable) || (staleSync && !hasChunksTable)) {
        rawDb.exec(`DROP TABLE IF EXISTS chunks`)
        rawDb.exec(`DROP TABLE IF EXISTS chunks_fts`)
        // Drop the chunks vec0 shadow so syncSchema rebuilds the whole chunks
        // surface from the current model. atscript-db otherwise sees the
        // shadow as evidence the parent table exists and skips creation.
        for (const t of ['chunks__vec__embedding', 'chunks__vec__embedding_info', 'chunks__vec__embedding_chunks', 'chunks__vec__embedding_rowids', 'chunks__vec__embedding_vector_chunks00']) {
          rawDb.exec(`DROP TABLE IF EXISTS "${t}"`)
        }
        rawDb.exec(`DELETE FROM __atscript_control WHERE _id LIKE 'table_snapshot:chunks%'`)
        // synced_tables lists which tables atscript-db considers in-sync.
        // Leaving the chunks entry would make syncSchema skip table creation.
        // Removing the whole record forces a full re-sync; documents/links
        // are unaffected because they still match their snapshots.
        rawDb.exec(`DELETE FROM __atscript_control WHERE _id = 'synced_tables'`)
      }
    } catch {
      // best-effort
    }
    const space = new DbSpace(() => new SqliteAdapter(driver))
    await syncSchema(space, [Document, Link, Chunk])
    if (!driver.hasVectorExt) {
      throw new Error(
        'sqlite-vec failed to load. The package ships with kb-wiki — this usually indicates a native-build mismatch. Try `pnpm rebuild sqlite-vec` or reinstall kb-wiki.',
      )
    }
    this.spaces.set(kb, space)
    this.drivers.set(kb, driver)
    return space
  }

  /**
   * Raw better-sqlite3 handle for migration-only queries that can't be
   * expressed via the typed table API (counting `embedding IS NULL`,
   * probing `sqlite_master`, dropping a legacy table). The unsafe cast
   * lives here, not at every callsite, so application code keeps using
   * the typed table API + DOC_READ_CONTROLS exclusion projection.
   */
  private async getRawDb(kb: string): Promise<RawDb> {
    await this.getSpace(kb)
    const driver = this.drivers.get(kb)!
    return (driver as unknown as { db: RawDb }).db
  }

  async countDocs(kb: string): Promise<number> {
    const db = await this.getRawDb(kb)
    return (db.prepare('SELECT COUNT(*) as n FROM documents').get() as { n: number }).n
  }

  async countDocsWithoutEmbedding(kb: string): Promise<number> {
    const db = await this.getRawDb(kb)
    try {
      return (
        db.prepare('SELECT COUNT(*) as n FROM documents WHERE embedding IS NULL').get() as {
          n: number
        }
      ).n
    } catch {
      // table missing or column not yet added — treat as fully needing work
      return 0
    }
  }

  async listDocsForMigration(
    kb: string,
  ): Promise<Array<{ id: string; contentHash: string; hasEmbedding: boolean }>> {
    const db = await this.getRawDb(kb)
    try {
      type Row = { id: string; contentHash: string; has_embedding: number }
      const rows = db
        .prepare(
          'SELECT id, contentHash, (embedding IS NOT NULL) as has_embedding FROM documents',
        )
        .all() as Row[]
      return rows.map((r) => ({
        id: r.id,
        contentHash: r.contentHash,
        hasEmbedding: !!r.has_embedding,
      }))
    } catch {
      return []
    }
  }

  async hasLegacyVecTable(kb: string): Promise<boolean> {
    const db = await this.getRawDb(kb)
    try {
      const row = db
        .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name=?`)
        .get('documents_vec') as { ok: number } | undefined
      return !!row
    } catch {
      return false
    }
  }

  async dropLegacyVecTable(kb: string): Promise<void> {
    const db = await this.getRawDb(kb)
    try {
      db.exec('DROP TABLE IF EXISTS documents_vec')
    } catch {
      // best-effort — table may not exist
    }
  }

  async hasLegacyFtsTable(kb: string): Promise<boolean> {
    const db = await this.getRawDb(kb)
    try {
      const row = db
        .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name=?`)
        .get('documents_fts') as { ok: number } | undefined
      return !!row
    } catch {
      return false
    }
  }

  async dropLegacyFtsTable(kb: string): Promise<void> {
    const db = await this.getRawDb(kb)
    try {
      db.exec('DROP TABLE IF EXISTS documents_fts')
    } catch {
      // best-effort — table may not exist
    }
  }

  async upsertDoc(
    kb: string,
    doc: {
      id: string
      title: string
      category: string
      tags?: string[]
      filePath: string
      contentHash: string
    },
  ): Promise<void> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Document)
    const existing = await table.findOne({
      filter: { id: doc.id },
      controls: DOC_READ_CONTROLS,
    })
    if (existing) {
      await table.updateOne({ ...doc, updatedAt: Date.now() })
    } else {
      await table.insertOne({ ...doc, createdAt: Date.now(), updatedAt: Date.now() })
    }
  }

  async setEmbedding(kb: string, id: string, embedding: Float32Array): Promise<void> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Document)
    await table.updateOne({ id, embedding: Array.from(embedding) })
  }

  async semanticSearch(
    kb: string,
    queryVec: Float32Array,
    limit: number,
  ): Promise<{ id: string; distance: number }[]> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Document)
    const rows = await table.vectorSearch(Array.from(queryVec), {
      controls: { $limit: limit, $select: { embedding: 0 } },
    })
    return rows.map((row) => {
      const r = row as unknown as { id: string; _distance: number }
      return { id: r.id, distance: r._distance }
    })
  }

  async deleteDoc(kb: string, id: string): Promise<void> {
    const space = await this.getSpace(kb)
    await space.getTable(Document).deleteOne(id)
    await space.getTable(Link).deleteMany({ fromId: id })
    await space.getTable(Link).deleteMany({ toId: id })
    await space.getTable(Chunk).deleteMany({ docId: id })
  }

  async getDoc(kb: string, id: string): Promise<Document | null> {
    const space = await this.getSpace(kb)
    return space.getTable(Document).findOne({
      filter: { id },
      controls: DOC_READ_CONTROLS,
    })
  }

  async listDocs(
    kb: string,
    filters?: { category?: string; tag?: string },
  ): Promise<Document[]> {
    const space = await this.getSpace(kb)
    const filter: Record<string, unknown> = {}
    if (filters?.category) filter.category = filters.category
    let results = await space.getTable(Document).findMany({
      filter,
      controls: DOC_READ_CONTROLS,
    })
    if (filters?.tag) {
      results = results.filter(
        (doc) => doc.tags && doc.tags.includes(filters.tag!),
      )
    }
    return results
  }

  async upsertLinks(
    kb: string,
    fromId: string,
    links: { toId: string; linkText?: string }[],
  ): Promise<void> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Link)
    await table.deleteMany({ fromId })
    // Deduplicate by toId (keep first occurrence)
    const seen = new Set<string>()
    for (const link of links) {
      if (seen.has(link.toId)) continue
      seen.add(link.toId)
      await table.insertOne({ fromId, toId: link.toId, linkText: link.linkText })
    }
  }

  async getLinksFrom(kb: string, id: string): Promise<Link[]> {
    const space = await this.getSpace(kb)
    return space.getTable(Link).findMany({ filter: { fromId: id } })
  }

  async getLinksTo(kb: string, id: string): Promise<Link[]> {
    const space = await this.getSpace(kb)
    return space.getTable(Link).findMany({ filter: { toId: id } })
  }

  async upsertChunks(
    kb: string,
    docId: string,
    chunks: {
      id: string
      heading?: string
      headingPath?: string
      headingLevel?: number
      fromLine: number
      toLine: number
      position: number
      contentHash: string
      embedding?: Float32Array
    }[],
  ): Promise<void> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Chunk)
    await table.deleteMany({ docId })
    for (const c of chunks) {
      await table.insertOne({
        ...c,
        docId,
        embedding: c.embedding && Array.from(c.embedding),
      })
    }
  }

  async semanticSearchChunks(
    kb: string,
    queryVec: Float32Array,
    limit: number,
  ): Promise<{ id: string; docId: string; distance: number }[]> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Chunk)
    const rows = await table.vectorSearch(Array.from(queryVec), {
      controls: { $limit: limit, $select: { embedding: 0 } },
    })
    return rows.map((row) => {
      const r = row as unknown as { id: string; docId: string; _distance: number }
      return { id: r.id, docId: r.docId, distance: r._distance }
    })
  }

  async listChunksForDoc(
    kb: string,
    docId: string,
  ): Promise<{ id: string; contentHash: string; embedding?: number[] }[]> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Chunk)
    const rows = await table.findMany({ filter: { docId } })
    return rows.map((r) => ({
      id: r.id,
      contentHash: r.contentHash,
      embedding: r.embedding,
    }))
  }

  async listChunksByIds(kb: string, ids: string[]): Promise<Chunk[]> {
    if (ids.length === 0) return []
    const space = await this.getSpace(kb)
    const table = space.getTable(Chunk)
    return table.findMany({
      filter: { id: { $in: ids } },
      controls: CHUNK_READ_CONTROLS,
    })
  }

  async dropAll(kb: string): Promise<void> {
    // Physically drop tables (including vec0 shadow tables) instead of
    // row-level delete. vec0 preallocates 1024-slot storage blocks (~3MB
    // each at 768-dim) and never reclaims them on delete — only DROP TABLE
    // releases the space. Without this, every reindex leaks one block.
    const rawDb = await this.getRawDb(kb)

    const vecShadows = (prefix: string) => [
      prefix,
      `${prefix}_info`,
      `${prefix}_chunks`,
      `${prefix}_rowids`,
      `${prefix}_vector_chunks00`,
    ]

    const tablesToDrop = [
      'links',
      'chunks_fts',
      'chunks',
      'documents',
      ...vecShadows('documents__vec__embedding'),
      ...vecShadows('chunks__vec__embedding'),
    ]
    for (const t of tablesToDrop) {
      rawDb.exec(`DROP TABLE IF EXISTS "${t}"`)
    }

    // Clear atscript-db's sync state so the next getSpace() runs a full
    // syncSchema against the current models. Without dropping
    // `schema_version`, syncSchema short-circuits on its cached hash and
    // never recreates the tables.
    rawDb.exec(
      `DELETE FROM __atscript_control WHERE _id IN ('schema_version', 'synced_tables') OR _id LIKE 'table_snapshot:%'`,
    )

    // SQLite marks dropped pages as free but doesn't shrink the file
    // without VACUUM. Reclaim the freed shadow-chunk space now — reindex
    // is already a heavy operation, the extra full-file rewrite is cheap
    // relative to re-embedding. The TRUNCATE checkpoint forces the main
    // file to shrink immediately so `kb wiki list` reports the new size
    // (otherwise the page count drops but the file stays full-sized until
    // the next checkpoint).
    rawDb.exec(`VACUUM`)
    rawDb.exec(`PRAGMA wal_checkpoint(TRUNCATE)`)

    // Evict the cached DbSpace + driver so the next getSpace() reopens
    // with a clean connection and re-syncs the schema. The cached space's
    // internal metadata refers to tables we just dropped.
    const driver = this.drivers.get(kb)
    this.spaces.delete(kb)
    this.drivers.delete(kb)
    driver?.close?.()
  }
}
