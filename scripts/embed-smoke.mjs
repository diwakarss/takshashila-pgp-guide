// Throwaway smoke: confirm nomic-embed-text-v1.5 loads + embeds in-process
// with the pinned parity config. Not a committed test (it downloads ~140MB).
import { pipeline } from '@huggingface/transformers'

const t0 = Date.now()
const pipe = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', { dtype: 'q8' })
console.log(`model loaded in ${Date.now() - t0}ms`)

const t1 = Date.now()
const out = await pipe(
  [
    'search_document: Manur frames policy in degrees not binary; the plastic ban fails because people respond to incentives.',
    'search_query: why do outright bans fail in public policy',
    'search_document: photosynthesis converts sunlight into chemical energy in plants'
  ],
  { pooling: 'mean', normalize: true }
)
const arr = out.tolist()
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
console.log(`embedded ${arr.length} texts in ${Date.now() - t1}ms, dims=${arr[0].length}`)
console.log(`norm(v0)=${Math.sqrt(dot(arr[0], arr[0])).toFixed(4)} (should be ~1.0)`)
console.log(`relevant  doc<->query cosine = ${dot(arr[0], arr[1]).toFixed(4)} (should be HIGH)`)
console.log(`irrelevant doc<->query cosine = ${dot(arr[2], arr[1]).toFixed(4)} (should be LOW)`)
