import { describe, it, expect } from 'vitest'
import { xpForAttempt, levelFromXp, currentStreak, bestStreak, dayKey } from './gamify'

describe('xpForAttempt', () => {
  it('rewards correct answers with a clean-sweep bonus', () => {
    expect(xpForAttempt(0, 5)).toBe(0)
    expect(xpForAttempt(3, 5)).toBe(30 + 3) // 3*10 + round(0.6*5)
    expect(xpForAttempt(5, 5)).toBe(65) // 50 + 15 sweep bonus
  })
  it('handles empty quizzes', () => {
    expect(xpForAttempt(0, 0)).toBe(0)
  })
})

describe('levelFromXp', () => {
  it('starts at level 1 with a 100-xp span', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, levelXp: 0, levelSpan: 100 })
    expect(levelFromXp(99)).toMatchObject({ level: 1, levelXp: 99 })
  })
  it('advances on the growing curve (100, 150, 200…)', () => {
    expect(levelFromXp(100)).toMatchObject({ level: 2, levelXp: 0, levelSpan: 150 })
    expect(levelFromXp(250)).toMatchObject({ level: 3, levelXp: 0, levelSpan: 200 })
    expect(levelFromXp(300)).toMatchObject({ level: 3, levelXp: 50 })
  })
})

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak(['2026-07-01', '2026-07-02', '2026-07-03'], '2026-07-03')).toBe(3)
  })
  it('stays alive if the last quiz was yesterday', () => {
    expect(currentStreak(['2026-07-01', '2026-07-02'], '2026-07-03')).toBe(2)
  })
  it('breaks when a full day is missed', () => {
    expect(currentStreak(['2026-06-30'], '2026-07-03')).toBe(0)
  })
  it('is zero with no history', () => {
    expect(currentStreak([], '2026-07-03')).toBe(0)
  })
})

describe('bestStreak', () => {
  it('finds the longest consecutive run', () => {
    expect(bestStreak(['2026-07-01', '2026-07-02', '2026-07-04', '2026-07-05', '2026-07-06'])).toBe(3)
  })
})

describe('dayKey', () => {
  it('formats local Y-M-D zero-padded', () => {
    expect(dayKey(new Date('2026-03-05T10:00:00'))).toBe('2026-03-05')
  })
})
