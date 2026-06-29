import type { LucideIcon } from 'lucide-react'

// Designed empty state for the four surfaces not yet built (Phases 3-5).
// Empty states are features (design principle 1): icon + what it'll do + the
// honest status, in the tab's own accent.
export function Placeholder(props: {
  title: string
  line: string
  icon: LucideIcon
  accent: string
}): JSX.Element {
  const { title, line, icon: Icon, accent } = props
  return (
    <div className="empty">
      <Icon size={40} strokeWidth={1.25} className="empty-icon" style={{ color: accent }} />
      <h2>{title}</h2>
      <p className="muted">{line}</p>
      <span className="pill pending">Coming in a later update</span>
    </div>
  )
}
