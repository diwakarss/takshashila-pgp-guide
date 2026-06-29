import { describe, it, expect } from 'vitest'
import { buildSlidesPrompt, parseSlides, runTutor } from './tutor'
import type { Engine } from '../engine/types'
import type { SearchHit } from '../../shared/ipc'

function hit(slug: string, text: string, title: string, courseName = 'Microeconomics-I', score = 0.8): SearchHit {
  return { id: `${slug}#0`, slug, source: 'corpus', ordinal: 0, text, title, type: 'study-notes', courseName, score }
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

describe('buildSlidesPrompt', () => {
  it('asks for JSON slides, numbered lessons, light [n] citations, names course', () => {
    const msgs = buildSlidesPrompt('why do bans fail?', [hit('m1', 'incentives', 'Micro 1')], 'Microeconomics-I')
    expect(msgs[0].content).toMatch(/SLIDES/)
    expect(msgs[0].content).toMatch(/Output ONLY JSON/)
    expect(msgs[0].content).toContain('Microeconomics-I')
    expect(msgs[1].content).toContain('[1] "Micro 1"')
  })
})

describe('parseSlides', () => {
  it('parses a clean slides object', () => {
    const slides = parseSlides('{"slides":[{"heading":"A","body":"text [1]","illustration":null}]}')
    expect(slides).toHaveLength(1)
    expect(slides[0].heading).toBe('A')
    expect(slides[0].illustration).toBeNull()
  })

  it('extracts JSON wrapped in prose / code fences and reads illustration specs', () => {
    const raw =
      'Here you go:\n```json\n{"slides":[{"heading":"H","body":"b","illustration":{"title":"T","composition":"C"}}]}\n```'
    const slides = parseSlides(raw)
    expect(slides[0].illustration).toEqual({ id: 'ill-0', title: 'T', composition: 'C' })
  })

  it('falls back to a single slide when there is no JSON', () => {
    const slides = parseSlides('just prose, no json here')
    expect(slides).toHaveLength(1)
    expect(slides[0].body).toContain('just prose')
  })
})

describe('runTutor', () => {
  it('scopes search and returns parsed slides + sources', async () => {
    let scoped: string | undefined = 'unset'
    const result = await runTutor(
      { question: 'why do bans fail?', courseCode: 'PP231' },
      {
        search: async (_q, _l, courseCode) => {
          scoped = courseCode
          return [hit('m1', 'incentives', 'Micro 1')]
        },
        engine: fakeEngine('{"slides":[{"heading":"Bans","body":"people respond to incentives [1]","illustration":null}]}')
      }
    )
    expect(scoped).toBe('PP231')
    expect(result.slides[0].heading).toBe('Bans')
    expect(result.sources).toHaveLength(1)
  })

  it('returns a "Nothing found" slide and skips the engine when no lessons match', async () => {
    let called = false
    const result = await runTutor(
      { question: 'obscure' },
      { search: async () => [], engine: { ...fakeEngine('x'), complete: async () => ((called = true), '') } }
    )
    expect(called).toBe(false)
    expect(result.slides[0].heading).toMatch(/Nothing found/i)
  })
})
