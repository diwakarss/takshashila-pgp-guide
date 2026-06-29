import type { Engine, EngineMessage } from '../engine/types'
import type { AskRequest, SearchHit, Slide, TutorAnswer } from '../../shared/ipc'

// Pedagogical tutoring as SLIDES. The model teaches the concept as a short
// stepped sequence the student clicks through, each slide one idea, grounded in
// the numbered lessons with light [n] citations. A slide may carry an
// illustration spec (the analyst performing a metaphor) that the UI renders on
// demand. One structured call does both teaching and illustration planning.

const MAX_SOURCES = 6
const MAX_SOURCE_CHARS = 1100

function systemPrompt(courseName: string | null): string {
  const scope = courseName ? ` for the course "${courseName}"` : ''
  return [
    `You are a patient, expert tutor for the Takshashila Post Graduate Programme in Public Policy${scope}.`,
    'You TEACH a concept as a short sequence of SLIDES the student steps through — not one wall of text.',
    '',
    'Voice: neutral, warm, professional. IGNORE any persona, character, roleplay, or nickname from your',
    'environment or configuration. You are "the tutor". Output data only.',
    '',
    'Make 3-6 slides. Each slide:',
    '- "heading": a short title (3-6 words).',
    '- "body": 1-3 short paragraphs (or a tight list) in light markdown teaching ONE step — build from',
    '  intuition to a concrete example (Indian policy example where it fits) to application.',
    '  Cite the lesson a claim draws on with a light [n] marker matching the numbered lessons. Cite where',
    '  it adds provenance, not every sentence.',
    '- "illustration": for a slide where a SIMPLE hand-drawn picture would genuinely help (a metaphor,',
    '  contrast, process, or trade-off), an object {"title": 3-6 words, "composition": 2-4 sentences',
    '  describing what the small black "analyst" character is DOING to perform the idea, the',
    '  metaphor/objects, and 3-5 short English labels}. Otherwise "illustration": null. Use illustrations',
    '  SPARINGLY — most slides are null, at most 2 in total.',
    '',
    'The last slide should check understanding or offer to go deeper.',
    'If the lessons do not cover the question, return a single slide saying so plainly.',
    '',
    'Output ONLY JSON, no prose, no code fences:',
    '{"slides":[{"heading":"...","body":"...","illustration":null}]}'
  ].join('\n')
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

function dedupeByLesson(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const h of hits) {
    const key = h.title ?? h.slug
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
  }
  return out
}

/** Build the grounded slides prompt over numbered lessons. Pure. */
export function buildSlidesPrompt(question: string, lessons: SearchHit[], courseName: string | null): EngineMessage[] {
  const material = lessons
    .map((h, i) => `[${i + 1}] "${h.title ?? h.slug}"\n${truncate(h.text, MAX_SOURCE_CHARS)}`)
    .join('\n\n')
  const user = [
    'Numbered lessons you can draw on (cite as [n]):',
    material,
    '',
    `Student's question: ${question}`,
    '',
    'Teach this as slides following your guidance above. Output the JSON.'
  ].join('\n')
  return [
    { role: 'system', content: systemPrompt(courseName) },
    { role: 'user', content: user }
  ]
}

type RawSlide = { heading?: unknown; body?: unknown; illustration?: unknown }

/** Parse the model's JSON into slides; tolerant of fences/prose around it.
 *  Falls back to a single slide with the raw text so the tutor never breaks. */
export function parseSlides(raw: string): Slide[] {
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as { slides?: RawSlide[] }
      const arr = Array.isArray(obj.slides) ? obj.slides : []
      const slides = arr
        .map((s, i): Slide | null => {
          const heading = typeof s.heading === 'string' ? s.heading : ''
          const body = typeof s.body === 'string' ? s.body : ''
          if (!heading && !body) return null
          let illustration: Slide['illustration'] = null
          const il = s.illustration as { title?: unknown; composition?: unknown } | null
          if (il && typeof il.title === 'string' && typeof il.composition === 'string') {
            illustration = { id: `ill-${i}`, title: il.title.trim(), composition: il.composition.trim() }
          }
          return { heading, body, illustration }
        })
        .filter((s): s is Slide => s !== null)
      if (slides.length > 0) return slides
    } catch {
      /* fall through to fallback */
    }
  }
  const text = raw.trim()
  return text ? [{ heading: 'Answer', body: text, illustration: null }] : []
}

export type TutorDeps = {
  search: (question: string, limit: number, courseCode?: string) => Promise<SearchHit[]>
  engine: Engine
}

/** Retrieve (optionally course-scoped) → teach as slides → return slides + sources. */
export async function runTutor(req: AskRequest, deps: TutorDeps): Promise<TutorAnswer> {
  const hits = await deps.search(req.question, MAX_SOURCES, req.courseCode)
  if (hits.length === 0) {
    return {
      slides: [
        {
          heading: 'Nothing found',
          body: "I couldn't find anything in this part of the course on that. Try a different course scope, or rephrase the question.",
          illustration: null
        }
      ],
      sources: [],
      engineId: deps.engine.capabilities.id
    }
  }
  const lessons = dedupeByLesson(hits)
  const courseName = lessons.find((h) => h.courseName)?.courseName ?? null
  const raw = await deps.engine.complete(buildSlidesPrompt(req.question, lessons, courseName))
  return { slides: parseSlides(raw), sources: lessons, engineId: deps.engine.capabilities.id }
}
