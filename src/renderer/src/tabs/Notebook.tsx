import { useEffect, useRef, useState } from 'react'
import { NotebookPen, Trash2, ExternalLink, Pencil } from 'lucide-react'
import { Md } from '../components/Markdown'
import type { NotebookPage, NoteSource } from '../../../shared/ipc'

// Notebook — the connective tissue between Research and Projects. The page index
// + search live in the sidebar (uniform with other tabs); this renders the open
// page: the student's notes, the captured snippets (each with its sources), and
// a bibliography block. Click a note to filter the bibliography to its sources.
export function Notebook(props: {
  openId: string | null
  onOpenNotebook: (id: string | null) => void
  onChanged: () => void
}): JSX.Element {
  const { openId, onOpenNotebook, onChanged } = props
  const [page, setPage] = useState<NotebookPage | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [confirmSnip, setConfirmSnip] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setPinned(null)
    setEditingId(null)
    setConfirmSnip(null)
    setConfirmDelete(false)
    if (!openId) {
      setPage(null)
      return
    }
    void window.pgp.notebookGet(openId).then((p) => {
      setPage(p)
      setTitle(p?.title ?? '')
      setBody(p?.body ?? '')
      setSaveState('idle')
    })
  }, [openId])

  const create = async (): Promise<void> => {
    const p = await window.pgp.notebookCreate()
    onOpenNotebook(p.id)
    onChanged()
  }

  const scheduleSave = (nextTitle: string, nextBody: string): void => {
    if (!openId) return
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void window.pgp.notebookUpdate(openId, nextTitle, nextBody).then((p) => {
        setSaveState('saved')
        if (p) setPage(p)
        onChanged()
      })
    }, 700)
  }

  const removePage = async (): Promise<void> => {
    if (!openId) return
    await window.pgp.notebookDelete(openId)
    onOpenNotebook(null)
    onChanged()
  }

  const saveSnippet = async (snippetId: string): Promise<void> => {
    if (!openId) return
    const p = await window.pgp.updateSnippet(openId, snippetId, editText.trim())
    if (p) setPage(p)
    setEditingId(null)
    onChanged()
  }

  const removeSnippet = async (snippetId: string): Promise<void> => {
    if (!openId) return
    const p = await window.pgp.deleteSnippet(openId, snippetId)
    if (p) setPage(p)
    if (pinned === snippetId) setPinned(null)
    setConfirmSnip(null)
    onChanged()
  }

  if (!page) {
    return (
      <div className="empty">
        <NotebookPen size={40} strokeWidth={1.25} className="empty-icon" style={{ color: '#5c6675' }} />
        <h2>Your notebook</h2>
        <p className="muted">Pick a page from the left, or highlight anything in Research to start one.</p>
        <button className="btn primary" onClick={create}>
          New page
        </button>
      </div>
    )
  }

  const sourceKey = (s: NoteSource): string => (s.url || s.title).toLowerCase()
  const pinnedSnippet = pinned ? page.snippets.find((s) => s.id === pinned) ?? null : null
  const bibliography = dedupeSources(pinnedSnippet ? pinnedSnippet.sources : page.snippets.flatMap((s) => s.sources))
  const hoveredKeys =
    !pinned && hovered
      ? new Set((page.snippets.find((s) => s.id === hovered)?.sources ?? []).map(sourceKey))
      : null

  return (
    <div className="nb-solo">
      <div className="nb-page-inner">
        <div className="nb-page-head">
          <input
            className="nb-title"
            value={title}
            placeholder="Page title"
            onChange={(e) => {
              setTitle(e.target.value)
              scheduleSave(e.target.value, body)
            }}
          />
          <span className="nb-save muted small">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : ''}
          </span>
          <button
            className={`icon-btn nb-del${confirmDelete ? ' danger' : ''}`}
            title={confirmDelete ? 'Click again to delete this page' : 'Delete page'}
            onClick={() => (confirmDelete ? void removePage() : setConfirmDelete(true))}
            onBlur={() => setConfirmDelete(false)}
          >
            <Trash2 size={16} />
          </button>
        </div>

        <textarea
          className="nb-body"
          placeholder="Your notes…"
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            scheduleSave(title, e.target.value)
          }}
        />

        {page.snippets.length > 0 && (
          <div className="nb-snippets">
            <div className="recents-label">Captured notes</div>
            {page.snippets.map((s) =>
              editingId === s.id ? (
                <div key={s.id} className="nb-snippet editing">
                  <textarea
                    className="nb-snippet-edit"
                    value={editText}
                    autoFocus
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="nb-snippet-actions">
                    <button className="btn" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                    <button className="btn primary" onClick={() => void saveSnippet(s.id)}>
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <blockquote
                  key={s.id}
                  className={`nb-snippet answer-md${pinned === s.id ? ' pinned' : ''}${
                    !pinned && hovered === s.id ? ' active' : ''
                  }`}
                  title="Click to show only this note’s sources"
                  onMouseEnter={() => setHovered(s.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setPinned((p) => (p === s.id ? null : s.id))}
                >
                  <div className="nb-snippet-tools" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="icon-btn"
                      title="Edit note"
                      onClick={() => {
                        setEditingId(s.id)
                        setEditText(s.text)
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className={`icon-btn${confirmSnip === s.id ? ' danger' : ''}`}
                      title={confirmSnip === s.id ? 'Click again to delete' : 'Delete note'}
                      onClick={() => (confirmSnip === s.id ? void removeSnippet(s.id) : setConfirmSnip(s.id))}
                      onBlur={() => setConfirmSnip(null)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <Md>{s.text}</Md>
                  <footer className="muted small">
                    {s.from}
                    {s.sources.length > 0 && ` · ${s.sources.length} source${s.sources.length === 1 ? '' : 's'}`}
                    {` · ${new Date(s.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
                  </footer>
                </blockquote>
              )
            )}
          </div>
        )}

        {bibliography.length > 0 && (
          <div className="nb-biblio">
            <div className="nb-biblio-head">
              <span className="recents-label">{pinned ? 'Sources for this note' : 'Sources / bibliography'}</span>
              {pinned && (
                <button className="nb-showall" onClick={() => setPinned(null)}>
                  Show all
                </button>
              )}
            </div>
            <ol className="source-list">
              {bibliography.map((s, i) => {
                const on = hoveredKeys?.has(sourceKey(s))
                const cls = hoveredKeys ? (on ? ' highlight' : ' dim') : ''
                return (
                  <li key={i} className={`source-line${cls}`}>
                    <span className="source-num">{i + 1}</span>
                    {s.url ? (
                      <a className="source-line-title" href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                        {s.title}
                        <ExternalLink size={12} className="source-ext" />
                      </a>
                    ) : (
                      <span className="source-line-title">{s.title}</span>
                    )}
                    <span className={`src-badge ${s.kind}`}>{s.kind}</span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

function dedupeSources(sources: NoteSource[]): NoteSource[] {
  const seen = new Set<string>()
  const out: NoteSource[] = []
  for (const s of sources) {
    const key = (s.url || s.title).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}
