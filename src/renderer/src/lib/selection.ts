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

const BLOCK_TAGS = /^(P|LI|TD|TH|H[1-6]|BLOCKQUOTE|DIV)$/

function blockOf(node: Node | null): Element | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
  while (el && !BLOCK_TAGS.test(el.tagName)) el = el.parentElement
  return el
}

/**
 * The current selection as Markdown, plus the citation numbers it references.
 * `cites` = [n] markers INSIDE the selected span (precise). `contextCites` =
 * markers in the containing paragraph/list item — people naturally select the
 * claim but stop short of the little superscript, and the nearest citation
 * still governs the claim. Returns null when there's no usable selection.
 */
export function captureSelection(): { markdown: string; cites: number[]; contextCites: number[] } | null {
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

  // Fallback context: citations in the block(s) the selection starts/ends in.
  const contextCites: number[] = []
  const first = sel.getRangeAt(0)
  const last = sel.getRangeAt(sel.rangeCount - 1)
  for (const block of new Set([blockOf(first.startContainer), blockOf(last.endContainer)])) {
    block?.querySelectorAll('sup.cite').forEach((el) => {
      const n = Number(el.getAttribute('data-cite') ?? el.textContent)
      if (Number.isFinite(n)) contextCites.push(n)
    })
  }

  let markdown = ''
  try {
    markdown = turndown.turndown(container.innerHTML).trim()
  } catch {
    /* fall through */
  }
  if (!markdown) markdown = sel.toString().trim()
  return { markdown, cites: [...new Set(cites)], contextCites: [...new Set(contextCites)] }
}

// Probe hook so QA can exercise the exact shipped function (reads only the
// user's own selection; exposes no data or capability beyond that).
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>)['__pgpCaptureSelection'] = captureSelection
}
