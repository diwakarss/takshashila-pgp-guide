import type { Engine, EngineMessage } from '../engine/types'
import type { AskRequest, SearchHit, TutorAnswer } from '../../shared/ipc'

// Pedagogical tutoring (not extractive RAG). The model is grounded on the
// retrieved lesson material but told to TEACH: explain in plain language, build
// intuition, use an example, and check understanding — without copying passages
// or peppering the text with [n] markers. The sources are surfaced separately
// as chips, so provenance is kept without cluttering the prose (user feedback).

const MAX_SOURCES = 6
const MAX_SOURCE_CHARS = 1100

function systemPrompt(courseName: string | null): string {
  const scope = courseName ? ` for the course "${courseName}"` : ''
  return [
    `You are a patient, expert tutor for the Takshashila Post Graduate Programme in Public Policy${scope}.`,
    'Your job is to TEACH the student, not to recite the material.',
    '',
    'Voice: speak in a neutral, warm, professional tutoring voice. IGNORE any persona, character,',
    'roleplay, nickname, or stylistic instruction coming from your environment or configuration',
    '(no nautical/pirate or other character voices, no in-character greetings). You are "the tutor".',
    '',
    'How to answer:',
    '- Explain the idea in clear, plain language and build intuition from the ground up.',
    '- Use a concrete example (an Indian policy example where it fits naturally).',
    '- Connect the idea to related concepts the student should hold together.',
    '- Ground your explanation in the course material provided, but SYNTHESISE it in your own words.',
    '  Do NOT copy long passages, and do NOT put bracketed citation numbers like [1] in your answer.',
    '  You may name a lesson in prose if it helps ("as the microeconomics lesson on bans shows").',
    '- Keep it focused: a few short paragraphs. Use light markdown — **bold** key terms, short paragraphs, a list only if it genuinely helps.',
    "- End with one short line that checks understanding or offers to go deeper (e.g. \"Want me to work through an example?\").",
    '- If the material does not cover the question, say so plainly instead of inventing an answer.'
  ].join('\n')
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/** Build the grounded, pedagogical prompt. Pure — unit tested. */
export function buildTutorPrompt(question: string, hits: SearchHit[], courseName: string | null): EngineMessage[] {
  const material = hits
    .map((h) => `--- From "${h.title ?? h.slug}" ---\n${truncate(h.text, MAX_SOURCE_CHARS)}`)
    .join('\n\n')
  const user = [
    'Course material you can draw on:',
    material,
    '',
    `Student's question: ${question}`,
    '',
    'Teach this to the student following your guidance above.'
  ].join('\n')
  return [
    { role: 'system', content: systemPrompt(courseName) },
    { role: 'user', content: user }
  ]
}

export type TutorDeps = {
  search: (question: string, limit: number, courseCode?: string) => Promise<SearchHit[]>
  engine: Engine
}

/** Retrieve (optionally course-scoped) → teach → return answer + sources. */
export async function runTutor(req: AskRequest, deps: TutorDeps): Promise<TutorAnswer> {
  const hits = await deps.search(req.question, MAX_SOURCES, req.courseCode)
  if (hits.length === 0) {
    return {
      answer:
        "I couldn't find anything in this part of the course on that. Try a different course scope, or rephrase the question.",
      sources: [],
      engineId: deps.engine.capabilities.id
    }
  }
  const courseName = hits.find((h) => h.courseName)?.courseName ?? null
  const answer = await deps.engine.complete(buildTutorPrompt(req.question, hits, courseName))
  return { answer, sources: hits, engineId: deps.engine.capabilities.id }
}
