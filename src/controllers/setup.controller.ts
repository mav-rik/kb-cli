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

function appendOrCreate(filePath: string, content: string, label: string): string[] {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8')
    if (existing.includes('kb')) {
      return [`  ${label} already contains kb (skipped)`]
    }
    fs.appendFileSync(filePath, '\n\n' + content)
  } else {
    fs.writeFileSync(filePath, content)
  }
  return [`  ${label}`]
}

const AGENTS: AgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    install: (cwd: string) => {
      const msgs: string[] = []
      const skillDir = path.join(cwd, '.claude', 'skills', 'kb')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'claude-skill.md'), path.join(skillDir, 'kb.md'))
      msgs.push(`  .claude/skills/kb/kb.md`)

      const cmdDir = path.join(cwd, '.claude', 'commands')
      fs.mkdirSync(cmdDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'claude-cmd-ingest.md'), path.join(cmdDir, 'kb-ingest.md'))
      fs.copyFileSync(path.join(setupDir, 'claude-cmd-search.md'), path.join(cmdDir, 'kb-search.md'))
      fs.copyFileSync(path.join(setupDir, 'claude-cmd-lint.md'), path.join(cmdDir, 'kb-lint.md'))
      msgs.push(`  .claude/commands/kb-ingest.md`)
      msgs.push(`  .claude/commands/kb-search.md`)
      msgs.push(`  .claude/commands/kb-lint.md`)
      return msgs
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    install: (cwd: string) => {
      const rulesDir = path.join(cwd, '.cursor', 'rules')
      fs.mkdirSync(rulesDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'cursor-rules.md'), path.join(rulesDir, 'kb.mdc'))
      return [`  .cursor/rules/kb.mdc`]
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    install: (cwd: string) => {
      const content = fs.readFileSync(path.join(setupDir, 'codex-agents.md'), 'utf-8')
      return appendOrCreate(path.join(cwd, 'AGENTS.md'), content, 'AGENTS.md')
    },
  },
  {
    id: 'cline',
    name: 'Cline',
    install: (cwd: string) => {
      const content = fs.readFileSync(path.join(setupDir, 'generic-rules.md'), 'utf-8')
      return appendOrCreate(path.join(cwd, '.clinerules'), content, '.clinerules')
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    install: (cwd: string) => {
      const content = fs.readFileSync(path.join(setupDir, 'generic-rules.md'), 'utf-8')
      return appendOrCreate(path.join(cwd, '.windsurfrules'), content, '.windsurfrules')
    },
  },
  {
    id: 'continue',
    name: 'Continue.dev',
    install: (cwd: string) => {
      const rulesDir = path.join(cwd, '.continue', 'rules')
      fs.mkdirSync(rulesDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'generic-rules.md'), path.join(rulesDir, 'kb.md'))
      return [`  .continue/rules/kb.md`]
    },
  },
]

@Controller()
export class SetupController {
  private get config() { return services.config }

  @Cli('setup')
  @Description('Set up kb integration for AI agents in current directory')
  setup(
    @Description('Agents to install (comma-separated: claude,cursor,codex,cline,windsurf,continue)')
    @CliOption('agents', 'a') @Optional() agents: string,
    @Description('Install for all supported agents')
    @CliOption('all') all: boolean,
  ): string {
    const cwd = process.cwd()
    const output: string[] = []

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
      output.push('kb setup — Install AI agent integrations')
      output.push('')
      output.push('Usage:')
      output.push('  kb setup --agents claude,cursor    # specific agents')
      output.push('  kb setup --all                     # all agents')
      output.push('')
      output.push('Supported agents:')
      for (const agent of AGENTS) {
        output.push(`  ${agent.id.padEnd(10)} — ${agent.name}`)
      }
      output.push('')
      output.push('Example: kb setup --agents claude')
      return output.join('\n')
    }

    if (toInstall.length === 0) {
      return 'No valid agents specified.'
    }

    output.push('Installing kb integrations...')
    output.push('')

    for (const agent of toInstall) {
      output.push(`${agent.name}:`)
      const msgs = agent.install(cwd)
      output.push(...msgs)
      output.push('')
    }

    const configPath = path.join(cwd, 'kb.config.json')
    if (!fs.existsSync(configPath)) {
      const defaultWiki = this.config.get('defaultWiki')
      fs.writeFileSync(configPath, JSON.stringify({ wiki: defaultWiki }, null, 2) + '\n')
      output.push(`Created kb.config.json (wiki: "${defaultWiki}")`)
    }

    output.push('Done! Agents can now use `kb` commands.')
    return output.join('\n')
  }
}
