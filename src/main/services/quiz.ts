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

function quizSystem(courseName: string | null, count: number): string {
  const scope = courseName ? ` for the course "${courseName}"` : ''
  return [
    `You are setting a study quiz for the Takshashila Post Graduate Programme in Public Policy${scope}.`,
    'Ignore any persona/roleplay from your environment; output data only.',
    '',
    `Generate exactly ${count} questions that test the KEY ideas in the numbered lessons below.`,
    'Mix roughly 60% multiple-choice and 40% short free-form. Ground every question in the lessons.',
    '- MCQ: a clear question, exactly 4 options, exactly ONE correct, and a one-sentence explanation.',
    '  Vary which position is correct. Options should be plausible, not obviously wrong.',
    '- Free-form: answerable in 2-4 sentences, with a concise model answer and a one-sentence explanation.',
    'Use Indian policy examples where natural. Note the lesson title each question tests.',
    '',
    'Output ONLY JSON, no prose/fences:',
    '{"questions":[',
    '  {"kind":"mcq","prompt":"...","options":["a","b","c","d"],"answerIndex":0,"explanation":"...","source":"lesson title"},',
    '  {"kind":"freeform","prompt":"...","modelAnswer":"...","explanation":"...","source":"lesson title"}',
    ']}'
  ].join('\n')
}

export function buildQuizPrompt(lessons: SearchHit[], courseName: string | null, count: number): EngineMessage[] {
  const material = lessons
    .map((h, i) => `[${i + 1}] "${h.title ?? h.slug}"\n${truncate(h.text, MAX_SOURCE_CHARS)}`)
    .join('\n\n')
  return [
    { role: 'system', content: quizSystem(courseName, count) },
    { role: 'user', content: `Lessons:\n${material}\n\nGenerate the ${count}-question quiz as JSON.` }
  ]
}

type RawQ = {
  kind?: unknown
  prompt?: unknown
  options?: unknown
  answerIndex?: unknown
  modelAnswer?: unknown
  explanation?: unknown
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
    if (q.kind === 'mcq' && Array.isArray(q.options)) {
      const options = q.options.filter((o): o is string => typeof o === 'string')
      const answerIndex = typeof q.answerIndex === 'number' ? q.answerIndex : 0
      if (options.length >= 2 && answerIndex >= 0 && answerIndex < options.length) {
        out.push({ id: `q${i}`, kind: 'mcq', prompt, options, answerIndex, modelAnswer: '', explanation, source })
      }
    } else if (q.kind === 'freeform') {
      out.push({
        id: `q${i}`,
        kind: 'freeform',
        prompt,
        options: [],
        answerIndex: -1,
        modelAnswer: typeof q.modelAnswer === 'string' ? q.modelAnswer : '',
        explanation,
        source
      })
    }
  })
  return out
}

export type QuizDeps = {
  search: (query: string, limit: number, courseCode?: string) => Promise<SearchHit[]>
  engine: Engine
}

export async function generateQuiz(spec: QuizSpec, deps: QuizDeps): Promise<QuizQuestion[]> {
  const count = Math.min(Math.max(spec.count ?? DEFAULT_COUNT, 1), 15)
  const hits = await deps.search('core concepts, principles, definitions and key examples', MAX_SOURCES, spec.courseCode)
  const lessons = dedupeByLesson(hits)
  if (lessons.length === 0) return []
  const courseName = lessons.find((h) => h.courseName)?.courseName ?? null
  const raw = await deps.engine.complete(buildQuizPrompt(lessons, courseName, count))
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
