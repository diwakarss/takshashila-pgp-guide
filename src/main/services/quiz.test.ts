import { describe, it, expect } from 'vitest'
import { parseQuestions, parseVerdict, buildQuizPrompt } from './quiz'
import type { SearchHit } from '../../shared/ipc'

describe('parseQuestions', () => {
  it('parses all four formats and normalises them', () => {
    const raw = JSON.stringify({
      questions: [
        { kind: 'mcq', prompt: 'Q1', options: ['a', 'b', 'c', 'd'], answerIndex: 2, explanation: 'e1', concept: 'C1', source: 'L1' },
        { kind: 'truefalse', prompt: 'Q2', options: ['True', 'False'], answerIndex: 1, explanation: 'e2', concept: '', source: 'L2' },
        { kind: 'multi', prompt: 'Q3', options: ['a', 'b', 'c', 'd'], answerIndexes: [2, 0, 0], explanation: 'e3', concept: 'C3', source: 'L3' },
        { kind: 'freeform', prompt: 'Q4', modelAnswer: 'model', explanation: 'e4', concept: 'C4', source: 'L4' }
      ]
    })
    const qs = parseQuestions(raw)
    expect(qs.map((q) => q.kind)).toEqual(['mcq', 'truefalse', 'multi', 'freeform'])

    expect(qs[0]).toMatchObject({ kind: 'mcq', answerIndex: 2, answerIndexes: [], concept: 'C1' })
    // truefalse always presents a clean True/False pair
    expect(qs[1]).toMatchObject({ kind: 'truefalse', options: ['True', 'False'], answerIndex: 1 })
    // multi dedupes + sorts the correct set
    expect(qs[2]).toMatchObject({ kind: 'multi', answerIndexes: [0, 2], answerIndex: -1 })
    expect(qs[3]).toMatchObject({ kind: 'freeform', modelAnswer: 'model', answerIndex: -1 })
  })

  it('drops malformed questions (mcq out-of-range, multi with <2 correct)', () => {
    const raw = JSON.stringify({
      questions: [
        { kind: 'mcq', prompt: 'bad', options: ['a', 'b'], answerIndex: 9 },
        { kind: 'multi', prompt: 'thin', options: ['a', 'b', 'c'], answerIndexes: [0] },
        { kind: 'mcq', prompt: 'ok', options: ['a', 'b', 'c', 'd'], answerIndex: 0 }
      ]
    })
    const qs = parseQuestions(raw)
    expect(qs).toHaveLength(1)
    expect(qs[0].prompt).toBe('ok')
  })

  it('returns [] on non-JSON', () => {
    expect(parseQuestions('sorry, I cannot')).toEqual([])
  })
})

describe('buildQuizPrompt', () => {
  const hit = (title: string): SearchHit => ({
    id: `${title}#0`,
    slug: title,
    source: 'corpus',
    ordinal: 0,
    text: 'lesson body',
    title,
    type: 'study-notes',
    courseName: 'Microeconomics-I',
    score: 0.8
  })

  it('lists library concept titles for the engine to key against', () => {
    const msgs = buildQuizPrompt([hit('Opportunity cost')], 'Microeconomics-I', 5, ['Opportunity Cost Trade-Off'])
    const system = msgs[0].content
    expect(system).toContain('ILLUSTRATION CONCEPTS')
    expect(system).toContain('Opportunity Cost Trade-Off')
    expect(system).toContain('VERBATIM')
  })

  it('omits the concept list when the library is empty', () => {
    const msgs = buildQuizPrompt([hit('L')], 'Microeconomics-I', 5, [])
    expect(msgs[0].content).not.toContain('ILLUSTRATION CONCEPTS')
  })
})

describe('parseVerdict', () => {
  it('parses a clean verdict', () => {
    expect(parseVerdict('{"verdict":"correct","feedback":"nice"}')).toEqual({ verdict: 'correct', feedback: 'nice' })
  })
  it('falls back to partial on junk', () => {
    expect(parseVerdict('hmm').verdict).toBe('partial')
  })
})
