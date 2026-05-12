import { CliApp, Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { WikiController } from './controllers/wiki.controller.js'
import { ConfigController } from './controllers/config.controller.js'
import { ReadController } from './controllers/read.controller.js'
import { DocController } from './controllers/doc.controller.js'
import { SearchController } from './controllers/search.controller.js'
import { LintController } from './controllers/lint.controller.js'
import { SkillController } from './controllers/skill.controller.js'
import { SetupController } from './controllers/setup.controller.js'
import { RemoteController } from './controllers/remote.controller.js'
import { startServer } from './api/serve.js'

@Controller()
class AppController {
  @Cli('')
  @Description('Show help')
  root() {
    const lines = [
      'kb — Wiki CLI for AI agents',
      '',
      'Usage: kb <command> [options]',
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
      '  lint               Check wiki integrity (--fix)',
      '  reindex            Rebuild index from files',
      '  toc                Show table of contents',
      '  log                Show recent activity log',
      '  log add            Record a manual log entry (agent sessions)',
      '  schema             Show wiki schema (structure, conventions)',
      '  schema update      Regenerate schema from current state',
      '  wiki <cmd>         Manage wikis (create/list/info/delete/use)',
      '  remote <cmd>       Manage remote KBs (add/remove/list/connect/attach)',
      '  config <cmd>       Manage configuration (get/set/list)',
      '  skill [workflow]   Show agent instructions',
      '  setup              Install agent integrations',
      '  serve              Start HTTP API server (--port, -p)',
      '  version            Show version',
      '',
      'Global options:',
      '  --wiki, -w <name>  Target wiki (default: from kb.config.json or "default")',
      '  --format json      Machine-readable output',
      '  --help             Show help for a command',
    ]
    return lines.join('\n')
  }

  @Cli('version')
  @Description('Show version')
  version() {
    return '0.1.2'
  }

  @Cli('serve')
  @Description('Start HTTP API server')
  async serve(
    @Description('Port number') @CliOption('port', 'p') @Optional() port: string,
    @Description('Shared secret for access control') @CliOption('secret') @Optional() secret: string,
  ) {
    const p = port ? parseInt(port, 10) : 4141
    await startServer(p, secret || undefined)
    await new Promise(() => {})
  }
}

new CliApp()
  .controllers(AppController, WikiController, ConfigController, ReadController, DocController, SearchController, LintController, SkillController, SetupController, RemoteController)
  .useHelp({ name: 'kb', title: 'kb — Wiki CLI for AI agents' })
  .useOptions([{ keys: ['help'], description: 'Display instructions.' }])
  .start()
