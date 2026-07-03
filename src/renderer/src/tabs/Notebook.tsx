import { useEffect, useRef, useState } from 'react'
import { NotebookPen, Plus, Search, Trash2, ExternalLink, Pencil } from 'lucide-react'
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
  const [pinned, setPinned] = useState<string | null>(null) // clicked note → filter sources to it
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [confirmSnip, setConfirmSnip] = useState<string | null>(null) // snippet pending delete
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
    setPinned(null)
    setEditingId(null)
    setConfirmSnip(null)
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

  const saveSnippet = async (snippetId: string): Promise<void> => {
    if (!selectedId) return
    const p = await window.pgp.updateSnippet(selectedId, snippetId, editText.trim())
    if (p) setPage(p)
    setEditingId(null)
    refresh()
  }

  const removeSnippet = async (snippetId: string): Promise<void> => {
    if (!selectedId) return
    const p = await window.pgp.deleteSnippet(selectedId, snippetId)
    if (p) setPage(p)
    if (pinned === snippetId) setPinned(null)
    setConfirmSnip(null)
    refresh()
  }

  const sourceKey = (s: NoteSource): string => (s.url || s.title).toLowerCase()
  // Clicking a note pins it → the bibliography shows ONLY that note's sources.
  const pinnedSnippet = pinned ? page?.snippets.find((s) => s.id === pinned) ?? null : null
  const bibliography = dedupeSources(pinnedSnippet ? pinnedSnippet.sources : page?.snippets.flatMap((s) => s.sources) ?? [])
  // When not pinned, hovering a note highlights its sources within the full list.
  const hoveredKeys =
    !pinned && hovered
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
                        {` · ${new Date(s.createdAt).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        })}`}
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
