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
    chunks: { id: string; heading?: string; content: string; position: number; contentHash: string }[],
  ): Promise<void> {
    const space = await this.getSpace(kb)
    const table = space.getTable(Chunk)
    await table.deleteMany({ docId })
    for (const chunk of chunks) {
      await table.insertOne({ ...chunk, docId })
    }
  }

  async dropAll(kb: string): Promise<void> {
    const space = await this.getSpace(kb)
    await space.getTable(Document).deleteMany({})
    await space.getTable(Link).deleteMany({})
    await space.getTable(Chunk).deleteMany({})
  }
}
