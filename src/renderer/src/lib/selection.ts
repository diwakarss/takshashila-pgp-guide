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

/** The current selection as Markdown; falls back to plain text, '' if empty. */
export function selectionToMarkdown(): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return ''
  const container = document.createElement('div')
  for (let i = 0; i < sel.rangeCount; i++) container.appendChild(sel.getRangeAt(i).cloneContents())
  try {
    const md = turndown.turndown(container.innerHTML).trim()
    if (md) return md
  } catch {
    /* fall through to plain text */
  }
  return sel.toString().trim()
}
