import * as fs from 'node:fs'
import * as path from 'node:path'
import { Controller, Cli, Param, CliOption, Description } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { WikiName } from '../models/api-bodies.as'
import { validateAgainstDto } from '../utils/dto-validate.js'

@Controller('wiki')
export class WikiController {
  private get config() { return services.config }
  private get wikiMgmt() { return services.wikiManagement }
  private get gateway() { return services.gateway }

  private get remoteConfig() { return services.remoteConfig }

  @Cli('create/:name')
  @Description('Create a new wiki')
  create(@Param('name') name: string) {
    // Same atscript constraints as POST /api/wiki -> body.name. Single
    // source of truth for "valid wiki name" across CLI and HTTP.
    const validationErr = validateAgainstDto(WikiName, name)
    if (validationErr) return `Error: invalid wiki name "${name}": ${validationErr}`
    const result = this.wikiMgmt.create(name)
    if ('error' in result) return `Error: ${result.error}`
    return `Created wiki "${name}".`
  }

  @Cli('use/:name')
  @Description('Set the default wiki')
  use(@Param('name') name: string) {
    if (!this.wikiMgmt.exists(name)) {
      return `Error: Wiki "${name}" does not exist. Run \`kb wiki create ${name}\` first.`
    }
    this.config.set('defaultWiki', name)
    return `Default wiki set to "${name}".`
  }

  @Cli('list')
  @Description('List all wikis')
  list() {
    const wikis = this.wikiMgmt.list()
    const lines: string[] = []

    if (wikis.length > 0) {
      const dataDir = this.config.getDataDir()
      // Resolve through the same chain commands use: explicit flag → kb.config.json
      // in cwd → global defaultWiki. wiki list has no --wiki arg, so it surfaces
      // whichever default would actually be picked up by `kb search`, `kb add`, etc.
      const effectiveDefault = this.config.resolveWikiName()
      lines.push('Local wikis:')
      lines.push('  Name         | Docs | DB Size  | Docs Size')
      lines.push('  -------------|------|----------|----------')

      for (const name of wikis) {
        const docsDir = path.join(dataDir, name, 'docs')
        const dbPath = path.join(dataDir, name, 'index.db')

        let docCount = 0
        let docsSize = 0
        if (fs.existsSync(docsDir)) {
          const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'))
          docCount = files.length
          for (const f of files) {
            docsSize += fs.statSync(path.join(docsDir, f)).size
          }
        }

        const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0
        const marker = name === effectiveDefault ? '* ' : '  '
        lines.push(`${marker}${name.padEnd(12)} | ${String(docCount).padStart(4)} | ${formatBytes(dbSize).padStart(8)} | ${formatBytes(docsSize)}`)
      }
      if (wikis.includes(effectiveDefault)) {
        const source = this.config.defaultWikiSource() === 'cwd'
          ? 'kb.config.json in this directory'
          : 'global config'
        lines.push(`(* = default — from ${source})`)
      }
    }

    const remotes = this.remoteConfig.listRemotes()
    const allAttached: { localName: string; remoteName: string; wikiName: string }[] = []
    const config = this.remoteConfig.load()
    for (const [remoteName, remote] of Object.entries(config.remotes)) {
      for (const [wikiName, entry] of Object.entries(remote.attachedWikis)) {
        allAttached.push({ localName: entry.alias || wikiName, remoteName, wikiName })
      }
    }

    if (allAttached.length > 0) {
      if (lines.length > 0) lines.push('')
      lines.push('Remote wikis:')
      lines.push('Local Name   | Remote KB    | Wiki Name')
      lines.push('-------------|-------------|----------')
      for (const a of allAttached) {
        lines.push(`${a.localName.padEnd(12)} | ${a.remoteName.padEnd(11)} | ${a.wikiName}`)
      }
    }

    if (lines.length === 0) {
      return 'No wikis found.'
    }

    return lines.join('\n')
  }

  @Cli('delete/:name')
  @Description('Delete a wiki')
  delete(
    @Param('name') name: string,
    @CliOption('force', 'f')
    @Description('Force delete even for default wiki')
    force?: boolean,
  ) {
    if (name === 'default' && !force) {
      return 'Error: Cannot delete the "default" wiki without --force flag.'
    }

    const result = this.wikiMgmt.delete(name)
    if ('error' in result) return `Error: ${result.error}`
    return `Deleted wiki "${name}".`
  }

  @Cli('info/:name')
  @Description('Show info about a wiki')
  async info(@Param('name') name: string): Promise<string> {
    const ref = this.config.resolveWiki(name)
    if (ref.type === 'local' && !this.wikiMgmt.exists(ref.name)) {
      return `Error: Wiki "${name}" does not exist.`
    }
    const ops = this.gateway.getOps(ref)
    try {
      const info = await ops.info()
      const where = ref.type === 'remote' ? ` (remote: ${ref.remoteKb}/${ref.name})` : ''
      const lines = [
        `Wiki: ${name}${where}`,
        `Documents: ${info.docCount}`,
        `Total size: ${formatBytes(info.sizeBytes)}`,
        `Last modified: ${info.lastUpdated ?? 'N/A'}`,
      ]
      return lines.join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}
