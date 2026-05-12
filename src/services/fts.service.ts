import Database from 'better-sqlite3'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'

/**
 * Build an FTS5 MATCH expression from a natural-language query.
 *
 * The raw query is split on whitespace and punctuation, then each token is
 * wrapped in double-quotes and joined with `OR`. This gives BM25 the freedom
 * to rank partial-match docs sensibly — a doc hitting 2 of 3 query tokens
 * still appears, just lower than a doc hitting all 3.
 *
 * Without this rewrite, FTS5's default implicit-AND would drop any doc that
 * doesn't literally contain every query token. Natural-language queries like
 * "vault credentials rotation" would miss the obvious match (a doc that
 * covers vault credentials but uses "refresh" instead of "rotation").
 */
export function buildFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean)
    .map((t) => `"${t}"`)
  return tokens.join(' OR ')
}

export class FtsService {
  private connections: Map<string, Database.Database> = new Map()

  constructor(private config: ConfigService) {}

  private getDb(kb: string): Database.Database {
    const existing = this.connections.get(kb)
    if (existing) return existing

    const dbPath = path.join(this.config.getDataDir(), kb, 'index.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        id UNINDEXED,
        title,
        tags,
        content,
        tokenize='porter unicode61'
      )
    `)
    this.connections.set(kb, db)
    return db
  }

  ensureTables(kb: string): void {
    this.getDb(kb)
  }

  upsert(kb: string, id: string, title: string, tags: string[], content: string): void {
    const db = this.getDb(kb)
    const tagsStr = tags.join(' ')
    db.prepare(`DELETE FROM documents_fts WHERE id = ?`).run(id)
    db.prepare(
      `INSERT INTO documents_fts(id, title, tags, content) VALUES(?, ?, ?, ?)`
    ).run(id, title, tagsStr, content)
  }

  delete(kb: string, id: string): void {
    const db = this.getDb(kb)
    db.prepare(`DELETE FROM documents_fts WHERE id = ?`).run(id)
  }

  search(kb: string, query: string, limit: number = 20): { id: string; rank: number }[] {
    const ftsExpr = buildFtsQuery(query)
    if (!ftsExpr) return []
    const db = this.getDb(kb)

    try {
      const results = db.prepare(`
        SELECT id, bm25(documents_fts, 0.0, 3.0, 2.0, 1.0) as rank
        FROM documents_fts
        WHERE documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsExpr, limit) as { id: string; rank: number }[]

      return results
    } catch {
      return []
    }
  }

  dropAll(kb: string): void {
    const db = this.getDb(kb)
    db.exec(`DROP TABLE IF EXISTS documents_fts`)
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
}
