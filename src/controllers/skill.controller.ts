import { Controller, Cli, Description } from '@moostjs/event-cli'
import { readContent } from '../utils/content.js'

@Controller('skill')
export class SkillController {
  @Cli('')
  @Description('Print the full agent-facing skill manual: overview of the CLI, conventions, and pointers to every workflow doc. Start here when you do not know what you need.')
  full() {
    return readContent('skill.md')
  }

  @Cli('ingest')
  @Description('Print the ingestion workflow: how to search-before-add, how to use --dry-run, how to interpret retrievability warnings, when to update vs add new. Run this BEFORE adding any doc.')
  ingest() {
    return readContent('skill-ingest.md')
  }

  @Cli('search')
  @Description('Print the search workflow: choosing modes (hybrid vs fts vs vec), interpreting chunk results, when to use `kb related`, how to assemble context efficiently.')
  search() {
    return readContent('skill-search.md')
  }

  @Cli('update')
  @Description('Print the update workflow: how to update vs rename vs delete, how to preserve cross-links, when to use --append vs --content, post-update verification.')
  update() {
    return readContent('skill-update.md')
  }

  @Cli('lint')
  @Description('Print the maintenance workflow: when to run lint, how to interpret each issue type, what --fix does (and does not) repair, hand-fixes for retrievability warnings.')
  lint() {
    return readContent('skill-lint.md')
  }
}
