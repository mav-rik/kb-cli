import { pipeline, env } from '@huggingface/transformers'
import * as path from 'node:path'
import { ConfigService } from './config.service.js'

export const ALLOWED_EMBEDDING_MODELS = [
  'Xenova/bge-base-en-v1.5',                  // default — 768d, 512 token context
  'Alibaba-NLP/gte-base-en-v1.5',             // long context — 768d, 8192 tokens
] as const

export type EmbeddingModel = (typeof ALLOWED_EMBEDDING_MODELS)[number]

export const DEFAULT_EMBEDDING_MODEL: EmbeddingModel = 'Xenova/bge-base-en-v1.5'

export class EmbeddingService {
  private pipe: any = null
  private modelName?: EmbeddingModel
  private initPromise: Promise<void> | null = null
  constructor(private config: ConfigService) {}

  /**
   * Lazy-load the model on first use.
   * Downloads the model to cache on first call.
   */
  async init(): Promise<void> {
    if (this.pipe) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._loadModel()
    return this.initPromise
  }

  private async _loadModel(): Promise<void> {
    const configured = this.config.get('embeddingModel') || DEFAULT_EMBEDDING_MODEL
    if (!(ALLOWED_EMBEDDING_MODELS as readonly string[]).includes(configured)) {
      throw new Error(
        `Unsupported embedding model "${configured}". Allowed: ${ALLOWED_EMBEDDING_MODELS.join(', ')}`,
      )
    }
    this.modelName = configured as EmbeddingModel

    env.cacheDir = path.join(this.config.getDataDir(), '.models')

    process.stderr.write(`Loading embedding model ${this.modelName}...\n`)
    this.pipe = await pipeline('feature-extraction', this.modelName, {
      dtype: 'fp32',
    })
    process.stderr.write('Embedding model ready.\n')
  }

  /**
   * Compute embedding for a single text.
   * Returns Float32Array of 768 dimensions.
   */
  async embed(text: string): Promise<Float32Array> {
    await this.init()
    const output = await this.pipe(text, { pooling: 'mean', normalize: true })
    return new Float32Array(output.data)
  }

  /**
   * Compute embeddings for multiple texts (batch).
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.init()
    const output = await this.pipe(texts, { pooling: 'mean', normalize: true })
    const dim = 768
    const results: Float32Array[] = []
    for (let i = 0; i < texts.length; i++) {
      results.push(new Float32Array(output.data.slice(i * dim, (i + 1) * dim)))
    }
    return results
  }
}
