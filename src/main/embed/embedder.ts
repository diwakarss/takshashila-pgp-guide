import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { EMBED_DIM } from '../brain/schema'

// ── Embedding parity contract (eng-review D5) ───────────────────────────────
// nomic-embed-text REQUIRES task prefixes, and retrieval silently degrades if
// the corpus and the queries are embedded differently. So everything that
// affects the vector is pinned here, in ONE place, and reused by both the
// client (queries + private notes) and — later — the CI pre-embed pipeline:
//   model id · dtype · task prefixes · pooling · normalization · dimension.
// Same settings both sides ⇒ comparable vectors by construction.
export const EMBED_MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5'
export const EMBED_DTYPE = 'q8' as const // quantized: ~140MB, parity holds as long as both sides match
export const DOC_PREFIX = 'search_document: '
export const QUERY_PREFIX = 'search_query: '
export const POOLING = 'mean' as const
export const NORMALIZE = true

/** What the importer and query path depend on. Lets tests inject a fake
 *  embedder instead of downloading the 140MB model. */
export interface Embedder {
  /** Embed corpus/document text (applies the document prefix). */
  embedDocuments(texts: string[]): Promise<number[][]>
  /** Embed a search query (applies the query prefix). */
  embedQuery(text: string): Promise<number[]>
  /** Preload the model so the first real call isn't a cold start (eng D10). */
  warmup(): Promise<void>
}

class NomicEmbedder implements Embedder {
  private pipe: Promise<FeatureExtractionPipeline> | null = null

  private get(): Promise<FeatureExtractionPipeline> {
    if (!this.pipe) {
      this.pipe = pipeline('feature-extraction', EMBED_MODEL_ID, {
        dtype: EMBED_DTYPE
      }) as Promise<FeatureExtractionPipeline>
    }
    return this.pipe
  }

  async warmup(): Promise<void> {
    await this.get()
  }

  private async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const pipe = await this.get()
    const out = await pipe(texts, { pooling: POOLING, normalize: NORMALIZE })
    const arr = out.tolist() as number[][]
    for (const v of arr) {
      if (v.length !== EMBED_DIM) {
        throw new Error(`embedder produced ${v.length} dims, expected ${EMBED_DIM}`)
      }
    }
    return arr
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts.map((t) => DOC_PREFIX + t))
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.embed([QUERY_PREFIX + text])
    return v
  }
}

/** Process-wide singleton (the model is loaded once). */
export const nomicEmbedder: Embedder = new NomicEmbedder()
