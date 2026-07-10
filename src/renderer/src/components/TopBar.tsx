import { ChevronLeft } from 'lucide-react'
import type { TabId } from '../tabs'
import type { CourseSummary } from '../../../shared/ipc'

/** Back-navigation state for the bar: present when the active tab has an item
 *  (thread / page / project) open; onBack returns to that tab's landing. */
export type TopNav = { label: string; onBack: () => void } | null

// Fixed bar above the content — the uniform navigation row for every tab.
// When something is open it carries "‹ <tab>" on the left; Tutor's course
// selector appears ONLY on the new-conversation landing (course is locked per
// thread — inside a thread it becomes a read-only chip).
export function TopBar(props: {
  tab: TabId
  courses: CourseSummary[]
  course: string
  onCourse: (code: string) => void
  nav: TopNav
}): JSX.Element {
  const { tab, courses, course, onCourse, nav } = props
  const openCourse = courses.find((c) => c.code === course)
  return (
    <div className="topbar">
      {nav && (
        <button className="btn ghost topbar-back" onClick={nav.onBack}>
          <ChevronLeft size={16} /> {nav.label}
        </button>
      )}
      {tab === 'tutor' && !nav && (
        <label className="course-select">
          <span className="course-select-label">Course</span>
          <select value={course} onChange={(e) => onCourse(e.target.value)} aria-label="Course scope">
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.code} value={c.code}>
                {/^PP\d/.test(c.code) ? `${c.code} · ${c.name}` : c.name} ({c.lessons})
              </option>
            ))}
          </select>
        </label>
      )}
      {tab === 'tutor' && nav && (
        <span className="topbar-chip" title="This conversation's course (fixed per thread)">
          {openCourse ? `${openCourse.code} · ${openCourse.name}` : 'All courses'}
        </span>
      )}
    </div>
  )
}
