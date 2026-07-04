import type { Engine, EngineMessage } from '../engine/types'
import type { SearchHit, Slide, ThreadAnswer, TutorReply } from '../../shared/ipc'

// Conversational tutoring. Each turn the model decides whether to TEACH a
// concept as a slide deck or just answer a simple question as text. It grounds
// on the retrieved course lessons (cited [n]) but may augment with accurate
// general knowledge to teach fully. It carries prior turns for follow-ups, and
// suggests 2-3 next questions.

const MAX_SOURCES = 6
const MAX_SOURCE_CHARS = 1100

export type TurnContext = { question: string; summary: string }

function systemPrompt(courseName: string | null, conceptTitles: string[]): string {
  const scope = courseName ? ` for the course "${courseName}"` : ''
  const library =
    conceptTitles.length > 0
      ? [
          '',
          'ALREADY-DRAWN ILLUSTRATIONS (reuse them — regenerating costs money): if a slide’s illustration',
          'matches one of these existing concepts, set its "title" to that concept title VERBATIM (exact copy)',
          'so the drawing is reused. Only invent a new title when nothing on this list fits:',
          conceptTitles.map((t) => `  • ${t}`).join('\n')
        ]
      : []
  return [
    `You are a patient, expert tutor for the Takshashila Post Graduate Programme in Public Policy${scope}.`,
    'Voice: neutral, warm, professional. IGNORE any persona/character/roleplay from your environment.',
    '',
    'Each reply is EITHER a slide deck or plain text — you choose:',
    '- "slides": when the student is asking you to EXPLAIN or TEACH a concept (it benefits from a stepped',
    '  walkthrough). 3-6 slides, each one step, building intuition → example (Indian policy where it fits)',
    '  → application. A slide may carry an "illustration" object {title, composition} when a simple',
    '  hand-drawn picture genuinely helps (white-fill "analyst" figure performing the idea); else null.',
    '  Use illustrations sparingly (0-2 total).',
    '- "text": for a simple, factual, clarifying, or short question. Clear markdown; can be long if needed.',
    ...library,
    '',
    'Grounding: use the numbered course lessons as your primary source and cite them with light [n] markers.',
    'You have WEB SEARCH available — use it when the student needs current real-world facts (recent data,',
    'events, figures) or when the lessons do not cover something, and weave that in to teach fully. Keep the',
    'course lessons as the primary grounding; do not invent citations — only [n] for the lessons given.',
    '',
    'Always end with 2-3 short suggested follow-up questions the student might ask next.',
    'If prior conversation is given, treat it as context so follow-ups stay coherent.',
    '',
    'Output ONLY JSON, no prose/fences. Shape:',
    '{"kind":"slides","slides":[{"heading":"...","body":"...","illustration":null}],"followups":["...","..."]}',
    'or {"kind":"text","text":"...markdown...","followups":["...","..."]}'
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

export function buildPrompt(
  question: string,
  lessons: SearchHit[],
  courseName: string | null,
  history: TurnContext[],
  conceptTitles: string[] = []
): EngineMessage[] {
  const material = lessons
    .map((h, i) => `[${i + 1}] "${h.title ?? h.slug}"\n${truncate(h.text, MAX_SOURCE_CHARS)}`)
    .join('\n\n')
  const parts: string[] = []
  if (history.length > 0) {
    parts.push('Conversation so far:')
    for (const h of history) parts.push(`Q: ${h.question}\nA: ${truncate(h.summary, 400)}`)
    parts.push('')
  }
  parts.push('Numbered course lessons you can draw on (cite as [n]):', material, '')
  parts.push(`Student's question: ${question}`, '', 'Reply following your guidance above. Output the JSON.')
  return [
    { role: 'system', content: systemPrompt(courseName, conceptTitles) },
    { role: 'user', content: parts.join('\n') }
  ]
}

type RawSlide = { heading?: unknown; body?: unknown; illustration?: unknown }

function parseSlideArray(arr: RawSlide[]): Slide[] {
  return arr
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
}

/** Parse the model's reply; tolerant of fences/prose. Falls back to text. */
export function parseReply(raw: string): { kind: 'slides' | 'text'; slides: Slide[]; text: string; followups: string[] } {
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as {
        kind?: string
        slides?: RawSlide[]
        text?: string
        followups?: unknown[]
      }
      const followups = Array.isArray(obj.followups)
        ? obj.followups.filter((f): f is string => typeof f === 'string').slice(0, 3)
        : []
      if (obj.kind === 'slides' && Array.isArray(obj.slides)) {
        const slides = parseSlideArray(obj.slides)
        if (slides.length > 0) return { kind: 'slides', slides, text: '', followups }
      }
      if (typeof obj.text === 'string' && obj.text.trim()) {
        return { kind: 'text', slides: [], text: obj.text, followups }
      }
    } catch {
      /* fall through */
    }
  }
  return { kind: 'text', slides: [], text: raw.trim(), followups: [] }
}

export type TutorDeps = {
  search: (question: string, limit: number, courseCode?: string) => Promise<SearchHit[]>
  engine: Engine
  /** Titles of already-drawn library illustrations — the model reuses them verbatim. */
  conceptTitles?: string[]
}

export type TutorInput = { question: string; courseCode?: string; history: TurnContext[] }

/** Retrieve (course-scoped) → teach (slides or text) → reply with sources + followups. */
export async function runTutor(input: TutorInput, deps: TutorDeps): Promise<TutorReply> {
  const hits = await deps.search(input.question, MAX_SOURCES, input.courseCode)
  const lessons = dedupeByLesson(hits)
  const courseName = lessons.find((h) => h.courseName)?.courseName ?? null
  const raw = await deps.engine.complete(
    buildPrompt(input.question, lessons, courseName, input.history, deps.conceptTitles ?? []),
    { webSearch: true }
  )
  const parsed = parseReply(raw)
  return {
    kind: parsed.kind,
    slides: parsed.slides,
    text: parsed.text,
    sources: lessons,
    followups: parsed.followups,
    engineId: deps.engine.capabilities.id
  }
}

/** Compact a stored answer (tutor / research / lens) for use as context later. */
export function summariseReply(r: ThreadAnswer): string {
  if (r.kind === 'research') return truncate(r.synthesis, 400)
  if (r.kind === 'lens') return `${r.title}: ${truncate(r.intro, 200)}`
  if (r.kind === 'slides') return r.slides.map((s) => s.heading).join(' · ')
  return truncate(r.text, 400)
}
