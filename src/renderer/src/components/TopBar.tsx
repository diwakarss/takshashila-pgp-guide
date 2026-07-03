import type { TabId } from '../tabs'
import type { CourseSummary } from '../../../shared/ipc'

// Fixed bar above the content. For Tutor it carries the course selector;
// changing the course starts a new conversation (course is locked per thread).
export function TopBar(props: {
  tab: TabId
  courses: CourseSummary[]
  course: string
  onCourse: (code: string) => void
}): JSX.Element {
  const { tab, courses, course, onCourse } = props
  return (
    <div className="topbar">
      {tab === 'tutor' && (
        <label className="course-select">
          <span className="course-select-label">Course</span>
          <select value={course} onChange={(e) => onCourse(e.target.value)} aria-label="Course scope">
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name} ({c.lessons})
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
