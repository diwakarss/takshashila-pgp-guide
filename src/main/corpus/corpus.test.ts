import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePage, slugFromPath } from './parse'
import { chunkBody } from './chunk'
import { importDirectory } from './import'
import { Brain } from '../brain/brain'
import { EMBED_DIM } from '../brain/schema'
import type { Embedder } from '../embed/types'

// Deterministic fake embedder — no model download. Maps text to a stable
// 768-dim unit vector so import + search are exercised end to end.
const fakeEmbedder: Embedder = {
  warmup: async () => {},
  embedDocuments: async (texts) => texts.map(embedText),
  embedQuery: async (t) => embedText(t)
}
function embedText(t: string): number[] {
  const v = new Array(EMBED_DIM).fill(0)
  for (let i = 0; i < t.length; i++) v[i % EMBED_DIM] += t.charCodeAt(i)
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

const SAMPLE = `---
type: study-notes
title: Microeconomics-1 (Part 1/2)
captured_at: '2026-06-20T00:00:00.000Z'
recorded_at: 2026-06-20T14:31:50
tags:
  - pgp
  - study-notes
---

## TL;DR

Manur frames economics as the base of public policy and opens with: think in
degrees, not in binary.

## First principle: think in degrees

Not yes/no or good/bad but more-or-less. Public policy is a fan regulator, not a
light switch.

## Related
- [[long-arc-of-human-history-20260620-pt1]]
- [[microeconomics-1-contd-20260620-pt1|continued]]
`

describe('parsePage', () => {
  it('derives slug from filename', () => {
    expect(slugFromPath('pgp/microeconomics-1-20260620-pt1.md')).toBe('microeconomics-1-20260620-pt1')
  })

  it('splits frontmatter, body, and related edges', () => {
    const p = parsePage('microeconomics-1-20260620-pt1.md', SAMPLE)
    expect(p.type).toBe('study-notes')
    expect(p.title).toBe('Microeconomics-1 (Part 1/2)')
    expect(p.capturedAt).toBe('2026-06-20T00:00:00.000Z')
    expect(p.body.startsWith('## TL;DR')).toBe(true)
    expect(p.body).not.toContain('type: study-notes') // frontmatter stripped
    expect(p.edges).toEqual([
      'long-arc-of-human-history-20260620-pt1',
      'microeconomics-1-contd-20260620-pt1' // alias dropped
    ])
    expect(p.contentHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('survives malformed frontmatter without dropping the body', () => {
    const bad = '---\n: : not yaml :\n---\nreal body here'
    const p = parsePage('x.md', bad)
    expect(p.body).toContain('real body here')
  })
})

describe('chunkBody', () => {
  it('carries the heading trail onto each chunk', () => {
    const p = parsePage('x.md', SAMPLE)
    const chunks = chunkBody(p.body)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].text).toContain('TL;DR')
    expect(chunks.some((c) => c.text.includes('First principle'))).toBe(true)
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i))
  })

  it('splits an over-long section into multiple chunks', () => {
    const long = '# Big\n\n' + Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + 'x'.repeat(80)).join('\n\n')
    const chunks = chunkBody(long)
    expect(chunks.length).toBeGreaterThan(1)
  })
})

describe('importDirectory (integration: parse → chunk → embed → brain)', () => {
  let dir: string
  let brain: Brain
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pgp-corpus-'))
    brain = await Brain.open()
  })
  afterEach(async () => {
    await brain.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('imports markdown files into the corpus source and makes them searchable', async () => {
    await writeFile(join(dir, 'micro-1.md'), SAMPLE)
    await writeFile(
      join(dir, 'history-1.md'),
      '---\ntype: lecture\ntitle: Long Arc of Human History\n---\n\n## Overview\n\nAgriculture, cities, and institutions over ten thousand years.'
    )
    await writeFile(join(dir, 'README.md'), '# ignore me')

    const progress: number[] = []
    const result = await importDirectory({
      dir,
      embedder: fakeEmbedder,
      writer: brain.corpusWriter,
      onProgress: (p) => progress.push(p.index)
    })

    expect(result.files).toBe(2) // README skipped
    expect(result.chunks).toBeGreaterThan(0)
    expect(progress).toEqual([1, 2])

    const stats = await brain.stats()
    expect(stats.bySource).toEqual({ corpus: 2 })

    // Everything imported lands in corpus, never private.
    const hits = await brain.search(await fakeEmbedder.embedQuery('think in degrees'), { limit: 3 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.source === 'corpus')).toBe(true)
  })

  it('incremental sync skips unchanged pages and imports only new/edited ones', async () => {
    await writeFile(join(dir, 'micro-1.md'), SAMPLE)
    await importDirectory({ dir, embedder: fakeEmbedder, writer: brain.corpusWriter })

    // Second pass with the brain's hashes: nothing changed → everything skipped.
    let result = await importDirectory({
      dir,
      embedder: fakeEmbedder,
      writer: brain.corpusWriter,
      knownHashes: await brain.corpusHashes()
    })
    expect(result.skipped).toBe(1)
    expect(result.pages).toBe(0)

    // A week later: one new class + one edited page → both import, unchanged logic intact.
    await writeFile(
      join(dir, 'trade-1.md'),
      '---\ntype: study-notes\ntitle: Trade (Part 1/1)\n---\n\n## TL;DR\n\nComparative advantage: trade what you make cheapest.'
    )
    await writeFile(join(dir, 'micro-1.md'), SAMPLE.replace('fan regulator', 'dimmer'))
    result = await importDirectory({
      dir,
      embedder: fakeEmbedder,
      writer: brain.corpusWriter,
      knownHashes: await brain.corpusHashes()
    })
    expect(result.skipped).toBe(0)
    expect(result.pages).toBe(2)

    const stats = await brain.stats()
    expect(stats.bySource).toEqual({ corpus: 2 })
  })
})
