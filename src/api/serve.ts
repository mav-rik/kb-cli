import * as http from 'node:http'
import { Moost } from 'moost'
import { MoostHttp } from '@moostjs/event-http'
import { ApiController } from './api.controller.js'

export async function startServer(port: number, token?: string): Promise<void> {
  const app = new Moost()
  const moostHttp = new MoostHttp()
  app.adapter(moostHttp)
  app.registerControllers(ApiController)
  await app.init()

  if (token) {
    const handler = moostHttp.getServerCb()
    http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      handler(req, res)
    }).listen(port)
  } else {
    moostHttp.listen(port)
  }

  console.log(`kb API server listening on http://localhost:${port}`)
  if (token) console.log(`Auth: Bearer token required`)
}
