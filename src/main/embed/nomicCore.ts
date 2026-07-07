import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { EMBED_DIM, EMBED_MODEL_ID, EMBED_DTYPE, DOC_PREFIX, QUERY_PREFIX, POOLING, NORMALIZE } from './contract'
import type { Embedder } from './types'

// The actual nomic embedding, via Transformers.js + onnxruntime. This runs in
// a plain Node context: the utilityProcess child (the app) and Vitest (the
// e2e). It must NOT be imported by the Electron main/Chromium process — running
// onnxruntime there SIGTRAPs. Main talks to this only through the child.

let pipe: Promise<FeatureExtractionPipeline> | null = null
function get(): Promise<FeatureExtractionPipeline> {
  if (!pipe) {
    // Default device (onnxruntime-node, native CPU). This module only runs in a
    // real Node process (system node subprocess / Vitest), never Electron's
    // bundled Node — onnxruntime's native addon SIGTRAPs there. See embedder.ts.
    pipe = pipeline('feature-extraction', EMBED_MODEL_ID, { dtype: EMBED_DTYPE }) as Promise<FeatureExtractionPipeline>
  }
  return pipe
}

export async function warmupCore(): Promise<void> {
  await get()
}

// One inference call embeds a single padded batch tensor, so its memory cost
// scales with batch size × longest text. A full-book page can arrive as 1500+
// chunks at once — unbatched, that's a multi-GB tensor and the OS kills the
// process (exit code null). Small fixed batches keep memory flat.
const BATCH = 16

/** Embed already-prefixed texts with the pinned pooling/normalization. */
export async function embedCore(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const p = await get()
  const arr: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const out = await p(texts.slice(i, i + BATCH), { pooling: POOLING, normalize: NORMALIZE })
    arr.push(...(out.tolist() as number[][]))
  }
  for (const v of arr) {
    if (v.length !== EMBED_DIM) throw new Error(`embedder produced ${v.length} dims, expected ${EMBED_DIM}`)
  }
  return arr
}

/** A direct, in-process Embedder for Node contexts (tests/e2e). The app uses
 *  the utilityProcess proxy instead (see embedder.ts). */
export const directEmbedder: Embedder = {
  warmup: () => warmupCore(),
  embedDocuments: (texts) => embedCore(texts.map((t) => DOC_PREFIX + t)),
  embedQuery: async (text) => {
    const [v] = await embedCore([QUERY_PREFIX + text])
    return v
  }
}
