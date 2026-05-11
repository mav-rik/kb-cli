import Database from 'better-sqlite3'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'

export interface LogEntry {
  timestamp: string
  operation: string
  docId?: string
  details?: string
}

export class ActivityLogService {
  private connections: Map<string, Database.Database> = new Map()

  constructor(private config: ConfigService) {}

  private getDb(kb: string): Database.Database {
    const existing = this.connections.get(kb)
    if (existing) return existing

    const dbPath = path.join(this.config.getDataDir(), kb, 'index.db')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        operation TEXT NOT NULL,
        doc_id TEXT,
        details TEXT
      )
    `)
    this.connections.set(kb, db)
    return db
  }

  log(kb: string, operation: string, docId?: string, details?: string): void {
    const db = this.getDb(kb)
    db.prepare(
      `INSERT INTO activity_log (operation, doc_id, details) VALUES (?, ?, ?)`
    ).run(operation, docId || null, details || null)
  }

  recent(kb: string, limit: number = 20): LogEntry[] {
    const db = this.getDb(kb)
    return db.prepare(`
      SELECT timestamp, operation, doc_id as docId, details
      FROM activity_log
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as LogEntry[]
  }
}
