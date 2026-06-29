import { EMBED_DIM } from '../brain/schema'

// ── Embedding parity contract (eng-review D5) ───────────────────────────────
// Everything that affects the vector, pinned in ONE light module (no model
// imports, so the main process can read the prefixes without loading
// onnxruntime). The Node core and the child process both import this; the CI
// pre-embed pipeline will too. Same settings both sides ⇒ comparable vectors.
export const EMBED_MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5'
export const EMBED_DTYPE = 'q8' as const // ~140MB; parity holds as long as both sides match
export const DOC_PREFIX = 'search_document: '
export const QUERY_PREFIX = 'search_query: '
export const POOLING = 'mean' as const
export const NORMALIZE = true

export { EMBED_DIM }
