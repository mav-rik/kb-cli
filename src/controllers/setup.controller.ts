import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { AgentList } from '../models/api-bodies.as'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const setupDir = path.resolve(__dirname, '..', 'content', 'setup')

// Marker block is rewritten in place on every `kb setup` run — version tag
// lets users see at a glance whether their file is stale.
const MARKER_START_RE = /<!--\s*kb-cli:start[^>]*-->/
const MARKER_END_RE = /<!--\s*kb-cli:end\s*-->/

type UpsertResult = 'created' | 'replaced' | 'appended'

function buildBlock(body: string): string {
  return `<!-- kb-cli:start v=${__VERSION__} -->\n${body.trim()}\n<!-- kb-cli:end -->`
}

export function upsertMemo(filePath: string, body: string): UpsertResult {
  const block = buildBlock(body)
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, block + '\n')
    return 'created'
  }
  const existing = fs.readFileSync(filePath, 'utf-8')
  const startMatch = existing.match(MARKER_START_RE)
  if (!startMatch || startMatch.index === undefined) {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n'
    fs.writeFileSync(filePath, existing + sep + block + '\n')
    return 'appended'
  }
  const endMatch = existing.slice(startMatch.index).match(MARKER_END_RE)
  if (!endMatch || endMatch.index === undefined) {
    // Malformed (start but no end) — leave existing content, append a fresh block.
    fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + block + '\n')
    return 'appended'
  }
  const endIdx = startMatch.index + endMatch.index + endMatch[0].length
  fs.writeFileSync(filePath, existing.slice(0, startMatch.index) + block + existing.slice(endIdx))
  return 'replaced'
}

interface InstallContext {
  cwd: string
  global: boolean
  memoBody: string
}

interface AgentConfig {
  id: string
  name: string
  install: (ctx: InstallContext) => string[]
}

function describeMemo(filePath: string, action: UpsertResult): string {
  return `  ${filePath} (${action})`
}

function notSupportedGlobally(name: string): string {
  return `  ${name}: no user-scope file convention; skipped (run without --global per project)`
}

const AGENTS: AgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    install: ({ cwd, global, memoBody }) => {
      // Both project (./.claude/) and user-scope (~/.claude/) layouts are
      // supported by Claude Code — same subtree, different root.
      const baseDir = global ? path.join(os.homedir(), '.claude') : path.join(cwd, '.claude')
      const display = (rel: string) => (global ? path.join(baseDir, rel) : path.join('.claude', rel))
      const msgs: string[] = []

      const skillDir = path.join(baseDir, 'skills', 'kb')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'claude-skill.md'), path.join(skillDir, 'SKILL.md'))
      msgs.push(`  ${display('skills/kb/SKILL.md')}`)

      const cmdDir = path.join(baseDir, 'commands')
      fs.mkdirSync(cmdDir, { recursive: true })
      for (const [src, dst] of [
        ['claude-cmd-ingest.md', 'kb:ingest.md'],
        ['claude-cmd-search.md', 'kb:search.md'],
        ['claude-cmd-lint.md', 'kb:lint.md'],
        ['claude-cmd-create-wiki.md', 'kb:create-wiki.md'],
      ]) {
        fs.copyFileSync(path.join(setupDir, src), path.join(cmdDir, dst))
        msgs.push(`  ${display(`commands/${dst}`)}`)
      }

      // CLAUDE.md sits inside .claude/ for global, project-root for local.
      const claudeMd = global ? path.join(baseDir, 'CLAUDE.md') : path.join(cwd, 'CLAUDE.md')
      msgs.push(describeMemo(global ? claudeMd : 'CLAUDE.md', upsertMemo(claudeMd, memoBody)))
      return msgs
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    install: ({ cwd, global, memoBody }) => {
      const target = global
        ? path.join(os.homedir(), '.codex', 'AGENTS.md')
        : path.join(cwd, 'AGENTS.md')
      return [describeMemo(global ? target : 'AGENTS.md', upsertMemo(target, memoBody))]
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    install: ({ cwd, global, memoBody }) => {
      if (global) return [notSupportedGlobally('Cursor')]
      const rulesDir = path.join(cwd, '.cursor', 'rules')
      fs.mkdirSync(rulesDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'cursor-rules.md'), path.join(rulesDir, 'kb.mdc'))
      const msgs = [`  .cursor/rules/kb.mdc`]
      msgs.push(describeMemo('AGENTS.md', upsertMemo(path.join(cwd, 'AGENTS.md'), memoBody)))
      return msgs
    },
  },
  {
    id: 'cline',
    name: 'Cline',
    install: ({ cwd, global, memoBody }) => {
      if (global) return [notSupportedGlobally('Cline')]
      const target = path.join(cwd, 'AGENTS.md')
      return [describeMemo('AGENTS.md', upsertMemo(target, memoBody))]
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    install: ({ cwd, global, memoBody }) => {
      if (global) return [notSupportedGlobally('Windsurf')]
      const target = path.join(cwd, 'AGENTS.md')
      return [describeMemo('AGENTS.md', upsertMemo(target, memoBody))]
    },
  },
  {
    id: 'continue',
    name: 'Continue.dev',
    install: ({ cwd, global, memoBody }) => {
      if (global) return [notSupportedGlobally('Continue.dev')]
      const rulesDir = path.join(cwd, '.continue', 'rules')
      fs.mkdirSync(rulesDir, { recursive: true })
      fs.copyFileSync(path.join(setupDir, 'generic-rules.md'), path.join(rulesDir, 'kb.md'))
      const msgs = [`  .continue/rules/kb.md`]
      msgs.push(describeMemo('AGENTS.md', upsertMemo(path.join(cwd, 'AGENTS.md'), memoBody)))
      return msgs
    },
  },
]

@Controller()
export class SetupController {
  @Cli('setup')
  @Description('Set up kb integration for AI agents')
  setup(
    @Description('Agents to install (comma-separated: claude,cursor,codex,cline,windsurf,continue)')
    @CliOption('agents', 'a') @Optional() agents: AgentList,
    @Description('Install for all supported agents')
    @CliOption('all') all: boolean,
    @Description('Write to user-scope files (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md) instead of project-local')
    @CliOption('global', 'g') @Optional() global: boolean,
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
      if (unknown.length > 0) output.push(`Warning: Unknown agents: ${unknown.join(', ')}`)
    } else {
      output.push('kb setup — Install AI agent integrations')
      output.push('')
      output.push('Usage:')
      output.push('  kb setup --agents claude,cursor       # project-local install')
      output.push('  kb setup --all                        # all agents, project-local')
      output.push('  kb setup --agents claude --global     # user-scope (~/.claude/CLAUDE.md)')
      output.push('')
      output.push('Supported agents:')
      for (const agent of AGENTS) output.push(`  ${agent.id.padEnd(10)} — ${agent.name}`)
      output.push('')
      output.push('Memo blocks in CLAUDE.md / AGENTS.md are wrapped in <!-- kb-cli:start --> markers')
      output.push('so re-running `kb setup` updates them in place. Delete the block manually to uninstall.')
      return output.join('\n')
    }

    if (toInstall.length === 0) return 'No valid agents specified.'

    const memoBody = fs.readFileSync(path.join(setupDir, 'agent-memo.md'), 'utf-8')
    output.push(`Installing kb integrations${global ? ' (user-scope)' : ''}...`)
    output.push('')

    for (const agent of toInstall) {
      output.push(`${agent.name}:`)
      output.push(...agent.install({ cwd, global, memoBody }))
      output.push('')
    }

    if (!global) {
      const configPath = path.join(cwd, 'kb.config.json')
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, '{}\n')
        output.push(`Created kb.config.json (empty — set wiki with \`kb wiki use <name>\` or edit manually)`)
      }
    }

    output.push('Done! Agents can now discover and use `kb`.')
    return output.join('\n')
  }
}
