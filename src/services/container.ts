import { ConfigService } from './config.service.js'
import { StorageService } from './storage.service.js'
import { ParserService } from './parser.service.js'
import { IndexService } from './index.service.js'
import { LinkerService } from './linker.service.js'
import { EmbeddingService } from './embedding.service.js'
import { VectorService } from './vector.service.js'
import { FtsService } from './fts.service.js'
import { SearchService } from './search.service.js'
import { DocWorkflowService } from './doc-workflow.service.js'
import { KbManagementService } from './kb-management.service.js'
import { ActivityLogService } from './activity-log.service.js'

class ServiceContainer {
  readonly config = new ConfigService()
  readonly parser = new ParserService()
  readonly storage: StorageService
  readonly index: IndexService
  readonly linker: LinkerService
  readonly embedding = new EmbeddingService()
  readonly vector: VectorService
  readonly fts: FtsService
  readonly search: SearchService
  readonly docWorkflow: DocWorkflowService
  readonly kbManagement: KbManagementService
  readonly activityLog: ActivityLogService

  constructor() {
    this.index = new IndexService(this.config)
    this.vector = new VectorService(this.config)
    this.fts = new FtsService(this.config)
    this.storage = new StorageService(this.config, this.parser)
    this.linker = new LinkerService(this.storage, this.parser, this.index)
    this.search = new SearchService(this.embedding, this.vector, this.fts, this.index, this.storage)
    this.docWorkflow = new DocWorkflowService(this.parser, this.index, this.linker, this.embedding, this.vector, this.fts, this.storage)
    this.kbManagement = new KbManagementService(this.config)
    this.activityLog = new ActivityLogService(this.config)
  }
}

export const services = new ServiceContainer()
