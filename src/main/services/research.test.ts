import { describe, it, expect } from 'vitest'
import { classifySource, parseResearch, buildResearchPrompt, parseLens, buildLensPrompt } from './research'

describe('classifySource', () => {
  it('classifies by high-signal domains, overriding the model', () => {
    expect(classifySource('https://pib.gov.in/release', 'news')).toBe('government')
    expect(classifySource('https://www.rbi.org.in/x')).toBe('government')
    expect(classifySource('https://data.gov.in/catalog')).toBe('data')
    expect(classifySource('https://ourworldindata.org/co2')).toBe('data')
    expect(classifySource('https://www.jstor.org/stable/123')).toBe('academic')
    expect(classifySource('https://takshashila.org.in/paper')).toBe('thinktank')
    expect(classifySource('https://prsindia.org/billtrack')).toBe('thinktank')
  })
  it('falls back to the model type, then other', () => {
    expect(classifySource('https://thehindu.com/opinion', 'news')).toBe('news')
    expect(classifySource('https://example.com/x', 'banana')).toBe('other')
    expect(classifySource('not a url', 'academic')).toBe('academic')
  })
})

describe('parseResearch', () => {
  it('parses synthesis + renumbered, type-graded sources + followups', () => {
    const raw = JSON.stringify({
      synthesis: 'India’s fiscal deficit target is set in the budget [1] and tracked monthly [2].',
      sources: [
        { n: 1, title: 'Union Budget 2024', url: 'https://www.indiabudget.gov.in/', type: 'news', date: '2024' },
        { n: 5, title: 'CGA Monthly Accounts', url: 'https://cga.nic.in/', type: 'government' },
        { title: 'no url dropped' }
      ],
      followups: ['Who monitors it?', 'How does it compare to peers?']
    })
    const r = parseResearch(raw)
    expect(r.synthesis).toContain('fiscal deficit')
    expect(r.sources).toHaveLength(2)
    expect(r.sources.map((s) => s.n)).toEqual([1, 2]) // renumbered densely
    expect(r.sources[0].type).toBe('government') // .gov.in overrides "news"
    expect(r.sources[1].type).toBe('government') // .nic.in
    expect(r.followups).toHaveLength(2)
  })
  it('falls back to raw text when JSON is absent', () => {
    const r = parseResearch('sorry, I could not search')
    expect(r.synthesis).toContain('could not search')
    expect(r.sources).toEqual([])
  })
})

describe('parseLens', () => {
  it('parses a table lens (stakeholders) with renumbered sources', () => {
    const raw = JSON.stringify({
      intro: 'The main actors in gig-work regulation.',
      table: {
        columns: ['Actor', 'Position', 'Interest', 'Influence'],
        rows: [
          ['Aggregators (Union)', 'Oppose', 'Low labour cost', 'High [1]'],
          ['Gig workers', 'Support', 'Security', 'Medium']
        ]
      },
      sources: [{ n: 1, title: 'Code on Social Security', url: 'https://labour.gov.in/x', type: 'news' }]
    })
    const r = parseLens(raw, 'stakeholders')
    expect(r?.title).toBe('Stakeholder map')
    expect(r?.table?.columns).toHaveLength(4)
    expect(r?.table?.rows).toHaveLength(2)
    expect(r?.sources[0].type).toBe('government') // labour.gov.in overrides "news"
  })
  it('parses a twosides lens', () => {
    const raw = JSON.stringify({
      intro: 'UBI debate.',
      sides: { for: ['Reduces poverty [1]'], against: ['Fiscally costly [2]'] },
      sources: []
    })
    const r = parseLens(raw, 'twosides')
    expect(r?.sides?.for).toEqual(['Reduces poverty [1]'])
    expect(r?.sides?.against).toHaveLength(1)
  })
  it('returns null when the shape is empty/unusable', () => {
    expect(parseLens('{"intro":"x"}', 'evidence')).toBeNull()
    expect(parseLens('not json', 'timeline')).toBeNull()
  })
})

describe('buildLensPrompt', () => {
  it('asks for the right lens with policy grounding + context', () => {
    const msgs = buildLensPrompt('Gig economy regulation', 'stakeholders', 'prior synthesis text')
    expect(msgs[0].content).toMatch(/Stakeholder map/)
    expect(msgs[0].content).toMatch(/WEB SEARCH/)
    expect(msgs[1].content).toContain('Gig economy regulation')
    expect(msgs[1].content).toContain('prior synthesis text')
  })
})

describe('buildResearchPrompt', () => {
  it('is web-first and policy-oriented, and threads prior context', () => {
    const msgs = buildResearchPrompt('What is the fiscal deficit?', [
      { question: 'earlier q', summary: 'earlier a' }
    ])
    expect(msgs[0].content).toMatch(/WEB SEARCH/)
    expect(msgs[0].content).toMatch(/Takshashila/)
    expect(msgs[1].content).toContain('earlier q')
    expect(msgs[1].content).toContain('What is the fiscal deficit?')
  })
})
