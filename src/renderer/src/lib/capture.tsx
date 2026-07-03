import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { BookmarkPlus } from 'lucide-react'
import { Md } from '../components/Markdown'
import { captureSelection } from './selection'
import type { NotebookPageSummary, NoteSource } from '../../../shared/ipc'

// Shared "highlight → Notebook" capture, used by Research and Tutor. A selection
// inside an answer becomes a Markdown snippet (structure preserved), carrying
// ONLY the sources it cites; a floating pill offers to save it to a page.

export type Capture = { text: string; sources: NoteSource[]; from: string }
export type CaptureFn = (capture: Capture, x: number, y: number) => void

// A source paired with its citation number [n] within the answer, so a capture
// keeps only the sources actually cited in the selected span.
export type NumberedSource = { n: number; note: NoteSource }

/** onMouseUp handler for an answer container: turn a selection into a capture,
 *  carrying only the sources whose [n] appears in the selected text. */
export function selectionCapture(
  numbered: NumberedSource[],
  from: string,
  onCapture: CaptureFn
): (e: ReactMouseEvent) => void {
  return (e) => {
    const cap = captureSelection()
    if (!cap || cap.markdown.length < 3) return
    const cited = new Set(cap.cites)
    const sources = cited.size > 0 ? numbered.filter((x) => cited.has(x.n)).map((x) => x.note) : []
    onCapture({ text: cap.markdown, sources, from }, e.clientX, e.clientY)
  }
}

export function useNotebookCapture(onCaptured: () => void): {
  onCapture: CaptureFn
  clearPill: () => void
  ui: JSX.Element
} {
  const [pill, setPill] = useState<{ capture: Capture; x: number; y: number } | null>(null)
  const [picker, setPicker] = useState<Capture | null>(null)
  const [pages, setPages] = useState<NotebookPageSummary[]>([])
  const [pickPage, setPickPage] = useState('') // '' = new page
  const [newTitle, setNewTitle] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const onCapture: CaptureFn = (capture, x, y) => setPill({ capture, x, y })
  const clearPill = (): void => setPill(null)

  const openPicker = (): void => {
    if (!pill) return
    setPicker(pill.capture)
    setPill(null)
    setPickPage('')
    setNewTitle('')
    void window.pgp.notebookList().then(setPages)
    window.getSelection()?.removeAllRanges()
  }

  const saveSnippet = async (): Promise<void> => {
    if (!picker) return
    const page = await window.pgp.addSnippet({
      pageId: pickPage || undefined,
      newTitle: pickPage ? undefined : newTitle,
      text: picker.text,
      sources: picker.sources,
      from: picker.from
    })
    setPicker(null)
    onCaptured()
    setToast(`Saved to “${page?.title ?? 'page'}”`)
    setTimeout(() => setToast(null), 2600)
  }

  const ui = (
    <>
      {pill && (
        <button
          className="capture-pill"
          style={{ left: pill.x, top: pill.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={openPicker}
        >
          <BookmarkPlus size={14} /> Add to Notebook
        </button>
      )}

      {picker && (
        <div className="capture-overlay" onMouseDown={() => setPicker(null)}>
          <div className="capture-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="capture-head">Add to Notebook</div>
            <blockquote className="capture-quote answer-md">
              <Md>{picker.text}</Md>
            </blockquote>
            <label className="capture-field">
              <span className="course-select-label">Page</span>
              <select value={pickPage} onChange={(e) => setPickPage(e.target.value)}>
                <option value="">➕ New page…</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            {!pickPage && (
              <input
                className="input capture-title"
                placeholder="New page title (optional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            )}
            <div className="capture-actions">
              <button className="btn" onClick={() => setPicker(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={saveSnippet}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )

  return { onCapture, clearPill, ui }
}
