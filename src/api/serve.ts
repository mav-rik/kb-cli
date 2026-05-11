import { Moost } from 'moost'
import { MoostHttp } from '@moostjs/event-http'
import { ApiController } from './api.controller.js'

export async function startServer(port: number): Promise<void> {
  const app = new Moost()
  const http = new MoostHttp()
  app.adapter(http)
  app.registerControllers(ApiController)
  await app.init()
  http.listen(port)
  console.log(`aimem API server listening on http://localhost:${port}`)
}
