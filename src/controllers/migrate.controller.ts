import * as readline from 'node:readline'
import { Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import type { MigrationPlan } from '../services/migration.service.js'

@Controller()
export class MigrateController {
  private get migration() { return services.migration }

  @Cli('migrate')
  @Description('Upgrade local wiki schema/embeddings to the current version')
  async migrate(
    @Description('Skip the confirmation prompt') @CliOption('yes', 'y') yes: boolean,
    @Description('Show the migration plan without applying it') @CliOption('dry-run') dryRun: boolean,
    @Description('Limit migration to a single wiki') @CliOption('wiki', 'w') @Optional() wiki: string,
  ): Promise<string> {
    const serverInfo = services.localServer.getCached()
    if (serverInfo) {
      process.stderr.write(
        `kb-wiki: stop the local server (kb serve --stop) before running migrate. ` +
          `Server pid ${serverInfo.pid} on port ${serverInfo.port} has the schema locked.\n`,
      )
      process.exit(1)
    }

    const plan = await this.migration.plan({ wiki })

    const summary = formatPlan(plan)

    // Already current? Print and exit.
    if (
      plan.schemaVersionFrom >= plan.schemaVersionTo &&
      plan.wikis.every((w) => w.needingEmbedding === 0 && !w.hasLegacyVec && !w.hasMarker)
    ) {
      return summary + '\n\nAlready up to date. Nothing to migrate.'
    }

    if (dryRun) {
      return summary + '\n\nDry run — no changes applied.'
    }

    // Print the plan to stderr so it survives even when the CLI is piped.
    process.stderr.write(summary + '\n\n')

    if (!yes) {
      const ok = await confirm('Proceed? [y/N] ')
      if (!ok) {
        return 'Aborted.'
      }
    }

    await this.migration.run({
      wiki,
      onProgress: (w, done, total, label) => {
        if (total === 0) {
          process.stderr.write(`[wiki: ${w}] nothing to do\n`)
          return
        }
        process.stderr.write(`[wiki: ${w}] [${done}/${total}] ${label}\n`)
      },
    })

    const tail: string[] = []
    tail.push(`Migration complete. Schema version: ${plan.schemaVersionTo}.`)
    if (plan.legacyModelToRemove) {
      tail.push(`Removed legacy embedding model cache: ${plan.legacyModelToRemove}`)
    }
    return tail.join('\n')
  }
}

function formatPlan(plan: MigrationPlan): string {
  const lines: string[] = []
  lines.push(`Schema version: ${plan.schemaVersionFrom} -> ${plan.schemaVersionTo}`)
  lines.push('')
  if (plan.wikis.length === 0) {
    lines.push('Wikis: (none found)')
  } else {
    lines.push('Wikis:')
    for (const w of plan.wikis) {
      lines.push(
        `  ${w.name}: ${w.totalDocs} docs ` +
          `(${w.needingEmbedding} need embedding, ` +
          `legacy=${w.hasLegacyVec ? 'yes' : 'no'}, ` +
          `marker=${w.hasMarker ? 'yes' : 'no'})`,
      )
    }
  }
  lines.push('')
  lines.push(`Legacy model to delete: ${plan.legacyModelToRemove ?? 'none'}`)
  return lines.join('\n')
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
    rl.question(prompt, (answer) => {
      rl.close()
      const a = (answer || '').trim().toLowerCase()
      resolve(a === 'y' || a === 'yes')
    })
  })
}
