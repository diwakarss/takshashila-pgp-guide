import { BookOpen, CheckSquare, Search, NotebookPen, FileText, type LucideIcon } from 'lucide-react'

// The five surfaces. The unified shell (design D3) keeps everything identical
// across tabs except the per-tab accent (DESIGN §3.1). Adding a tab = adding a
// row here; the sidebar and content area read from this list.
export type TabId = 'tutor' | 'quiz' | 'research' | 'notebook' | 'projects' | 'settings'

export type TabDef = {
  id: TabId
  label: string
  accent: string
  icon: LucideIcon
}

export const NAV_TABS: TabDef[] = [
  { id: 'tutor', label: 'Tutor', accent: 'var(--tutor)', icon: BookOpen },
  { id: 'quiz', label: 'Quiz', accent: '#1d8a66', icon: CheckSquare },
  { id: 'research', label: 'Research', accent: '#b5781a', icon: Search },
  { id: 'notebook', label: 'Notebook', accent: '#5c6675', icon: NotebookPen },
  { id: 'projects', label: 'Projects', accent: '#5a4ab0', icon: FileText }
]
