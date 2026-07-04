import { describe, it, expect } from 'vitest'
import { buildPrompt, parseReply, runTutor, summariseReply } from './tutor'
import type { Engine } from '../engine/types'
import type { SearchHit, TutorReply } from '../../shared/ipc'

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

describe('buildPrompt', () => {
  it('includes lessons, course, and prior conversation context', () => {
    const msgs = buildPrompt(
      'go deeper',
      [hit('m1', 'incentives', 'Micro 1')],
      'Microeconomics-I',
      [{ question: 'why do bans fail?', summary: 'people respond to incentives' }]
    )
    expect(msgs[0].content).toMatch(/slide deck or plain text/)
    expect(msgs[0].content).toContain('Microeconomics-I')
    expect(msgs[1].content).toContain('Conversation so far')
    expect(msgs[1].content).toContain('why do bans fail?')
    expect(msgs[1].content).toContain('[1] "Micro 1"')
  })

  it('lists already-drawn concept titles with a verbatim-reuse instruction', () => {
    const msgs = buildPrompt('Explain thinking in degrees', [], 'Microeconomics-I', [], ['Policy Dial not Switch'])
    expect(msgs[0].content).toContain('ALREADY-DRAWN ILLUSTRATIONS')
    expect(msgs[0].content).toContain('Policy Dial not Switch')
    expect(msgs[0].content).toContain('VERBATIM')
  })

  it('omits the library block when no concepts exist', () => {
    const msgs = buildPrompt('q', [], null, [])
    expect(msgs[0].content).not.toContain('ALREADY-DRAWN ILLUSTRATIONS')
  })
})

describe('parseReply', () => {
  it('parses a slides reply with followups', () => {
    const r = parseReply('{"kind":"slides","slides":[{"heading":"A","body":"b [1]","illustration":null}],"followups":["next?"]}')
    expect(r.kind).toBe('slides')
    expect(r.slides).toHaveLength(1)
    expect(r.followups).toEqual(['next?'])
  })

  it('parses a text reply', () => {
    const r = parseReply('{"kind":"text","text":"The exam is in week 12.","followups":[]}')
    expect(r.kind).toBe('text')
    expect(r.text).toContain('week 12')
    expect(r.slides).toHaveLength(0)
  })

  it('falls back to text when there is no JSON', () => {
    const r = parseReply('just prose')
    expect(r.kind).toBe('text')
    expect(r.text).toBe('just prose')
  })
})

describe('runTutor', () => {
  it('scopes search, returns a typed reply with sources + followups', async () => {
    let scoped: string | undefined = 'unset'
    const reply = await runTutor(
      { question: 'explain elasticity', courseCode: 'PP231', history: [] },
      {
        search: async (_q, _l, c) => {
          scoped = c
          return [hit('m1', 'elastic', 'Micro 1')]
        },
        engine: fakeEngine('{"kind":"slides","slides":[{"heading":"Elasticity","body":"x [1]","illustration":null}],"followups":["a","b"]}')
      }
    )
    expect(scoped).toBe('PP231')
    expect(reply.kind).toBe('slides')
    expect(reply.sources).toHaveLength(1)
    expect(reply.followups).toEqual(['a', 'b'])
  })
})

describe('summariseReply', () => {
  it('summarises slides by heading and text by snippet', () => {
    const slides: TutorReply = { kind: 'slides', slides: [{ heading: 'One', body: '', illustration: null }, { heading: 'Two', body: '', illustration: null }], text: '', sources: [], followups: [], engineId: 'x' }
    expect(summariseReply(slides)).toBe('One · Two')
    const text: TutorReply = { kind: 'text', slides: [], text: 'a short answer', sources: [], followups: [], engineId: 'x' }
    expect(summariseReply(text)).toBe('a short answer')
  })
})
