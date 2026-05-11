import * as path from 'node:path'
import * as fs from 'node:fs'
import { DbSpace } from '@atscript/db'
import { syncSchema } from '@atscript/db/sync'
import { SqliteAdapter, BetterSqlite3Driver } from '@atscript/db-sqlite'
import { Document } from '../models/document.as'
import { Link } from '../models/link.as'
import { Chunk } from '../models/chunk.as'
import { ConfigService } from './config.service.js'

export class IndexService {
  private spaces: Map<string, DbSpace> = new Map()
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
    const driver = new BetterSqlite3Driver(dbPath)
    const space = new DbSpace(() => new SqliteAdapter(driver))
    await syncSchema(space, [Document, Link, Chunk])
    this.spaces.set(kb, space)
    return space
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
    const existing = await table.findOne({ filter: { id: doc.id } })
    if (existing) {
      await table.updateOne({ ...doc, updatedAt: Date.now() })
    } else {
      await table.insertOne({ ...doc, createdAt: Date.now(), updatedAt: Date.now() })
    }
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
    return space.getTable(Document).findOne({ filter: { id } })
  }

  async listDocs(
    kb: string,
    filters?: { category?: string; tag?: string },
  ): Promise<Document[]> {
    const space = await this.getSpace(kb)
    const filter: Record<string, unknown> = {}
    if (filters?.category) filter.category = filters.category
    let results = await space.getTable(Document).findMany({ filter })
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
