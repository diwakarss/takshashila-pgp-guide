import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReactNode } from 'react'

// A minimal hast node — enough to walk react-markdown's tree without pulling in
// hast/unified types.
type HNode = { type: string; value?: string; tagName?: string; children?: HNode[]; properties?: Record<string, unknown> }

const CITE_RE = /\[(\d{1,3})\]/g
const HAS_CITE = /\[\d{1,3}\]/

// Split a text value on [n] citation markers, turning each into its own
// <sup class="cite" data-cite="n"> element. One element per citation → capture
// can read exactly which sources a selection references (no ambiguity when
// citations are adjacent, e.g. [13][6]).
function splitCitations(value: string): HNode[] {
  const out: HNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  CITE_RE.lastIndex = 0
  while ((m = CITE_RE.exec(value))) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    out.push({
      type: 'element',
      tagName: 'sup',
      properties: { className: ['cite'], 'data-cite': m[1] },
      children: [{ type: 'text', value: m[1] }]
    })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function walkCitations(node: HNode): void {
  if (!node.children) return
  // Don't touch code/pre — [n] there is literal.
  if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return
  const next: HNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value && HAS_CITE.test(child.value)) {
      next.push(...splitCitations(child.value))
    } else {
      walkCitations(child)
      next.push(child)
    }
  }
  node.children = next
}

function rehypeCitations() {
  return (tree: unknown): void => walkCitations(tree as HNode)
}

// Markdown with GitHub-flavored extensions (tables, strikethrough…) and inline
// [n] citations rendered as superscript elements.
export function Md(props: { children: string }): JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeCitations]}>
      {props.children}
    </ReactMarkdown>
  )
}

// Inline citation rendering for plain (non-Markdown) strings — lens list points
// and table cells. Same <sup class="cite"> element so capture can read it.
export function Cite(props: { children: string }): JSX.Element {
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  CITE_RE.lastIndex = 0
  while ((m = CITE_RE.exec(props.children))) {
    if (m.index > last) parts.push(props.children.slice(last, m.index))
    parts.push(
      <sup key={key++} className="cite" data-cite={m[1]}>
        {m[1]}
      </sup>
    )
    last = m.index + m[0].length
  }
  if (last < props.children.length) parts.push(props.children.slice(last))
  return <>{parts}</>
}
