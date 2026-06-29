// Course taxonomy for the corpus. The PGP course codes (PP231/PP221) aren't on
// every file's frontmatter, so we DERIVE a course per page from its slug/title.
// Confirmed against the corpus overview pages:
//   pgp10-pp231-microeconomics-i  → PP231 Microeconomics-I
//   pgp10-pp221-fundamentals-...  → PP221 Fundamentals of Public Policy
// Anything not clearly one subject (induction, admin, the long-arc lecture)
// falls to "Programme essentials".

export type Course = { code: string; name: string }

export const COURSE_MICRO: Course = { code: 'PP231', name: 'Microeconomics-I' }
export const COURSE_FUND: Course = { code: 'PP221', name: 'Fundamentals of Public Policy' }
export const COURSE_GENERAL: Course = { code: 'GENERAL', name: 'Programme essentials' }

export const COURSES: Course[] = [COURSE_MICRO, COURSE_FUND, COURSE_GENERAL]

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
