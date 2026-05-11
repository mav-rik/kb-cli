import * as fs from 'node:fs'
import * as path from 'node:path'
import { Controller, Cli, Param, CliOption, Description } from '@moostjs/event-cli'
import { services } from '../services/container.js'

@Controller('wiki')
export class WikiController {
  private get config() { return services.config }
  private get wikiMgmt() { return services.wikiManagement }

  @Cli('create/:name')
  @Description('Create a new wiki')
  create(@Param('name') name: string) {
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
    if (wikis.length === 0) {
      return 'No wikis found.'
    }

    const dataDir = this.config.getDataDir()
    const lines = ['Name         | Docs | DB Size  | Docs Size', '-------------|------|----------|----------']

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

      lines.push(`${name.padEnd(12)} | ${String(docCount).padStart(4)} | ${formatBytes(dbSize).padStart(8)} | ${formatBytes(docsSize)}`)
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
  info(@Param('name') name: string) {
    if (!this.wikiMgmt.exists(name)) {
      return `Error: Wiki "${name}" does not exist.`
    }

    const dataDir = this.config.getDataDir()
    const docsDir = path.join(dataDir, name, 'docs')

    const files = fs.readdirSync(docsDir)
    let totalSize = 0
    let lastModified = new Date(0)
    let fileCount = 0

    for (const file of files) {
      const filePath = path.join(docsDir, file)
      const stat = fs.statSync(filePath)
      if (stat.isFile()) {
        fileCount++
        totalSize += stat.size
        if (stat.mtime > lastModified) {
          lastModified = stat.mtime
        }
      }
    }

    const lines = [
      `Wiki: ${name}`,
      `Documents: ${fileCount}`,
      `Total size: ${formatBytes(totalSize)}`,
      `Last modified: ${fileCount > 0 ? lastModified.toISOString() : 'N/A'}`,
    ]

    return lines.join('\n')
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}
