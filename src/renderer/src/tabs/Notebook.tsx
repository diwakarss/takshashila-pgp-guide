import { useEffect, useRef, useState } from 'react'
import { NotebookPen, Plus, Search, Trash2, ExternalLink } from 'lucide-react'
import { Md } from '../components/Markdown'
import type { NotebookPage, NotebookPageSummary, NoteSource } from '../../../shared/ipc'

// Notebook — the connective tissue between Research and Projects. Titled pages of
// the student's own notes, each carrying the snippets highlighted in from
// Research with their sources, and a bibliography block pinned at the bottom.
export function Notebook(props: { version: number }): JSX.Element {
  const { version } = props
  const [pages, setPages] = useState<NotebookPageSummary[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState<NotebookPage | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null) // snippet id under the cursor
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = (q = query): void => {
    void window.pgp.notebookList(q || undefined).then(setPages)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => refresh(query), 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const select = (id: string): void => {
    setSelectedId(id)
    setConfirmDelete(false)
    void window.pgp.notebookGet(id).then((p) => {
      setPage(p)
      setTitle(p?.title ?? '')
      setBody(p?.body ?? '')
      setSaveState('idle')
    })
  }

  const create = async (): Promise<void> => {
    const p = await window.pgp.notebookCreate()
    refresh()
    setSelectedId(p.id)
    setPage(p)
    setTitle(p.title)
    setBody(p.body)
  }

  // Autosave title/body edits.
  const scheduleSave = (nextTitle: string, nextBody: string): void => {
    if (!selectedId) return
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void window.pgp.notebookUpdate(selectedId, nextTitle, nextBody).then((p) => {
        setSaveState('saved')
        if (p) setPage(p)
        refresh()
      })
    }, 700)
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    await window.pgp.notebookDelete(selectedId)
    setSelectedId(null)
    setPage(null)
    setConfirmDelete(false)
    refresh()
  }

  const sourceKey = (s: NoteSource): string => (s.url || s.title).toLowerCase()
  const bibliography = dedupeSources(page?.snippets.flatMap((s) => s.sources) ?? [])
  // Keys of the sources belonging to the hovered snippet (to highlight them).
  const hoveredKeys = hovered
    ? new Set((page?.snippets.find((s) => s.id === hovered)?.sources ?? []).map(sourceKey))
    : null

  return (
    <div className="notebook">
      <aside className="nb-index">
        <button className="new-conv" onClick={create}>
          <Plus size={15} /> New page
        </button>
        <div className="nb-search">
          <Search size={14} />
          <input placeholder="Search notes + sources…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ul className="nb-list">
          {pages.length === 0 && <li className="recents-empty">{query ? 'No matches' : 'No pages yet'}</li>}
          {pages.map((p) => (
            <li key={p.id}>
              <button className={`nb-item${selectedId === p.id ? ' active' : ''}`} onClick={() => select(p.id)}>
                <span className="nb-item-title">{p.title}</span>
                <span className="nb-item-meta">
                  {p.snippets > 0 ? `${p.snippets} snippet${p.snippets === 1 ? '' : 's'} · ` : ''}
                  {new Date(p.updatedAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="nb-page">
        {!page ? (
          <div className="empty">
            <NotebookPen size={40} strokeWidth={1.25} className="empty-icon" style={{ color: '#5c6675' }} />
            <h2>Your notebook</h2>
            <p className="muted">Highlight anything in Research to start a page — it arrives with its source.</p>
            <button className="btn primary" onClick={create}>
              New page
            </button>
          </div>
        ) : (
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
                title={confirmDelete ? 'Click again to delete' : 'Delete page'}
                onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
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
                <div className="recents-label">Captured from research</div>
                {page.snippets.map((s) => (
                  <blockquote
                    key={s.id}
                    className={`nb-snippet answer-md${hovered === s.id ? ' active' : ''}`}
                    onMouseEnter={() => setHovered(s.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <Md>{s.text}</Md>
                    <footer className="muted small">
                      {s.from}
                      {s.sources.length > 0 && ` · ${s.sources.length} source${s.sources.length === 1 ? '' : 's'}`}
                    </footer>
                  </blockquote>
                ))}
              </div>
            )}

            {bibliography.length > 0 && (
              <div className="nb-biblio">
                <div className="recents-label">Sources / bibliography</div>
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
        )}
      </section>
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
