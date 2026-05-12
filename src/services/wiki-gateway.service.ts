import type { WikiRef } from '../types/wiki-ref.js'
import type { WikiOps } from './wiki-ops.js'
import { LocalWikiOps, type LocalServices } from './wiki-ops.js'
import { RemoteWikiOps } from './wiki-ops.js'
import { RemoteClient } from './remote-client.js'

export class WikiGatewayService {
  private remoteClient = new RemoteClient()

  constructor(private localServices: LocalServices) {}

  getOps(ref: WikiRef): WikiOps {
    if (ref.type === 'remote') {
      return new RemoteWikiOps(ref.url, ref.name, ref.secret, this.remoteClient)
    }
    return new LocalWikiOps(ref.name, this.localServices)
  }
}
