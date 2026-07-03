// Pure gamification math for the quiz: XP → level curve and day-streak counting.
// Kept side-effect-free (today is passed in) so it's cheap to unit-test.

/** XP awarded for a finished quiz. Correct answers are worth 10; the quiz-level
 *  accuracy adds a small bonus so a clean sweep is rewarded over a scrappy one. */
export function xpForAttempt(correct: number, total: number): number {
  if (total <= 0) return 0
  const base = correct * 10
  const bonus = correct === total ? 15 : Math.round((correct / total) * 5)
  return Math.round(base + bonus)
}

/** Level curve: span grows by 50 XP each level (100, 150, 200, …). Given total
 *  XP, return the current level and progress within it. Level is 1-indexed. */
export function levelFromXp(xp: number): { level: number; levelXp: number; levelSpan: number } {
  let level = 1
  let start = 0
  let span = 100
  while (xp >= start + span) {
    start += span
    level += 1
    span = 100 + (level - 1) * 50
  }
  return { level, levelXp: Math.max(0, Math.round(xp - start)), levelSpan: span }
}

/** A UTC-free YYYY-MM-DD key for a date. */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Current streak: consecutive calendar days (ending today or yesterday) that
 *  each have at least one quiz. `days` is a set/list of YYYY-MM-DD keys. */
export function currentStreak(days: Iterable<string>, today: string): number {
  const set = new Set(days)
  if (set.size === 0) return 0
  // Anchor to today if there's a quiz today, else yesterday (a streak stays
  // alive until a full day is missed). Otherwise it's broken.
  const cursor = new Date(`${today}T00:00:00`)
  if (!set.has(today)) {
    cursor.setDate(cursor.getDate() - 1)
    if (!set.has(dayKey(cursor))) return 0
  }
  let streak = 0
  while (set.has(dayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** Longest run of consecutive days anywhere in the history. */
export function bestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort()
  let best = 0
  let run = 0
  let prev: Date | null = null
  for (const key of sorted) {
    const d = new Date(`${key}T00:00:00`)
    if (prev) {
      const next = new Date(prev)
      next.setDate(next.getDate() + 1)
      run = dayKey(next) === key ? run + 1 : 1
    } else {
      run = 1
    }
    best = Math.max(best, run)
    prev = d
  }
  return best
}
