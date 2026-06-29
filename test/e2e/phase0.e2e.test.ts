import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Brain } from '../../src/main/brain/brain'
// e2e runs in plain Node (no Electron), so it uses the direct embedder, not
// the utilityProcess proxy. Same model + contract.
import { directEmbedder as nomicEmbedder } from '../../src/main/embed/nomicCore'
import { importDirectory } from '../../src/main/corpus/import'

// Phase 0 acceptance: the REAL pipeline over the REAL corpus with the REAL
// nomic embedder. Proves all four eng-review spikes end to end and logs the
// perf budgets (eng D10). Excluded from `npm test`; run via `npm run test:e2e`.
// Requires the corpus clone at corpus-cache/pgp-brain/pgp.

const CORPUS = join(process.cwd(), 'corpus-cache', 'pgp-brain', 'pgp')
const hasCorpus = existsSync(CORPUS)

describe.skipIf(!hasCorpus)('Phase 0 end-to-end (real corpus + real embedder)', () => {
  let brain: Brain
  let dataDir: string

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'pgp-brain-e2e-'))
    brain = await Brain.open(dataDir)
  })
  afterAll(async () => {
    await brain.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it(
    'imports the cohort corpus and answers real questions with cited lessons',
    async () => {
      const t0 = Date.now()
      const result = await importDirectory({
        dir: CORPUS,
        embedder: nomicEmbedder,
        writer: brain.corpusWriter
      })
      const importMs = Date.now() - t0
      console.log(
        `[perf] imported ${result.files} files / ${result.chunks} chunks in ${(importMs / 1000).toFixed(1)}s ` +
          `(${(importMs / result.files).toFixed(0)}ms/file)`
      )
      expect(result.files).toBeGreaterThan(150)
      expect(result.chunks).toBeGreaterThan(result.files) // multi-chunk lessons

      const stats = await brain.stats()
      expect(stats.bySource['corpus']).toBe(result.files)
      expect(stats.bySource['private']).toBeUndefined() // nothing leaked to private

      // Warm query latency (eng D10 budget signal).
      const tq = Date.now()
      const hits = await brain.search(await nomicEmbedder.embedQuery('why do outright bans fail in public policy?'), {
        limit: 5
      })
      console.log(`[perf] query end-to-end ${Date.now() - tq}ms`)
      console.log('[top hits]', hits.slice(0, 3).map((h) => `${Math.round(h.score * 100)}% ${h.title ?? h.slug}`))

      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].score).toBeGreaterThan(0.4)
      // The plastic-ban / incentives material lives in the microeconomics lessons.
      const top3 = hits.slice(0, 3)
      const onTopic = top3.some(
        (h) =>
          /ban|incentiv|plastic|margin|econom/i.test(h.text) ||
          /econom|micro|policy/i.test(`${h.title ?? ''} ${h.slug}`)
      )
      expect(onTopic).toBe(true)

      // A second, different question should surface different top material.
      const hist = await brain.search(await nomicEmbedder.embedQuery('the long arc of human history and agriculture'), {
        limit: 3
      })
      console.log('[history top]', hist.slice(0, 2).map((h) => `${Math.round(h.score * 100)}% ${h.title ?? h.slug}`))
      expect(hist[0].score).toBeGreaterThan(0.4)
    },
    600_000
  )
})
