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

  it('concept library: upserts and matches by embedding above threshold', async () => {
    await brain.upsertConcept({
      key: 'elasticity',
      title: 'Elasticity of demand',
      courseCode: 'PP231',
      imageFile: 'elasticity.png',
      embedding: vec(7)
    })
    // A near-identical concept vector matches; a far one does not.
    const hit = await brain.matchConcept(vec(7), { threshold: 0.85 })
    expect(hit?.key).toBe('elasticity')
    expect(hit?.imageFile).toBe('elasticity.png')
    expect(await brain.matchConcept(vec(200), { threshold: 0.85 })).toBeNull()
    expect(await brain.conceptCount()).toBe(1)
  })

  it('exportConcepts round-trips full rows incl. the embedding (for shipping)', async () => {
    const embedding = vec(11)
    await brain.upsertConcept({
      key: 'surplus',
      title: 'Consumer surplus',
      courseCode: 'PP231',
      description: 'area under demand above price',
      composition: 'a shaded triangle',
      imageFile: 'surplus.png',
      embedding
    })
    const rows = await brain.exportConcepts()
    expect(rows).toHaveLength(1)
    const [r] = rows
    expect(r).toMatchObject({ key: 'surplus', title: 'Consumer surplus', courseCode: 'PP231', imageFile: 'surplus.png' })
    expect(r.embedding).toHaveLength(EMBED_DIM)
    expect(r.embedding[11]).toBeCloseTo(embedding[11], 5)
    // A re-import (into a fresh brain) reuses the shipped embedding for matching.
    const fresh = await Brain.open()
    await fresh.upsertConcept(r)
    expect((await fresh.matchConcept(embedding, { threshold: 0.85 }))?.key).toBe('surplus')
    await fresh.close()
  })

  it('notebook: create, capture snippets, search, and read back the bibliography', async () => {
    const page = await brain.createNotebookPage({ id: 'p1', title: 'Fiscal policy' })
    expect(page.title).toBe('Fiscal policy')
    expect(page.snippets).toEqual([])

    await brain.appendSnippet('p1', {
      id: 's1',
      text: 'The deficit target is 4.4%.',
      sources: [{ title: 'Union Budget', url: 'https://indiabudget.gov.in', kind: 'government' }],
      from: 'Research: fiscal deficit',
      createdAt: '2026-07-03T00:00:00Z'
    })
    const got = await brain.getNotebookPage('p1')
    expect(got?.snippets).toHaveLength(1)
    expect(got?.snippets[0].sources[0].kind).toBe('government')

    // Search matches title, body, and snippet text/source.
    expect((await brain.listNotebookPages('4.4%')).map((p) => p.id)).toEqual(['p1'])
    expect((await brain.listNotebookPages('Union Budget')).map((p) => p.id)).toEqual(['p1'])
    expect(await brain.listNotebookPages('nonexistent term')).toEqual([])

    // Edit a snippet, then delete it (leaving the page).
    await brain.appendSnippet('p1', {
      id: 's2',
      text: 'Second note.',
      sources: [],
      from: 'Tutor: x',
      createdAt: '2026-07-03T01:00:00Z'
    })
    await brain.updateSnippet('p1', 's1', 'Edited first note.')
    let p = await brain.getNotebookPage('p1')
    expect(p?.snippets.find((s) => s.id === 's1')?.text).toBe('Edited first note.')
    await brain.deleteSnippet('p1', 's1')
    p = await brain.getNotebookPage('p1')
    expect(p?.snippets.map((s) => s.id)).toEqual(['s2'])

    // Edit + delete the page.
    await brain.updateNotebookPage('p1', { title: 'Fiscal deficit', body: 'my notes' })
    expect((await brain.getNotebookPage('p1'))?.title).toBe('Fiscal deficit')
    await brain.deleteNotebookPage('p1')
    expect(await brain.getNotebookPage('p1')).toBeNull()
  })

  it('rejects embeddings of the wrong dimension', async () => {
    await expect(
      brain.corpusWriter.upsertPage({ slug: 'bad' }, [{ ordinal: 0, text: 'x', embedding: [1, 2, 3] }])
    ).rejects.toThrow(/768/)
  })
})
