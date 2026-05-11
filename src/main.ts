import { CliApp, Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { KbController } from './controllers/kb.controller.js'
import { ConfigController } from './controllers/config.controller.js'
import { ReadController } from './controllers/read.controller.js'
import { DocController } from './controllers/doc.controller.js'
import { SearchController } from './controllers/search.controller.js'
import { LintController } from './controllers/lint.controller.js'
import { SkillController } from './controllers/skill.controller.js'
import { SetupController } from './controllers/setup.controller.js'
import { startServer } from './api/serve.js'

@Controller()
class AppController {
  @Cli('')
  @Description('Show help')
  root() {
    const lines = [
      'AI Memory - Knowledge base CLI for AI agents',
      '',
      'Usage: aimem <command> [options]',
      '',
      'Commands:',
      '  search <query>     Search documents (hybrid semantic + keyword)',
      '  read <file>        Read a document (--lines, --meta, --links, --follow)',
      '  add                Add a new document',
      '  update <id>        Update a document',
      '  delete <id>        Delete a document',
      '  rename <old> <new> Rename and update links',
      '  list               List documents (--category, --tag)',
      '  categories         List categories in use',
      '  related <id>       Find related documents',
      '  lint               Check KB integrity (--fix)',
      '  reindex            Rebuild index from files',
      '  toc                Show table of contents',
      '  log                Show recent activity log',
      '  kb <cmd>           Manage knowledge bases (create/list/info/delete/use)',
      '  config <cmd>       Manage configuration (get/set/list)',
      '  skill [workflow]   Show agent instructions',
      '  setup              Install agent integrations',
      '  serve              Start HTTP API server (--port, -p)',
      '  version            Show version',
      '',
      'Global options:',
      '  --kb <name>        Target knowledge base (default: from aimem.config.json or "default")',
      '  --format json      Machine-readable output',
      '  --help             Show help for a command',
    ]
    return lines.join('\n')
  }

  @Cli('version')
  @Description('Show version')
  version() {
    return '0.1.0'
  }

  @Cli('serve')
  @Description('Start HTTP API server')
  async serve(
    @Description('Port number') @CliOption('port', 'p') @Optional() port: string,
  ) {
    const p = port ? parseInt(port, 10) : 4141
    await startServer(p)
    // Keep process alive — the HTTP server keeps the event loop running,
    // but moostjs CLI might exit after handler returns
    await new Promise(() => {})
  }
}

new CliApp()
  .controllers(AppController, KbController, ConfigController, ReadController, DocController, SearchController, LintController, SkillController, SetupController)
  .useHelp({ name: 'aimem', title: 'AI Memory - Knowledge base CLI for AI agents' })
  .useOptions([{ keys: ['help'], description: 'Display instructions.' }])
  .start()
