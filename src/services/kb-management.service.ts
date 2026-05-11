import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'

const VALID_KB_NAME = /^[a-z0-9][a-z0-9_-]*$/

export class KbManagementService {
  constructor(private config: ConfigService) {}

  list(): string[] {
    const dataDir = this.config.getDataDir()
    if (!fs.existsSync(dataDir)) return []

    const entries = fs.readdirSync(dataDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(dataDir, e.name, 'docs')))
      .map((e) => e.name)
  }

  create(name: string): { name: string } | { error: string } {
    if (!name || !VALID_KB_NAME.test(name)) {
      return { error: 'KB name must contain only lowercase letters, numbers, dashes, and underscores.' }
    }

    const dataDir = this.config.getDataDir()
    const kbDir = path.join(dataDir, name, 'docs')

    if (fs.existsSync(kbDir)) {
      return { error: `Knowledge base "${name}" already exists.` }
    }

    fs.mkdirSync(kbDir, { recursive: true })
    return { name }
  }

  delete(name: string): { deleted: string } | { error: string } {
    const dataDir = this.config.getDataDir()
    const kbDir = path.join(dataDir, name)

    if (!fs.existsSync(path.join(kbDir, 'docs'))) {
      return { error: `Knowledge base "${name}" does not exist.` }
    }

    fs.rmSync(kbDir, { recursive: true, force: true })
    return { deleted: name }
  }

  exists(name: string): boolean {
    const dataDir = this.config.getDataDir()
    return fs.existsSync(path.join(dataDir, name, 'docs'))
  }
}
