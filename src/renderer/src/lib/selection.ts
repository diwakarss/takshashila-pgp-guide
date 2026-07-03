import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

// Convert a DOM selection to Markdown so captured highlights keep their
// structure (bullet lists, tables, emphasis, headings) instead of collapsing
// into one run-on paragraph. GFM plugin handles tables + strikethrough.
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_'
})
turndown.use(gfm)

/**
 * The current selection as Markdown, plus the citation numbers it references
 * (read from <sup class="cite"> elements — one per citation, so adjacent
 * citations like [13][6] are unambiguous). Citation markers are dropped from
 * the prose; the relevant sources are shown in the page bibliography instead.
 * Returns null when there's no usable selection.
 */
export function captureSelection(): { markdown: string; cites: number[] } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const container = document.createElement('div')
  for (let i = 0; i < sel.rangeCount; i++) container.appendChild(sel.getRangeAt(i).cloneContents())

  const cites: number[] = []
  container.querySelectorAll('sup.cite').forEach((el) => {
    const n = Number(el.getAttribute('data-cite') ?? el.textContent)
    if (Number.isFinite(n)) cites.push(n)
    el.remove() // keep the prose clean
  })

  let markdown = ''
  try {
    markdown = turndown.turndown(container.innerHTML).trim()
  } catch {
    /* fall through */
  }
  if (!markdown) markdown = sel.toString().trim()
  return { markdown, cites: [...new Set(cites)] }
}
