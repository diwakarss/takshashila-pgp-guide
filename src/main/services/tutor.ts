import type { Engine, EngineMessage } from '../engine/types'
import type { SearchHit, TutorAnswer } from '../../shared/ipc'

// Cited-answer flow (Phase 0 mini-Tutor): retrieve top lessons, ground the
// engine on ONLY those sources, ask it to cite them inline as [n]. The UI maps
// [n] back to the source chips. Grounding + "say so if not covered" is the
// citation discipline the AI policy needs (PRD §9), even at this stage.

const MAX_SOURCES = 5
const MAX_SOURCE_CHARS = 800

const SYSTEM = [
  'You are a study tutor for the Takshashila Post Graduate Programme in Public Policy.',
  'Answer the student using ONLY the numbered sources provided. Cite them inline as [1], [2] where each claim comes from.',
  'If the sources do not cover the question, say so plainly rather than guessing.',
  'Be concise, accurate, and scholarly. Do not invent citations.'
].join(' ')

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/** Build the grounded prompt from retrieved hits. Pure — unit tested. */
export function buildTutorPrompt(question: string, hits: SearchHit[]): EngineMessage[] {
  const sources = hits
    .map((h, i) => `[${i + 1}] (${h.title ?? h.slug})\n${truncate(h.text, MAX_SOURCE_CHARS)}`)
    .join('\n\n')
  const user = `Sources:\n${sources}\n\nQuestion: ${question}\n\nAnswer (cite sources as [n]):`
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ]
}

export type TutorDeps = {
  search: (question: string, limit: number) => Promise<SearchHit[]>
  engine: Engine
}

/** Retrieve → ground → answer. Returns the answer plus the sources it was
 *  grounded on (so the UI renders citation chips). */
export async function runTutor(question: string, deps: TutorDeps): Promise<TutorAnswer> {
  const hits = await deps.search(question, MAX_SOURCES)
  if (hits.length === 0) {
    return {
      answer: "I couldn't find anything in the course corpus on that. Try rephrasing, or import the corpus first.",
      sources: [],
      engineId: deps.engine.capabilities.id
    }
  }
  const answer = await deps.engine.complete(buildTutorPrompt(question, hits))
  return { answer, sources: hits, engineId: deps.engine.capabilities.id }
}
