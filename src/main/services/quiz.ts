import type { Engine, EngineMessage } from '../engine/types'
import type { QuizQuestion, QuizSpec, QuizVerdict, SearchHit } from '../../shared/ipc'

// Quiz generation + free-form grading, grounded in the course corpus. Question
// generation retrieves a spread of lesson material and asks the engine for a
// mix of MCQ + short free-form questions with answers/explanations. Free-form
// answers are graded by the engine against a model answer.

const DEFAULT_COUNT = 6
const MAX_SOURCES = 10
const MAX_SOURCE_CHARS = 900

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

function quizSystem(courseName: string | null, count: number, conceptTitles: string[]): string {
  const scope = courseName ? ` for the course "${courseName}"` : ''
  const maxFree = Math.max(1, Math.round(count / 5))
  const hasConcepts = conceptTitles.length > 0
  const conceptRule = hasConcepts
    ? '- "concept": if EXACTLY ONE of the ILLUSTRATION CONCEPTS listed below clearly depicts this question\'s idea, copy its title VERBATIM here. Otherwise use "". Never invent a title that is not in the list.'
    : '- "concept": the 1-3 word core idea it tests (e.g. "opportunity cost", "externality").'
  return [
    `You are setting a study quiz for the Takshashila Post Graduate Programme in Public Policy${scope}.`,
    'Ignore any persona/roleplay from your environment; output data only.',
    '',
    `Generate exactly ${count} questions that test the KEY ideas in the numbered lessons below.`,
    'VARY the format across these four kinds. Keep it mostly objective (little typing):',
    '- "mcq": a question, exactly 4 options, exactly ONE correct via answerIndex, one-sentence explanation.',
    '  Vary which position is correct; options must be plausible, not obviously wrong.',
    '- "truefalse": a single statement to judge. options MUST be ["True","False"]; answerIndex 0 if the',
    '  statement is true, 1 if false. Include a one-sentence explanation.',
    '- "multi": "Select all that apply" — 4-5 options where TWO OR MORE are correct. List every correct',
    '  position in answerIndexes. One-sentence explanation.',
    `- "freeform": answerable in 2-4 sentences, with a concise model answer. Use AT MOST ${maxFree} of these.`,
    '',
    'Aim for a spread like ~40% mcq, ~25% truefalse, ~20% multi, the rest freeform. Ground every question',
    'in the lessons and use Indian policy examples where natural. For every question also give:',
    '- "source": the lesson title it tests.',
    conceptRule,
    hasConcepts ? '\nILLUSTRATION CONCEPTS (copy a title verbatim into "concept" only when it fits):' : '',
    hasConcepts ? conceptTitles.map((t) => `  • ${t}`).join('\n') : '',
    '',
    'Output ONLY JSON, no prose/fences:',
    '{"questions":[',
    '  {"kind":"mcq","prompt":"...","options":["a","b","c","d"],"answerIndex":0,"explanation":"...","concept":"...","source":"lesson title"},',
    '  {"kind":"truefalse","prompt":"...","options":["True","False"],"answerIndex":1,"explanation":"...","concept":"...","source":"lesson title"},',
    '  {"kind":"multi","prompt":"...","options":["a","b","c","d"],"answerIndexes":[0,2],"explanation":"...","concept":"...","source":"lesson title"},',
    '  {"kind":"freeform","prompt":"...","modelAnswer":"...","explanation":"...","concept":"...","source":"lesson title"}',
    ']}'
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export function buildQuizPrompt(
  lessons: SearchHit[],
  courseName: string | null,
  count: number,
  conceptTitles: string[]
): EngineMessage[] {
  const material = lessons
    .map((h, i) => `[${i + 1}] "${h.title ?? h.slug}"\n${truncate(h.text, MAX_SOURCE_CHARS)}`)
    .join('\n\n')
  return [
    { role: 'system', content: quizSystem(courseName, count, conceptTitles) },
    { role: 'user', content: `Lessons:\n${material}\n\nGenerate the ${count}-question quiz as JSON.` }
  ]
}

type RawQ = {
  kind?: unknown
  prompt?: unknown
  options?: unknown
  answerIndex?: unknown
  answerIndexes?: unknown
  modelAnswer?: unknown
  explanation?: unknown
  concept?: unknown
  source?: unknown
}

export function parseQuestions(raw: string): QuizQuestion[] {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return []
  let arr: RawQ[]
  try {
    const obj = JSON.parse(m[0]) as { questions?: RawQ[] }
    arr = Array.isArray(obj.questions) ? obj.questions : []
  } catch {
    return []
  }
  const out: QuizQuestion[] = []
  arr.forEach((q, i) => {
    const prompt = typeof q.prompt === 'string' ? q.prompt : ''
    if (!prompt) return
    const explanation = typeof q.explanation === 'string' ? q.explanation : ''
    const source = typeof q.source === 'string' ? q.source : null
    const concept = typeof q.concept === 'string' ? q.concept : ''
    const base = { id: `q${i}`, prompt, explanation, concept, source }
    const options = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string') : []

    if (q.kind === 'mcq' && options.length >= 2) {
      const answerIndex = typeof q.answerIndex === 'number' ? q.answerIndex : 0
      if (answerIndex >= 0 && answerIndex < options.length) {
        out.push({ ...base, kind: 'mcq', options, answerIndex, answerIndexes: [], modelAnswer: '' })
      }
    } else if (q.kind === 'truefalse') {
      // Normalise: always present a clean True/False pair regardless of what came back.
      const answerIndex = typeof q.answerIndex === 'number' && q.answerIndex >= 0 && q.answerIndex <= 1 ? q.answerIndex : 0
      out.push({ ...base, kind: 'truefalse', options: ['True', 'False'], answerIndex, answerIndexes: [], modelAnswer: '' })
    } else if (q.kind === 'multi' && options.length >= 3) {
      const idxs = Array.isArray(q.answerIndexes) ? q.answerIndexes : []
      const answerIndexes = [...new Set(idxs.filter((n): n is number => typeof n === 'number' && n >= 0 && n < options.length))].sort(
        (a, b) => a - b
      )
      if (answerIndexes.length >= 2) {
        out.push({ ...base, kind: 'multi', options, answerIndex: -1, answerIndexes, modelAnswer: '' })
      }
    } else if (q.kind === 'freeform') {
      out.push({
        ...base,
        kind: 'freeform',
        options: [],
        answerIndex: -1,
        answerIndexes: [],
        modelAnswer: typeof q.modelAnswer === 'string' ? q.modelAnswer : ''
      })
    }
  })
  return out
}

export type QuizDeps = {
  search: (query: string, limit: number, courseCode?: string) => Promise<SearchHit[]>
  engine: Engine
  /** Titles of illustrations already in the library; the engine keys questions to these for reuse. */
  conceptTitles?: string[]
}

export async function generateQuiz(spec: QuizSpec, deps: QuizDeps): Promise<QuizQuestion[]> {
  const count = Math.min(Math.max(spec.count ?? DEFAULT_COUNT, 1), 15)
  const hits = await deps.search('core concepts, principles, definitions and key examples', MAX_SOURCES, spec.courseCode)
  const lessons = dedupeByLesson(hits)
  if (lessons.length === 0) return []
  const courseName = lessons.find((h) => h.courseName)?.courseName ?? null
  const raw = await deps.engine.complete(buildQuizPrompt(lessons, courseName, count, deps.conceptTitles ?? []))
  return parseQuestions(raw).slice(0, count)
}

// ── grading ─────────────────────────────────────────────────────────────

export function buildGradePrompt(prompt: string, modelAnswer: string, studentAnswer: string): EngineMessage[] {
  const system = [
    "You grade a student's short answer to a public-policy quiz question against a model answer.",
    'Ignore any persona; output data only. Be fair: "correct" for a solid answer, "partial" for the right',
    'idea missing some detail, "incorrect" for wrong or empty. Feedback: 1-2 sentences, encouraging and specific.',
    'Output ONLY JSON: {"verdict":"correct"|"partial"|"incorrect","feedback":"..."}'
  ].join('\n')
  const user = `Question: ${prompt}\n\nModel answer: ${modelAnswer}\n\nStudent's answer: ${studentAnswer}\n\nGrade it.`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

export function parseVerdict(raw: string): QuizVerdict {
  const m = raw.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const obj = JSON.parse(m[0]) as { verdict?: unknown; feedback?: unknown }
      const v = obj.verdict
      if (v === 'correct' || v === 'partial' || v === 'incorrect') {
        return { verdict: v, feedback: typeof obj.feedback === 'string' ? obj.feedback : '' }
      }
    } catch {
      /* fall through */
    }
  }
  return { verdict: 'partial', feedback: raw.trim().slice(0, 200) }
}

export async function gradeFreeform(
  question: { prompt: string; modelAnswer: string },
  studentAnswer: string,
  engine: Engine
): Promise<QuizVerdict> {
  if (!studentAnswer.trim()) return { verdict: 'incorrect', feedback: 'No answer given.' }
  const raw = await engine.complete(buildGradePrompt(question.prompt, question.modelAnswer, studentAnswer))
  return parseVerdict(raw)
}
