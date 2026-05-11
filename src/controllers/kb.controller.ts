import * as fs from 'node:fs'
import * as path from 'node:path'
import { Controller, Cli, Param, CliOption, Description } from '@moostjs/event-cli'
import { services } from '../services/container.js'

@Controller('kb')
export class KbController {
  private get config() { return services.config }
  private get kbMgmt() { return services.kbManagement }

  @Cli('create/:name')
  @Description('Create a new knowledge base')
  create(@Param('name') name: string) {
    const result = this.kbMgmt.create(name)
    if ('error' in result) return `Error: ${result.error}`
    return `Created knowledge base "${name}".`
  }

  @Cli('use/:name')
  @Description('Set the default knowledge base')
  use(@Param('name') name: string) {
    if (!this.kbMgmt.exists(name)) {
      return `Error: Knowledge base "${name}" does not exist. Run \`aimem kb create ${name}\` first.`
    }
    this.config.set('defaultKb', name)
    return `Default knowledge base set to "${name}".`
  }

  @Cli('list')
  @Description('List all knowledge bases')
  list() {
    const kbs = this.kbMgmt.list()
    if (kbs.length === 0) {
      return 'No knowledge bases found.'
    }

    const dataDir = this.config.getDataDir()
    const lines = ['Name         | Docs | DB Size  | Docs Size', '-------------|------|----------|----------']

    for (const name of kbs) {
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
  @Description('Delete a knowledge base')
  delete(
    @Param('name') name: string,
    @CliOption('force', 'f')
    @Description('Force delete even for default KB')
    force?: boolean,
  ) {
    if (name === 'default' && !force) {
      return 'Error: Cannot delete the "default" KB without --force flag.'
    }

    const result = this.kbMgmt.delete(name)
    if ('error' in result) return `Error: ${result.error}`
    return `Deleted knowledge base "${name}".`
  }

  @Cli('info/:name')
  @Description('Show info about a knowledge base')
  info(@Param('name') name: string) {
    if (!this.kbMgmt.exists(name)) {
      return `Error: Knowledge base "${name}" does not exist.`
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
      `Knowledge base: ${name}`,
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
