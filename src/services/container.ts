import { ConfigService } from './config.service.js'
import { StorageService } from './storage.service.js'
import { ParserService } from './parser.service.js'
import { IndexService } from './index.service.js'
import { LinkerService } from './linker.service.js'
import { EmbeddingService } from './embedding.service.js'
import { VectorService } from './vector.service.js'
import { SearchService } from './search.service.js'

class ServiceContainer {
  readonly config = new ConfigService()
  readonly parser = new ParserService()
  readonly storage: StorageService
  readonly index: IndexService
  readonly linker: LinkerService
  readonly embedding = new EmbeddingService()
  readonly vector: VectorService
  readonly search: SearchService

  constructor() {
    this.index = new IndexService(this.config)
    this.vector = new VectorService(this.config)
    this.storage = new StorageService(this.config, this.parser)
    this.linker = new LinkerService(this.storage, this.parser, this.index)
    this.search = new SearchService(this.embedding, this.vector, this.index, this.storage)
  }
}

export const services = new ServiceContainer()
