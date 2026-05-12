import * as fs from 'node:fs'
import * as path from 'node:path'

export interface AttachedWiki {
  alias: string | null
}

export interface RemoteKbEntry {
  url: string
  secret?: string
  attachedWikis: Record<string, AttachedWiki>
}

export interface RemotesConfig {
  remotes: Record<string, RemoteKbEntry>
}

export class RemoteConfigService {
  private configPath: string
  private cached: RemotesConfig | null = null

  constructor(dataDir: string) {
    this.configPath = path.join(dataDir, 'remotes.json')
  }

  load(): RemotesConfig {
    if (this.cached) return this.cached
    if (!fs.existsSync(this.configPath)) {
      this.cached = { remotes: {} }
      return this.cached
    }
    this.cached = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))
    return this.cached!
  }

  save(config: RemotesConfig): void {
    const dir = path.dirname(this.configPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
    this.cached = config
  }

  addRemote(name: string, url: string, secret?: string): void {
    const config = this.load()
    config.remotes[name] = { url, secret, attachedWikis: {} }
    this.save(config)
  }

  removeRemote(name: string): void {
    const config = this.load()
    delete config.remotes[name]
    this.save(config)
  }

  listRemotes(): { name: string; url: string; wikiCount: number }[] {
    const config = this.load()
    return Object.entries(config.remotes).map(([name, entry]) => ({
      name,
      url: entry.url,
      wikiCount: Object.keys(entry.attachedWikis).length,
    }))
  }

  getRemote(name: string): RemoteKbEntry | null {
    const config = this.load()
    return config.remotes[name] || null
  }

  attachWiki(remoteName: string, wikiName: string, alias?: string): { error?: string } {
    const config = this.load()
    const remote = config.remotes[remoteName]
    if (!remote) return { error: `Remote "${remoteName}" not found.` }

    const localName = alias || wikiName
    for (const [rName, rEntry] of Object.entries(config.remotes)) {
      for (const [wName, wEntry] of Object.entries(rEntry.attachedWikis)) {
        const existingLocal = wEntry.alias || wName
        if (existingLocal === localName && !(rName === remoteName && wName === wikiName)) {
          return { error: `Name "${localName}" already used by ${rName}/${wName}.` }
        }
      }
    }

    remote.attachedWikis[wikiName] = { alias: alias || null }
    this.save(config)
    return {}
  }

  detachWiki(localName: string): { error?: string } {
    const config = this.load()
    for (const remote of Object.values(config.remotes)) {
      for (const [wikiName, entry] of Object.entries(remote.attachedWikis)) {
        const effectiveName = entry.alias || wikiName
        if (effectiveName === localName) {
          delete remote.attachedWikis[wikiName]
          this.save(config)
          return {}
        }
      }
    }
    return { error: `No attached wiki found with name "${localName}".` }
  }

  resolveRemoteWiki(localName: string): { remoteName: string; wikiName: string; url: string; secret?: string } | null {
    const config = this.load()
    for (const [remoteName, remote] of Object.entries(config.remotes)) {
      for (const [wikiName, entry] of Object.entries(remote.attachedWikis)) {
        const effectiveName = entry.alias || wikiName
        if (effectiveName === localName) {
          return { remoteName, wikiName, url: remote.url, secret: remote.secret }
        }
      }
    }
    return null
  }

  getAllAttachedNames(): string[] {
    const config = this.load()
    const names: string[] = []
    for (const remote of Object.values(config.remotes)) {
      for (const [wikiName, entry] of Object.entries(remote.attachedWikis)) {
        names.push(entry.alias || wikiName)
      }
    }
    return names
  }
}
