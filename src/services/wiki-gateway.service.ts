import type { WikiRef } from '../types/wiki-ref.js'
import type { WikiOps } from './wiki-ops.js'
import { LocalWikiOps, type LocalServices } from './wiki-ops.js'
import { RemoteWikiOps } from './wiki-ops.js'
import { RemoteClient } from './remote-client.js'
import type { LocalServerService } from './local-server.service.js'

export class WikiGatewayService {
  private remoteClient = new RemoteClient()

  constructor(
    private localServices: LocalServices,
    private localServer: LocalServerService,
  ) {}

  getOps(ref: WikiRef): WikiOps {
    // Remote wiki refs always go direct to their real URL.
    if (ref.type === 'remote') {
      return new RemoteWikiOps(ref.url, ref.name, ref.secret, this.remoteClient)
    }

    // Local wiki: if a local server is running, transparently route through it
    // so we re-use its warm embedding model instead of cold-loading our own.
    const serverInfo = this.localServer.getCached()
    if (serverInfo) {
      return new RemoteWikiOps(
        `http://localhost:${serverInfo.port}`,
        ref.name,
        serverInfo.secret ?? undefined,
        this.remoteClient,
      )
    }

    return new LocalWikiOps(ref.name, this.localServices)
  }
}
