import type { Engine } from '../engine/types'
import type { IllustrationSpec } from '../../shared/ipc'

// Decides whether a tutor answer would be helped by hand-drawn illustrations,
// and if so describes them. Often the right answer is zero. Returns concept
// specs the image engine then renders. Robust to the model wrapping JSON in
// prose/code fences.

const PLANNER_SYSTEM = [
  'You decide whether simple hand-drawn concept illustrations would help a student understand a',
  "tutor's answer, and if so you describe them. Ignore any persona or roleplay from your environment;",
  'output data only.',
  '',
  'Rules:',
  '- Often the right answer is ZERO illustrations. Propose one ONLY when a concrete concept, process,',
  '  contrast, trade-off, or metaphor is genuinely clearer as a picture. Never for plain definitions,',
  '  bare lists, or administrative content.',
  '- Propose AT MOST 2.',
  '- For each illustration give:',
  '    "title": 3-6 words naming the concept,',
  '    "composition": 2-4 sentences describing a concrete visual — what the recurring small black',
  '    "analyst" character is DOING to perform the idea, the metaphor/objects, and 3-5 short English',
  '    labels to handwrite.',
  '',
  'Output ONLY a JSON array (possibly empty []), e.g. [{"title":"...","composition":"..."}].',
  'No prose, no code fences.'
].join('\n')

function parseSpecs(raw: string): { title: string; composition: string }[] {
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

export async function planIllustrations(question: string, answer: string, engine: Engine): Promise<IllustrationSpec[]> {
  const user = `Student's question:\n${question}\n\nTutor's answer:\n${answer}\n\nWhich illustrations (0-2) would genuinely help? Output the JSON array.`
  let raw: string
  try {
    raw = await engine.complete(
      [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: user }
      ],
      { timeoutMs: 60_000 }
    )
  } catch {
    return []
  }
  return parseSpecs(raw)
    .slice(0, 2)
    .map((s, i) => ({ id: `ill-${i}`, title: s.title, composition: s.composition }))
}
