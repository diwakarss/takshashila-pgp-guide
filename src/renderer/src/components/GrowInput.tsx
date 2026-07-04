import { useEffect, useRef } from 'react'

const MAX_HEIGHT = 168 // ~6 lines, then it scrolls

// The app's compose field: a single-line-looking textarea that grows with the
// content and caps at MAX_HEIGHT (scrollbar beyond). Enter submits,
// Shift+Enter inserts a newline — chat conventions students already know.
export function GrowInput(props: {
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (v: string) => void
  onSubmit: () => void
}): JSX.Element {
  const { value, placeholder, disabled, onChange, onSubmit } = props
  const ref = useRef<HTMLTextAreaElement>(null)

  // Resize to fit content on every value change (height:auto first so it can shrink).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
  }, [value])

  return (
    <textarea
      ref={ref}
      className="grow-input"
      rows={1}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (value.trim() && !disabled) onSubmit()
        }
      }}
    />
  )
}
