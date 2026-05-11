import * as fs from 'node:fs'
import * as path from 'node:path'
import { Controller, Cli, Param, CliOption, Description } from '@moostjs/event-cli'
import { services } from '../services/container.js'

@Controller('kb')
export class KbController {
  private get config() { return services.config }

  @Cli('create/:name')
  @Description('Create a new knowledge base')
  create(@Param('name') name: string) {
    const dataDir = this.config.getDataDir()
    const kbDir = path.join(dataDir, name, 'docs')

    if (fs.existsSync(kbDir)) {
      return `Error: Knowledge base "${name}" already exists.`
    }

    fs.mkdirSync(kbDir, { recursive: true })
    return `Created knowledge base "${name}".`
  }

  @Cli('list')
  @Description('List all knowledge bases')
  list() {
    const dataDir = this.config.getDataDir()

    if (!fs.existsSync(dataDir)) {
      return 'No knowledge bases found.'
    }

    const entries = fs.readdirSync(dataDir, { withFileTypes: true })
    const kbs = entries
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dataDir, e.name, 'docs')))
      .map((e) => e.name)

    if (kbs.length === 0) {
      return 'No knowledge bases found.'
    }

    return kbs.join('\n')
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

    const dataDir = this.config.getDataDir()
    const kbDir = path.join(dataDir, name)

    if (!fs.existsSync(path.join(kbDir, 'docs'))) {
      return `Error: Knowledge base "${name}" does not exist.`
    }

    fs.rmSync(kbDir, { recursive: true, force: true })
    return `Deleted knowledge base "${name}".`
  }

  @Cli('info/:name')
  @Description('Show info about a knowledge base')
  info(@Param('name') name: string) {
    const dataDir = this.config.getDataDir()
    const docsDir = path.join(dataDir, name, 'docs')

    if (!fs.existsSync(docsDir)) {
      return `Error: Knowledge base "${name}" does not exist.`
    }

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
