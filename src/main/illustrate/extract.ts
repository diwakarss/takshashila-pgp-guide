import type { Engine } from '../engine/types'
import type { IllustrationSpec } from '../../shared/ipc'

// Concept extraction for the batch library build. Given a course and its lesson
// titles, the model enumerates the concepts that genuinely benefit from a
// hand-drawn illustration, each with a minimal composition brief. The style DNA
// (white-fill analyst etc.) is applied later by the image engine.

function extractSystem(max: number): string {
  return [
    'You list the concepts in a course that would genuinely benefit from a SIMPLE hand-drawn',
    'illustration, for a study app. Ignore any persona; output data only.',
    '',
    `Pick the ${max} MOST illustration-worthy concepts — metaphors, contrasts, processes, trade-offs,`,
    'mechanisms. Skip plain definitions, admin, and pure facts.',
    'For each concept give:',
    '  "title": 3-6 words naming the concept,',
    '  "composition": 2-4 sentences describing a concrete visual — what the white-fill "analyst"',
    '  stick figure is DOING to perform the idea, the metaphor/objects, and 3-5 short English labels.',
    '  (A solid-black figure is only for a malicious/adversarial actor when the concept needs one.)',
    '',
    'Output ONLY a JSON array, no prose/fences: [{"title":"...","composition":"..."}]'
  ].join('\n')
}

function parse(raw: string): { title: string; composition: string }[] {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x) => x && typeof x.title === 'string' && typeof x.composition === 'string')
      .map((x) => ({ title: x.title.trim(), composition: x.composition.trim() }))
  } catch {
    return []
  }
}

/** Enumerate up to `max` illustration-worthy concepts for a course. */
export async function extractConcepts(
  courseName: string,
  lessonTitles: string[],
  engine: Engine,
  max = 12
): Promise<IllustrationSpec[]> {
  const user = [
    `Course: ${courseName}`,
    `Lessons in this course:`,
    ...lessonTitles.map((t) => `- ${t}`),
    '',
    `List up to ${max} illustration-worthy concepts as the JSON array.`
  ].join('\n')
  const raw = await engine.complete(
    [
      { role: 'system', content: extractSystem(max) },
      { role: 'user', content: user }
    ],
    { timeoutMs: 90_000 }
  )
  return parse(raw)
    .slice(0, max)
    .map((c, i) => ({ id: `c-${i}`, title: c.title, composition: c.composition }))
}
