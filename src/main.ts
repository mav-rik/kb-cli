import { CliApp, Controller, Cli, Description } from '@moostjs/event-cli'
import { KbController } from './controllers/kb.controller.js'
import { ConfigController } from './controllers/config.controller.js'
import { ReadController } from './controllers/read.controller.js'
import { DocController } from './controllers/doc.controller.js'
import { SearchController } from './controllers/search.controller.js'
import { LintController } from './controllers/lint.controller.js'

@Controller()
class AppController {
  @Cli('version')
  @Description('Show version')
  version() {
    return '0.1.0'
  }
}

new CliApp()
  .controllers(AppController, KbController, ConfigController, ReadController, DocController, SearchController, LintController)
  .useHelp({ name: 'aimem', title: 'AI Memory - Knowledge base CLI for AI agents' })
  .useOptions([{ keys: ['help'], description: 'Display instructions.' }])
  .start()
