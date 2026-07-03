import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Md, Cite } from './Markdown'

// Capture relies on [n] rendering as one <sup class="cite" data-cite="n"> each,
// so a selection can read exactly which sources it references.
describe('Md citations', () => {
  it('renders [n] as sup.cite with data-cite', () => {
    const html = renderToStaticMarkup(createElement(Md, { children: 'Deficit is 4.4% [1] tracked monthly [2].' }))
    expect(html).toContain('data-cite="1"')
    expect(html).toContain('class="cite"')
    expect((html.match(/data-cite=/g) || []).length).toBe(2)
  })

  it('renders adjacent citations [13][6] as two separate elements', () => {
    const html = renderToStaticMarkup(createElement(Md, { children: 'hikes [13][6] more' }))
    const cites = [...html.matchAll(/data-cite="(\d+)"/g)].map((m) => m[1])
    expect(cites).toEqual(['13', '6'])
  })

  it('keeps GFM tables', () => {
    const html = renderToStaticMarkup(createElement(Md, { children: '| A | B |\n| --- | --- |\n| 1 | 2 |' }))
    expect(html).toContain('<table>')
  })
})

describe('Cite (inline, for lens points/cells)', () => {
  it('renders plain-string citations as sup.cite', () => {
    const html = renderToStaticMarkup(createElement(Cite, { children: 'Reduces poverty [3] overall' }))
    expect(html).toContain('data-cite="3"')
    expect(html).toContain('Reduces poverty')
  })
})
