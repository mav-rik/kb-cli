import { ConfigService } from './config.service.js'
import { StorageService } from './storage.service.js'
import { ParserService } from './parser.service.js'
import { IndexService } from './index.service.js'
import { LinkerService } from './linker.service.js'
import { EmbeddingService } from './embedding.service.js'
import { ChunkFtsService } from './chunk-fts.service.js'
import { ChunkerService } from './chunker.service.js'
import { SearchService } from './search.service.js'
import { DocWorkflowService } from './doc-workflow.service.js'
import { WikiManagementService } from './wiki-management.service.js'
import { ActivityLogService } from './activity-log.service.js'
import { SchemaService } from './schema.service.js'
import { RemoteConfigService } from './remote-config.service.js'
import { WikiGatewayService } from './wiki-gateway.service.js'
import { MigrationService } from './migration.service.js'
import { LocalServerService } from './local-server.service.js'

class ServiceContainer {
  readonly config = new ConfigService()
  readonly parser = new ParserService()
  readonly storage: StorageService
  readonly index: IndexService
  readonly linker: LinkerService
  readonly embedding: EmbeddingService
  readonly chunkFts: ChunkFtsService
  readonly chunker: ChunkerService
  readonly search: SearchService
  readonly docWorkflow: DocWorkflowService
  readonly wikiManagement: WikiManagementService
  readonly activityLog: ActivityLogService
  readonly schema: SchemaService
  readonly remoteConfig: RemoteConfigService
  readonly localServer: LocalServerService
  readonly gateway: WikiGatewayService
  readonly migration: MigrationService

  constructor() {
    this.index = new IndexService(this.config)
    this.chunkFts = new ChunkFtsService(this.config)
    this.chunker = new ChunkerService()
    this.embedding = new EmbeddingService(this.config)
    this.storage = new StorageService(this.config, this.parser)
    this.linker = new LinkerService(this.storage, this.parser, this.index)
    this.search = new SearchService(this.embedding, this.chunkFts, this.index, this.storage)
    this.docWorkflow = new DocWorkflowService(this.parser, this.index, this.linker, this.embedding, this.storage, this.chunker, this.chunkFts)
    this.wikiManagement = new WikiManagementService(this.config)
    this.activityLog = new ActivityLogService(this.config)
    this.schema = new SchemaService(this.config, this.index, this.storage)
    this.remoteConfig = new RemoteConfigService(this.config.getDataDir())
    this.localServer = new LocalServerService(this.config)
    this.gateway = new WikiGatewayService(
      {
        storage: this.storage,
        search: this.search,
        index: this.index,
        workflow: this.docWorkflow,
        schema: this.schema,
        activityLog: this.activityLog,
        parser: this.parser,
      },
      this.localServer,
    )
    this.migration = new MigrationService(
      this.config,
      this.index,
      this.storage,
      this.wikiManagement,
      this.docWorkflow,
    )
  }
}

export const services = new ServiceContainer()
