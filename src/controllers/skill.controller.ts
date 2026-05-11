import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Controller, Cli, Param, Description, Optional } from '@moostjs/event-cli'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const contentDir = path.resolve(__dirname, '..', 'content')

function readContent(name: string): string {
  const filePath = path.join(contentDir, name)
  if (!fs.existsSync(filePath)) {
    return `Error: Content file "${name}" not found at ${filePath}.`
  }
  return fs.readFileSync(filePath, 'utf-8')
}

@Controller('skill')
export class SkillController {
  @Cli('')
  @Description('Show full agent instructions')
  full() {
    return readContent('skill.md')
  }

  @Cli('ingest')
  @Description('Show ingestion workflow for agents')
  ingest() {
    return readContent('skill-ingest.md')
  }

  @Cli('search')
  @Description('Show search workflow for agents')
  search() {
    return readContent('skill-search.md')
  }

  @Cli('update')
  @Description('Show update workflow for agents')
  update() {
    return readContent('skill-update.md')
  }

  @Cli('lint')
  @Description('Show lint/maintenance workflow for agents')
  lint() {
    return readContent('skill-lint.md')
  }
}
