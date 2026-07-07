import { describe, it, expect } from 'vitest'
import { classifyCourse, parseCourseField, resolveCourse, COURSE_MICRO, COURSE_FUND, COURSE_GENERAL } from './course'

describe('classifyCourse', () => {
  it('maps microeconomics material to PP231', () => {
    for (const slug of [
      'microeconomics-1-20260620-pt1',
      'pgp10-pp231-microeconomics-i',
      'pgp10-lu-03-market-equilibrium-and-law-of-demand',
      'pgp10-lu-04-trade-and-comparative-advantage',
      'pgp-reading-transaction-costs-douglas-allen'
    ]) {
      expect(classifyCourse(slug).code).toBe(COURSE_MICRO.code)
    }
  })

  it('maps public-policy material to PP221', () => {
    for (const slug of [
      'fundamentals-of-public-policy-class-1-20260627-pt1',
      'pgp10-pp221-fundamentals-of-public-policy',
      'pgp10-lu-02-democracy-republic-and-constitution',
      'public-policy-process'
    ]) {
      expect(classifyCourse(slug).code).toBe(COURSE_FUND.code)
    }
  })

  it('falls back to Programme essentials for non-subject pages', () => {
    for (const slug of ['pgp10-3-anti-plagiarism-policy', 'pgp-induction-recording', 'pgp10-important-dates']) {
      expect(classifyCourse(slug).code).toBe(COURSE_GENERAL.code)
    }
  })
})

describe('parseCourseField / resolveCourse', () => {
  it('parses the corpus frontmatter format', () => {
    expect(parseCourseField('PP221: Fundamentals of Public Policy')).toEqual({
      code: 'PP221',
      name: 'Fundamentals of Public Policy'
    })
    expect(parseCourseField('PP231: Microeconomics-I')?.code).toBe('PP231')
  })
  it('rejects junk but accepts code-less series names', () => {
    expect(parseCourseField('')).toBeNull()
    expect(parseCourseField(42)).toBeNull()
    // legacy space tags fall through to the slug heuristic
    expect(parseCourseField('pgp10')).toBeNull()
    expect(parseCourseField('pgp')).toBeNull()
    // code-less series ("Policy Headlines", "Orientation") become their own course
    expect(parseCourseField('Policy Headlines')).toEqual({ code: 'POLICY-HEADLINES', name: 'Policy Headlines' })
    expect(parseCourseField('Orientation')?.code).toBe('ORIENTATION')
  })
  it('canonicalizes the display name per code so both resolve paths agree', () => {
    expect(parseCourseField('PP231: Microeconomics-I')?.name).toBe('Microeconomics I')
    expect(parseCourseField('PP231: Microeconomics I')?.name).toBe('Microeconomics I')
    expect(classifyCourse('microeconomics-1-20260620-pt1').name).toBe('Microeconomics I')
    expect(parseCourseField('PP223: International Relations And Foreign Affairs')?.name).toBe(
      'International Relations and Foreign Affairs'
    )
  })
  it('frontmatter wins over the slug heuristic; heuristic is the fallback', () => {
    expect(resolveCourse({ course: 'PP221: Fundamentals of Public Policy' }, 'pgp-reading-demand-curves').code).toBe('PP221')
    expect(resolveCourse({}, 'pgp-reading-demand-curves').code).toBe('PP231')
    expect(resolveCourse(null, 'pgp-induction-welcome').code).toBe('GENERAL')
  })
})
