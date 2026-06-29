import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Brain } from './brain'
import { EMBED_DIM } from './schema'

// A 768-dim unit vector that leans toward axis `axis`. Cosine similarity
// between two such vectors is high when they share an axis, low otherwise —
// enough to assert that search ranks the right chunk first.
function vec(axis: number, jitter = 0.01): number[] {
  const v = new Array(EMBED_DIM).fill(0).map((_, i) => (i === axis ? 1 : jitter * Math.sin(i)))
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map((x) => x / norm)
}

describe('Brain (PGLite + pgvector)', () => {
  let brain: Brain
  beforeEach(async () => {
    brain = await Brain.open() // in-memory
  })
  afterEach(async () => {
    await brain.close()
  })

  it('stores a page + chunks and finds them by vector similarity', async () => {
    await brain.corpusWriter.upsertPage(
      { slug: 'micro-1', title: 'Microeconomics 1', type: 'study-notes' },
      [
        { ordinal: 0, text: 'think in degrees not binary', embedding: vec(0) },
        { ordinal: 1, text: 'the plastic ban example', embedding: vec(5) }
      ]
    )
    const hits = await brain.search(vec(0), { limit: 2 })
    expect(hits.length).toBe(2)
    expect(hits[0].text).toBe('think in degrees not binary')
    expect(hits[0].title).toBe('Microeconomics 1')
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('upsert replaces a page in place (no duplicate chunks)', async () => {
    const w = brain.corpusWriter
    await w.upsertPage({ slug: 'p1', title: 'v1' }, [{ ordinal: 0, text: 'a', embedding: vec(1) }])
    await w.upsertPage({ slug: 'p1', title: 'v2' }, [{ ordinal: 0, text: 'b', embedding: vec(1) }])
    const s = await brain.stats()
    expect(s.pages).toBe(1)
    expect(s.chunks).toBe(1)
    const hits = await brain.search(vec(1), { limit: 5 })
    expect(hits[0].text).toBe('b') // the replacement, not the original
  })

  it('write-fence: a source writer only writes its own source', async () => {
    await brain.writer('corpus').upsertPage({ slug: 'c', title: 'course' }, [
      { ordinal: 0, text: 'corpus chunk', embedding: vec(2) }
    ])
    await brain.writer('private').upsertPage({ slug: 'n', title: 'note' }, [
      { ordinal: 0, text: 'private chunk', embedding: vec(2) }
    ])

    const s = await brain.stats()
    expect(s.bySource).toEqual({ corpus: 1, private: 1 })

    // A corpus-scoped search must never surface a private chunk.
    const corpusOnly = await brain.search(vec(2), { limit: 5, source: 'corpus' })
    expect(corpusOnly.every((h) => h.source === 'corpus')).toBe(true)
    expect(corpusOnly.some((h) => h.text === 'private chunk')).toBe(false)
  })

  it('rejects embeddings of the wrong dimension', async () => {
    await expect(
      brain.corpusWriter.upsertPage({ slug: 'bad' }, [{ ordinal: 0, text: 'x', embedding: [1, 2, 3] }])
    ).rejects.toThrow(/768/)
  })
})
