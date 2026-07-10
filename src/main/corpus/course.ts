// Course taxonomy for the corpus. The PGP course codes (PP231/PP221) aren't on
// every file's frontmatter, so we DERIVE a course per page from its slug/title.
// Confirmed against the corpus overview pages:
//   pgp10-pp231-microeconomics-i  → PP231 Microeconomics-I
//   pgp10-pp221-fundamentals-...  → PP221 Fundamentals of Public Policy
// Anything not clearly one subject (induction, admin, the long-arc lecture)
// falls to "Programme essentials".

export type Course = { code: string; name: string }

export const COURSE_MICRO: Course = { code: 'PP231', name: 'Microeconomics I' }
export const COURSE_FUND: Course = { code: 'PP221', name: 'Fundamentals of Public Policy' }
export const COURSE_GENERAL: Course = { code: 'GENERAL', name: 'Programme essentials' }

export const COURSES: Course[] = [COURSE_MICRO, COURSE_FUND, COURSE_GENERAL]

// One display name per code, no matter which path resolved it — frontmatter
// and the slug heuristic must agree or the courses list shows duplicates
// (seen live: "Microeconomics I" and "Microeconomics-I" as two courses).
const CANONICAL_NAMES: Record<string, string> = {
  PP231: 'Microeconomics I',
  PP221: 'Fundamentals of Public Policy',
  PP223: 'International Relations and Foreign Affairs'
}

// Course lists follow the OpenTakshashila hub's top-to-bottom order so the
// app never presents a random ordering students have to re-learn. Unknown
// codes sort after these, alphabetically.
const HUB_ORDER = ['GENERAL', 'ORIENTATION', 'AD-HOC-POLICY-SESSIONS', 'POLICY-HEADLINES', 'PP231', 'PP221', 'PP223']

export function courseRank(code: string): number {
  const c = code.toUpperCase()
  // Session-qualified series ("POLICY-HEADLINES-DELIMITATION", "AD-HOC-LONG-ARC-…")
  // rank with their container so the hub order survives qualification.
  const i = HUB_ORDER.findIndex((h) => c === h || c.startsWith(h) || (h.startsWith('AD-HOC') && c.startsWith('AD-HOC')))
  return i === -1 ? HUB_ORDER.length : i
}

const MICRO_RE =
  /microeconom|pp231|economic-reasoning|price-value|price-and-cost|law-of-demand|\bdemand\b|market-equilibrium|comparative-advantage|\btrade\b|government-intervention-in-markets|transaction-cost|elasticit|\bsupply\b|opportunity-cost|incentive/
const FUND_RE =
  /fundamentals-of-public-policy|pp221|nation-state|democracy|republic|constitution|structure-and-goals|public-policy-process|policy-process|state-capacity|federal|jurisdiction/

/** Assign a page to a course from its slug (+ optional title). */
export function classifyCourse(slug: string, title?: string | null): Course {
  const s = `${slug} ${title ?? ''}`.toLowerCase()
  if (MICRO_RE.test(s)) return COURSE_MICRO
  if (FUND_RE.test(s)) return COURSE_FUND
  return COURSE_GENERAL
}

/** Parse an explicit frontmatter course field. Accepts coded courses
 *  ("PP221: Fundamentals of Public Policy") and code-less series names
 *  ("Policy Headlines", "Orientation") — those become their own course with a
 *  derived code. Legacy space tags like "pgp10" fall through to the slug
 *  heuristic. Null when absent/unparseable. */
export function parseCourseField(v: unknown): Course | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  const m = s.match(/^([A-Z]{2,4}\s?\d{2,4})\s*[:\-–—]\s*(.+)$/)
  if (m) {
    const code = m[1].replace(/\s+/g, '')
    return { code, name: CANONICAL_NAMES[code] ?? m[2].trim() }
  }
  const known = COURSES.find((c) => c.code.toLowerCase() === s.toLowerCase())
  if (known) return known
  if (/^pgp/i.test(s) || s.length < 4) return null
  return { code: s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40), name: s }
}

/** The course for a page: explicit frontmatter wins; the slug heuristic is the
 *  fallback for pages that predate the course field. */
export function resolveCourse(
  frontmatter: Record<string, unknown> | null | undefined,
  slug: string,
  title?: string | null
): Course {
  return parseCourseField(frontmatter?.['course']) ?? classifyCourse(slug, title)
}
