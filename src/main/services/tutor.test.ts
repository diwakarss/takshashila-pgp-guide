import { describe, it, expect } from 'vitest'
import { buildTutorPrompt, runTutor } from './tutor'
import type { Engine } from '../engine/types'
import type { SearchHit } from '../../shared/ipc'

function hit(slug: string, text: string, title: string, score = 0.8): SearchHit {
  return { id: `${slug}#0`, slug, source: 'corpus', ordinal: 0, text, title, type: 'study-notes', score }
}

const fakeEngine = (reply: string): Engine => ({
  capabilities: {
    id: 'fake',
    label: 'Fake',
    qualityTier: 'high',
    supportsImages: false,
    supportsStreaming: false,
    canGradeFreeform: true,
    passesNoWriteGate: true,
    costPerToken: 0
  },
  isAvailable: async () => true,
  complete: async () => reply
})

describe('buildTutorPrompt', () => {
  it('numbers sources and grounds the model on them', () => {
    const msgs = buildTutorPrompt('why do bans fail?', [
      hit('micro-1', 'bans fail because people respond to incentives', 'Microeconomics 1')
    ])
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toMatch(/ONLY the numbered sources/)
    expect(msgs[1].content).toContain('[1] (Microeconomics 1)')
    expect(msgs[1].content).toContain('Question: why do bans fail?')
  })
})

describe('runTutor', () => {
  it('retrieves, grounds, and returns the answer with its sources', async () => {
    const sources = [hit('micro-1', 'incentives matter', 'Microeconomics 1')]
    const result = await runTutor('why do bans fail?', {
      search: async () => sources,
      engine: fakeEngine('Bans fail because people respond to incentives [1].')
    })
    expect(result.answer).toContain('[1]')
    expect(result.sources).toEqual(sources)
    expect(result.engineId).toBe('fake')
  })

  it('returns a graceful message when nothing is retrieved (no engine call)', async () => {
    let called = false
    const result = await runTutor('obscure question', {
      search: async () => [],
      engine: { ...fakeEngine('should not run'), complete: async () => ((called = true), '') }
    })
    expect(called).toBe(false)
    expect(result.sources).toEqual([])
    expect(result.answer).toMatch(/couldn't find/i)
  })
})
