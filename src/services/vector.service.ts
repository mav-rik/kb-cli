import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'

export class VectorService {
  private connections: Map<string, Database.Database> = new Map()
  private config: ConfigService

  constructor(config?: ConfigService) {
    this.config = config ?? new ConfigService()
  }

  /**
   * Get or create a connection to the KB's index.db with sqlite-vec loaded.
   */
  private getDb(kb: string): Database.Database {
    const existing = this.connections.get(kb)
    if (existing) return existing

    const dataDir = this.config.getDataDir()
    const dbPath = path.join(dataDir, kb, 'index.db')
    const db = new Database(dbPath)
    sqliteVec.load(db)
    this.connections.set(kb, db)
    return db
  }

  /**
   * Ensure the vec0 virtual tables exist.
   * Creates: documents_vec (id TEXT, embedding FLOAT[384])
   */
  ensureTables(kb: string): void {
    const db = this.getDb(kb)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384]
      )
    `)
  }

  /**
   * Upsert a document's embedding vector.
   * vec0 virtual tables do not support INSERT OR REPLACE,
   * so we delete-then-insert for updates.
   */
  upsertVec(kb: string, id: string, embedding: Float32Array): void {
    const db = this.getDb(kb)
    db.prepare(`DELETE FROM documents_vec WHERE id = ?`).run(id)
    db.prepare(`
      INSERT INTO documents_vec (id, embedding) VALUES (?, ?)
    `).run(id, Buffer.from(embedding.buffer))
  }

  /**
   * Delete a document's vector.
   */
  deleteVec(kb: string, id: string): void {
    const db = this.getDb(kb)
    db.prepare(`DELETE FROM documents_vec WHERE id = ?`).run(id)
  }

  /**
   * KNN search: find the top-K nearest documents to the query embedding.
   * Returns array of { id, distance } sorted by distance (ascending = most similar).
   */
  searchVec(kb: string, queryEmbedding: Float32Array, limit: number): { id: string; distance: number }[] {
    const db = this.getDb(kb)
    const results = db.prepare(`
      SELECT id, distance
      FROM documents_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(Buffer.from(queryEmbedding.buffer), limit) as { id: string; distance: number }[]
    return results
  }

  /**
   * Drop all vector data for a KB.
   */
  dropAll(kb: string): void {
    const db = this.getDb(kb)
    db.exec('DELETE FROM documents_vec')
  }

  /**
   * Close all database connections.
   */
  close(): void {
    for (const db of this.connections.values()) {
      db.close()
    }
    this.connections.clear()
  }
}
