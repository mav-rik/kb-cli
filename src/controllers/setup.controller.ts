import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const setupDir = path.resolve(__dirname, '..', 'content', 'setup')

interface AgentConfig {
  id: string
  name: string
  install: (cwd: string) => string[]
}

const AGENTS: AgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    install: (cwd: string) => {
      const msgs: string[] = []
      const skillDir = path.join(cwd, '.claude', 'skills', 'aimem')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'claude-skill.md'), path.join(skillDir, 'aimem.md'))
      msgs.push(`  .claude/skills/aimem/aimem.md`)

      const cmdDir = path.join(cwd, '.claude', 'commands')
      fs.mkdirSync(cmdDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'claude-cmd-ingest.md'), path.join(cmdDir, 'aimem-ingest.md'))
      fs.copyFileSync(path.join(setupDir, 'claude-cmd-search.md'), path.join(cmdDir, 'aimem-search.md'))
      fs.copyFileSync(path.join(setupDir, 'claude-cmd-lint.md'), path.join(cmdDir, 'aimem-lint.md'))
      msgs.push(`  .claude/commands/aimem-ingest.md`)
      msgs.push(`  .claude/commands/aimem-search.md`)
      msgs.push(`  .claude/commands/aimem-lint.md`)
      return msgs
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    install: (cwd: string) => {
      const rulesDir = path.join(cwd, '.cursor', 'rules')
      fs.mkdirSync(rulesDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'cursor-rules.md'), path.join(rulesDir, 'aimem.mdc'))
      return [`  .cursor/rules/aimem.mdc`]
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    install: (cwd: string) => {
      const content = fs.readFileSync(path.join(setupDir, 'codex-agents.md'), 'utf-8')
      const agentsPath = path.join(cwd, 'AGENTS.md')
      if (fs.existsSync(agentsPath)) {
        const existing = fs.readFileSync(agentsPath, 'utf-8')
        if (existing.includes('aimem')) {
          return [`  AGENTS.md already contains aimem (skipped)`]
        }
        fs.appendFileSync(agentsPath, '\n\n' + content)
      } else {
        fs.writeFileSync(agentsPath, content)
      }
      return [`  AGENTS.md`]
    },
  },
  {
    id: 'cline',
    name: 'Cline',
    install: (cwd: string) => {
      const content = fs.readFileSync(path.join(setupDir, 'generic-rules.md'), 'utf-8')
      const rulesPath = path.join(cwd, '.clinerules')
      if (fs.existsSync(rulesPath)) {
        const existing = fs.readFileSync(rulesPath, 'utf-8')
        if (existing.includes('aimem')) {
          return [`  .clinerules already contains aimem (skipped)`]
        }
        fs.appendFileSync(rulesPath, '\n\n' + content)
      } else {
        fs.writeFileSync(rulesPath, content)
      }
      return [`  .clinerules`]
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    install: (cwd: string) => {
      const content = fs.readFileSync(path.join(setupDir, 'generic-rules.md'), 'utf-8')
      const rulesPath = path.join(cwd, '.windsurfrules')
      if (fs.existsSync(rulesPath)) {
        const existing = fs.readFileSync(rulesPath, 'utf-8')
        if (existing.includes('aimem')) {
          return [`  .windsurfrules already contains aimem (skipped)`]
        }
        fs.appendFileSync(rulesPath, '\n\n' + content)
      } else {
        fs.writeFileSync(rulesPath, content)
      }
      return [`  .windsurfrules`]
    },
  },
  {
    id: 'continue',
    name: 'Continue.dev',
    install: (cwd: string) => {
      const rulesDir = path.join(cwd, '.continue', 'rules')
      fs.mkdirSync(rulesDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'generic-rules.md'), path.join(rulesDir, 'aimem.md'))
      return [`  .continue/rules/aimem.md`]
    },
  },
]

@Controller()
export class SetupController {
  private get config() { return services.config }

  @Cli('setup')
  @Description('Set up aimem integration for AI agents in current directory')
  setup(
    @Description('Agents to install (comma-separated: claude,cursor,codex,cline,windsurf,continue)')
    @CliOption('agents', 'a') @Optional() agents: string,
    @Description('Install for all supported agents')
    @CliOption('all') all: boolean,
  ): string {
    const cwd = process.cwd()
    const output: string[] = []

    // Determine which agents to install
    let toInstall: AgentConfig[]
    if (all) {
      toInstall = AGENTS
    } else if (agents) {
      const ids = agents.split(',').map((s) => s.trim().toLowerCase())
      toInstall = AGENTS.filter((a) => ids.includes(a.id))
      const unknown = ids.filter((id) => !AGENTS.find((a) => a.id === id))
      if (unknown.length > 0) {
        output.push(`Warning: Unknown agents: ${unknown.join(', ')}`)
      }
    } else {
      output.push('aimem setup — Install AI agent integrations')
      output.push('')
      output.push('Usage:')
      output.push('  aimem setup --agents claude,cursor    # specific agents')
      output.push('  aimem setup --all                     # all agents')
      output.push('')
      output.push('Supported agents:')
      for (const agent of AGENTS) {
        output.push(`  ${agent.id.padEnd(10)} — ${agent.name}`)
      }
      output.push('')
      output.push('Example: aimem setup --agents claude')
      return output.join('\n')
    }

    if (toInstall.length === 0) {
      return 'No valid agents specified.'
    }

    output.push('Installing aimem integrations...')
    output.push('')

    for (const agent of toInstall) {
      output.push(`${agent.name}:`)
      const msgs = agent.install(cwd)
      output.push(...msgs)
      output.push('')
    }

    // Create aimem.config.json if not exists
    const configPath = path.join(cwd, 'aimem.config.json')
    if (!fs.existsSync(configPath)) {
      const defaultKb = this.config.get('defaultKb')
      fs.writeFileSync(configPath, JSON.stringify({ kb: defaultKb }, null, 2) + '\n')
      output.push(`Created aimem.config.json (kb: "${defaultKb}")`)
    }

    output.push('Done! Agents can now use `aimem` commands.')
    return output.join('\n')
  }
}
