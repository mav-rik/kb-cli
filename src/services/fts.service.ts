import Database from 'better-sqlite3'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'

export class FtsService {
  private connections: Map<string, Database.Database> = new Map()

  constructor(private config: ConfigService) {}

  private getDb(kb: string): Database.Database {
    const existing = this.connections.get(kb)
    if (existing) return existing

    const dbPath = path.join(this.config.getDataDir(), kb, 'index.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    this.connections.set(kb, db)
    return db
  }

  ensureTables(kb: string): void {
    const db = this.getDb(kb)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        id UNINDEXED,
        title,
        tags,
        content,
        tokenize='porter unicode61'
      )
    `)
  }

  upsert(kb: string, id: string, title: string, tags: string[], content: string): void {
    const db = this.getDb(kb)
    this.ensureTables(kb)
    const tagsStr = tags.join(' ')

    // Delete existing entry by id
    db.prepare(`DELETE FROM documents_fts WHERE id = ?`).run(id)

    db.prepare(
      `INSERT INTO documents_fts(id, title, tags, content) VALUES(?, ?, ?, ?)`
    ).run(id, title, tagsStr, content)
  }

  delete(kb: string, id: string): void {
    const db = this.getDb(kb)
    this.ensureTables(kb)
    db.prepare(`DELETE FROM documents_fts WHERE id = ?`).run(id)
  }

  search(kb: string, query: string, limit: number = 20): { id: string; rank: number }[] {
    const db = this.getDb(kb)
    this.ensureTables(kb)

    try {
      const results = db.prepare(`
        SELECT id, rank
        FROM documents_fts
        WHERE documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit) as { id: string; rank: number }[]

      return results
    } catch {
      // FTS5 MATCH can throw on invalid syntax — fall back to empty
      return []
    }
  }

  dropAll(kb: string): void {
    const db = this.getDb(kb)
    db.exec(`DROP TABLE IF EXISTS documents_fts`)
    this.ensureTables(kb)
  }
}
