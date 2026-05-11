import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'

const VALID_WIKI_NAME = /^[a-z0-9][a-z0-9_-]*$/

export class WikiManagementService {
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
    if (!name || !VALID_WIKI_NAME.test(name)) {
      return { error: 'Wiki name must contain only lowercase letters, numbers, dashes, and underscores.' }
    }

    const dataDir = this.config.getDataDir()
    const wikiDir = path.join(dataDir, name, 'docs')

    if (fs.existsSync(wikiDir)) {
      return { error: `Wiki "${name}" already exists.` }
    }

    fs.mkdirSync(wikiDir, { recursive: true })
    return { name }
  }

  delete(name: string): { deleted: string } | { error: string } {
    const dataDir = this.config.getDataDir()
    const wikiDir = path.join(dataDir, name)

    if (!fs.existsSync(path.join(wikiDir, 'docs'))) {
      return { error: `Wiki "${name}" does not exist.` }
    }

    fs.rmSync(wikiDir, { recursive: true, force: true })
    return { deleted: name }
  }

  exists(name: string): boolean {
    const dataDir = this.config.getDataDir()
    return fs.existsSync(path.join(dataDir, name, 'docs'))
  }
}
