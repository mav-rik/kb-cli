import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ConfigService } from './config.service.js'

export interface LocalServerInfo {
  port: number
  pid: number
  secret: string | null
  startedAt: string // ISO
  embeddingModel: string // informational; not used for routing decisions
}

const PING_TIMEOUT_MS = 200

export class LocalServerService {
  private cache: LocalServerInfo | null = null

  constructor(private config: ConfigService) {}

  /** Cheap synchronous probe — just "is the tempfile there?". Used during
   *  shutdown polling where the cost of a full HTTP ping is overkill. */
  fileExists(): boolean {
    return fs.existsSync(this.getServeFilePath())
  }

  /** Path of the tempfile recording the running server's coordinates. */
  private getServeFilePath(): string {
    return path.join(this.config.getDataDir(), '.serve.json')
  }

  /**
   * Async detect: file exists + pid alive + HTTP ping returns 2xx within 200ms.
   * Caches the result. Call refresh() again to re-detect.
   */
  async refresh(): Promise<LocalServerInfo | null> {
    const filePath = this.getServeFilePath()

    // 1) File presence
    if (!fs.existsSync(filePath)) {
      this.cache = null
      return null
    }

    // 2) Parse JSON
    let info: LocalServerInfo
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      info = JSON.parse(raw)
      if (
        typeof info.port !== 'number' ||
        typeof info.pid !== 'number' ||
        typeof info.startedAt !== 'string'
      ) {
        throw new Error('malformed serve.json')
      }
    } catch {
      this.unlinkBestEffort(filePath)
      this.cache = null
      return null
    }

    // 3) Is the PID alive?
    if (!isPidAlive(info.pid)) {
      this.unlinkBestEffort(filePath)
      this.cache = null
      return null
    }

    // 4) Ping the HTTP endpoint with a tight timeout.
    const reachable = await this.pingServer(info)
    if (!reachable) {
      // Do NOT delete the file — could be a transient hiccup.
      this.cache = null
      return null
    }

    this.cache = info
    return info
  }

  /** Synchronous read of last refresh() result. */
  getCached(): LocalServerInfo | null {
    return this.cache
  }

  /** Server-side: write the tempfile (mode 0600). */
  write(info: LocalServerInfo): void {
    const filePath = this.getServeFilePath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(info, null, 2), { mode: 0o600 })
    // Ensure mode is applied even if the file pre-existed.
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // best-effort
    }
    this.cache = info
  }

  /** Server-side: remove the tempfile. Best-effort (may already be gone). */
  clear(): void {
    this.unlinkBestEffort(this.getServeFilePath())
    this.cache = null
  }

  private unlinkBestEffort(filePath: string): void {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // best-effort
    }
  }

  private async pingServer(info: LocalServerInfo): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
    try {
      const headers: Record<string, string> = {}
      if (info.secret) headers['Authorization'] = `Bearer ${info.secret}`
      const res = await fetch(`http://localhost:${info.port}/api`, {
        signal: controller.signal,
        headers,
      })
      return res.status >= 200 && res.status < 300
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Returns true if a signal can be sent to `pid` (process exists).
 *
 * `process.kill(pid, 0)` throws:
 *   - ESRCH → no such process (dead)
 *   - EPERM → process exists but we can't signal it (alive)
 * Any other error → treat as dead.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPERM') return true
    return false
  }
}
