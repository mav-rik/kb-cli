import { pipeline, env } from '@huggingface/transformers'
import * as path from 'node:path'
import * as os from 'node:os'

export class EmbeddingService {
  private pipe: any = null
  private modelName = 'Xenova/all-MiniLM-L6-v2'
  private initPromise: Promise<void> | null = null

  /**
   * Lazy-load the model on first use.
   * Downloads ~90MB model to cache on first call.
   */
  async init(): Promise<void> {
    if (this.pipe) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._loadModel()
    return this.initPromise
  }

  private async _loadModel(): Promise<void> {
    // Cache models in ~/.ai-memory/models/
    env.cacheDir = path.join(os.homedir(), '.ai-memory', '.models')

    process.stderr.write('Loading embedding model...\n')
    this.pipe = await pipeline('feature-extraction', this.modelName, {
      dtype: 'fp32',
    })
    process.stderr.write('Embedding model ready.\n')
  }

  /**
   * Compute embedding for a single text.
   * Returns Float32Array of 384 dimensions.
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
    const dim = 384
    const results: Float32Array[] = []
    for (let i = 0; i < texts.length; i++) {
      results.push(new Float32Array(output.data.slice(i * dim, (i + 1) * dim)))
    }
    return results
  }
}
