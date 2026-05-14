import * as http from 'node:http'
import { Moost } from 'moost'
import { MoostHttp } from '@moostjs/event-http'
import { validatorPipe, validationErrorTransform } from '@atscript/moost-validator'
import { ApiController } from './api.controller.js'
import { services } from '../services/container.js'
import { LocalServerService } from '../services/local-server.service.js'
import { DEFAULT_EMBEDDING_MODEL } from '../services/embedding.service.js'

export async function startServer(port: number, secret?: string): Promise<void> {
  const localServer = services.localServer

  // Collision check: refuse to start if another kb-wiki server is already up.
  const existing = await localServer.refresh()
  if (existing) {
    process.stderr.write(
      `kb-wiki: server already running on port ${existing.port} (pid ${existing.pid}). ` +
        `Stop it first with 'kb serve --stop'.\n`,
    )
    process.exit(1)
  }

  const app = new Moost()
  // Every @Body() param typed with a .as interface gets validated; any
  // ValidatorError becomes an HTTP 400 with the offending field path in the
  // body. Controllers see only valid input — no per-handler shape checks.
  app.applyGlobalPipes(validatorPipe())
  app.applyGlobalInterceptors(validationErrorTransform())
  const moostHttp = new MoostHttp()
  app.adapter(moostHttp)
  app.registerControllers(ApiController)
  await app.init()

  // Bind and wait for the listening event before writing the tempfile so
  // a failed bind never leaves a stale .serve.json behind.
  await new Promise<void>((resolve, reject) => {
    let server: http.Server
    if (secret) {
      const handler = moostHttp.getServerCb()
      server = http.createServer((req, res) => {
        if (req.headers.authorization !== `Bearer ${secret}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }
        handler(req, res)
      })
      server.listen(port)
    } else {
      // MoostHttp.listen() doesn't return the server handle; fall back to
      // creating our own thin wrapper so we can attach 'listening' / 'error'.
      const handler = moostHttp.getServerCb()
      server = http.createServer(handler)
      server.listen(port)
    }
    server.once('listening', () => resolve())
    server.once('error', (err) => reject(err))
  })

  // Record the running server. Best-effort: failure here doesn't kill the
  // server, but auto-routing won't work until next restart.
  try {
    localServer.write({
      port,
      pid: process.pid,
      secret: secret ?? null,
      startedAt: new Date().toISOString(),
      embeddingModel: services.config.get('embeddingModel') || DEFAULT_EMBEDDING_MODEL,
    })
  } catch (err) {
    process.stderr.write(
      `kb-wiki: warning — failed to write serve tempfile (${(err as Error).message}). ` +
        `Auto-routing from other CLI invocations will not work.\n`,
    )
  }

  installCleanupHandlers(localServer)

  console.log(`kb API server listening on http://localhost:${port}`)
  if (secret) console.log(`Auth: shared secret required`)
}

let cleanupInstalled = false

function installCleanupHandlers(localServer: LocalServerService): void {
  if (cleanupInstalled) return
  cleanupInstalled = true

  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    try {
      localServer.clear()
    } catch {
      // best-effort
    }
  }

  const onSignal = (sig: NodeJS.Signals) => {
    cleanup()
    // Re-raise the signal default behavior: exit with the conventional code.
    // Using process.exit here keeps things deterministic across platforms.
    const code = sig === 'SIGINT' ? 130 : sig === 'SIGTERM' ? 143 : 0
    process.exit(code)
  }

  process.once('SIGINT', () => onSignal('SIGINT'))
  process.once('SIGTERM', () => onSignal('SIGTERM'))
  process.once('exit', () => cleanup())
  process.once('uncaughtException', (err) => {
    cleanup()
    throw err
  })
}
