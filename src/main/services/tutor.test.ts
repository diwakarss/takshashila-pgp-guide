import { describe, it, expect } from 'vitest'
import { buildTutorPrompt, runTutor } from './tutor'
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

describe('buildTutorPrompt', () => {
  it('instructs teaching, numbered lessons, light [n] citations, and names the course', () => {
    const msgs = buildTutorPrompt(
      'why do bans fail?',
      [hit('micro-1', 'incentives matter', 'Microeconomics 1'), hit('micro-2', 'state capacity', 'Microeconomics 2')],
      'Microeconomics-I'
    )
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toMatch(/TEACH/)
    expect(msgs[0].content).toMatch(/cite .*\[1\] or \[2\]/i)
    expect(msgs[0].content).toContain('Microeconomics-I')
    expect(msgs[1].content).toContain('[1] "Microeconomics 1"')
    expect(msgs[1].content).toContain('[2] "Microeconomics 2"')
    expect(msgs[1].content).toContain("Student's question: why do bans fail?")
  })
})

describe('runTutor', () => {
  it('passes the course scope to search and returns answer + sources', async () => {
    let scoped: string | undefined = 'unset'
    const result = await runTutor(
      { question: 'why do bans fail?', courseCode: 'PP231' },
      {
        search: async (_q, _limit, courseCode) => {
          scoped = courseCode
          return [hit('micro-1', 'incentives matter', 'Microeconomics 1')]
        },
        engine: fakeEngine('Bans fail because people respond to incentives.')
      }
    )
    expect(scoped).toBe('PP231')
    expect(result.sources).toHaveLength(1)
    expect(result.engineId).toBe('fake')
  })

  it('returns a graceful message when nothing is retrieved (no engine call)', async () => {
    let called = false
    const result = await runTutor(
      { question: 'obscure' },
      {
        search: async () => [],
        engine: { ...fakeEngine('nope'), complete: async () => ((called = true), '') }
      }
    )
    expect(called).toBe(false)
    expect(result.sources).toEqual([])
    expect(result.answer).toMatch(/couldn't find/i)
  })
})
