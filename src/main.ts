import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import { CliApp, Controller, Cli, CliOption, Description, Optional } from '@moostjs/event-cli'
import { cliValidatorPipe, cliValidationErrorTransform } from './utils/cli-validator.js'
import { WikiController } from './controllers/wiki.controller.js'
import { ConfigController } from './controllers/config.controller.js'
import { ReadController } from './controllers/read.controller.js'
import { DocController } from './controllers/doc.controller.js'
import { SearchController } from './controllers/search.controller.js'
import { LintController } from './controllers/lint.controller.js'
import { SkillController } from './controllers/skill.controller.js'
import { SetupController } from './controllers/setup.controller.js'
import { RemoteController } from './controllers/remote.controller.js'
import { MigrateController } from './controllers/migrate.controller.js'
import { StatusController } from './controllers/status.controller.js'
import { startServer } from './api/serve.js'
import { services } from './services/container.js'
import { isAllowedDuringMigration } from './migration-gate.js'

@Controller()
class AppController {
  @Cli('version')
  @Description('Show version')
  version() {
    return __VERSION__
  }

  @Cli('serve')
  @Description('Start HTTP API server')
  async serve(
    @Description('Port number') @CliOption('port', 'p') @Optional() port: string,
    @Description('Shared secret for access control') @CliOption('secret') @Optional() secret: string,
    @Description('Fork the server into the background') @CliOption('detached', 'd') @Optional() detached: boolean,
    @Description('When detached, redirect stdio (append mode) to this path') @CliOption('log') @Optional() logPath: string,
    @Description('Stop the running local server (sends SIGTERM)') @CliOption('stop') @Optional() stop: boolean,
  ): Promise<string | void> {
    if (stop) {
      return runStop()
    }

    if (logPath && !detached) {
      process.stderr.write(
        `kb-wiki: --log is only meaningful together with --detached.\n`,
      )
      process.exit(1)
    }

    if (detached) {
      return runDetached(process.argv.slice(2), logPath)
    }

    const p = port ? parseInt(port, 10) : DEFAULT_PORT
    await startServer(p, secret || undefined)
    await new Promise(() => {})
  }
}

const DEFAULT_PORT = 4141
const STOP_DEADLINE_MS = 2000
const STOP_POLL_MS = 100

async function runStop(): Promise<string> {
  const localServer = services.localServer
  const info = await localServer.refresh()
  if (!info) {
    return 'No local server running.'
  }

  try {
    process.kill(info.pid, 'SIGTERM')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') {
      // Process already gone — clean up the stale tempfile and report.
      localServer.clear()
      return 'No local server running.'
    }
    throw err
  }

  // Poll the tempfile directly (cheap fs check, no HTTP). The server's
  // shutdown handlers remove the file on graceful exit.
  const deadline = Date.now() + STOP_DEADLINE_MS
  while (Date.now() < deadline && localServer.fileExists()) {
    await sleep(STOP_POLL_MS)
  }

  // If the server failed to clean up its own tempfile, force-remove it.
  // clear() is idempotent — safe to call unconditionally.
  localServer.clear()

  return `Stopped kb-wiki server (pid ${info.pid}).`
}

function runDetached(originalArgs: string[], logPath?: string): string {
  // Strip --detached / -d and --log <value> from the child's argv so it
  // falls into the normal foreground serve path. The parent handles
  // logging via stdio redirection; the child doesn't need either flag.
  const childArgs = stripDetachedAndLog(originalArgs)

  let stdio: 'ignore' | ['ignore', number, number]
  let resolvedLog = logPath
  if (logPath) {
    const fd = fs.openSync(logPath, 'a')
    stdio = ['ignore', fd, fd]
  } else {
    stdio = 'ignore'
    resolvedLog = '/dev/null'
  }

  // process.argv[1] is the CLI entry script. process.execPath is the node binary.
  // windowsHide suppresses the brief console flash that would otherwise appear
  // on Windows when spawning a detached child.
  const child = spawn(process.execPath, [process.argv[1], ...childArgs], {
    detached: true,
    stdio,
    windowsHide: true,
  })

  child.unref()

  // Best-effort: read the requested port back from the args (purely informational).
  const portFromArgs = parsePortFromArgs(childArgs)
  const portLabel = portFromArgs !== null ? String(portFromArgs) : String(DEFAULT_PORT)

  process.stdout.write(
    `Started kb-wiki server on port ${portLabel} (pid ${child.pid}). Logs: ${resolvedLog}\n`,
  )
  process.exit(0)
}

function stripDetachedAndLog(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--detached' || a === '-d') continue
    if (a.startsWith('--detached=')) continue
    if (a === '--log') {
      i++ // also skip the positional value
      continue
    }
    if (a.startsWith('--log=')) continue
    out.push(a)
  }
  return out
}

function parsePortFromArgs(args: string[]): number | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--port' || a === '-p') {
      const next = args[i + 1]
      if (next && /^\d+$/.test(next)) return parseInt(next, 10)
    } else if (a.startsWith('--port=')) {
      const v = a.slice('--port='.length)
      if (/^\d+$/.test(v)) return parseInt(v, 10)
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (services.migration.detectNeeded() && !isAllowedDuringMigration(process.argv)) {
  process.stderr.write(
    "kb-wiki schema needs upgrading. Run 'kb migrate' first to apply the migration. " +
      "See 'kb migrate --dry-run' for details.\n",
  )
  process.exit(1)
}

// Detect a running local server so the gateway can auto-route through it.
// Skip when starting the server itself — serve.ts does its own collision check.
{
  const cmd = process.argv[2]
  if (cmd !== 'serve') {
    await services.localServer.refresh()
  }
}

// No-args invocation falls through to the cliHelpInterceptor (installed by
// useHelp below) — gives identical output to `kb --help`.
if (process.argv.length <= 2) {
  process.argv.push('--help')
}

const cliApp = new CliApp()
  .controllers(AppController, WikiController, ConfigController, ReadController, DocController, SearchController, LintController, SkillController, SetupController, RemoteController, MigrateController, StatusController)
  .useHelp({ name: 'kb', title: 'kb — Wiki CLI for AI agents' })
  .useOptions([{ keys: ['help'], description: 'Display instructions.' }])

// Mirror the HTTP setup in src/api/serve.ts: any @Param / @Body typed with
// an atscript-annotated DTO is validated automatically; a ValidatorError
// becomes a clean "Error: …" string instead of a crash.
cliApp.applyGlobalPipes(cliValidatorPipe())
cliApp.applyGlobalInterceptors(cliValidationErrorTransform())

cliApp.start()
