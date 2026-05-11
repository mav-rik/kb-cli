import { Controller, Cli, Description } from '@moostjs/event-cli'
import { readContent } from '../utils/content.js'

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
