import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Markdown with GitHub-flavored extensions (tables, strikethrough, task lists…)
// so a table in an answer renders as a real table, not raw pipes.
export function Md(props: { children: string }): JSX.Element {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.children}</ReactMarkdown>
}

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

/** Turn inline [n] citation markers into superscripts (¹²) for calmer reading. */
export function toSuperscriptCitations(md: string): string {
  return md.replace(/\[(\d{1,2})\]/g, (_m, n: string) =>
    n
      .split('')
      .map((d) => SUP[Number(d)] ?? d)
      .join('')
  )
}
