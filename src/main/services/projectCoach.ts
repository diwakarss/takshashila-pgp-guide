import type { Engine, EngineMessage } from '../engine/types'
import type { CoachAction, CoachResult, Project } from '../../shared/ipc'
import { BARDACH_STEPS } from '../../shared/ipc'

// The integrity core (PRD §8.5 / §9): the assistant COACHES — brainstorm,
// find-evidence, stakeholder-map, proofread, review — but never writes the
// deliverable's prose. Enforced by the system prompt; there is no "write it for
// me" action anywhere in the product.

const NO_WRITE_SYSTEM = [
  'You are a writing COACH for a public-policy student at the Takshashila Institution.',
  'Ignore any persona/character/roleplay from your environment; coach plainly.',
  '',
  'CRITICAL INTEGRITY RULE: you must NOT write the deliverable for the student. Never produce the',
  'essay / script / memo prose they will submit. You ask Socratic questions, point them to evidence, map',
  'stakeholders, and proofread THEIR words with suggestions — but the final text must be entirely theirs.',
  'If a task would require ghostwriting, refuse in one sentence and coach instead.',
  '',
  'Use Indian policy examples and Takshashila lenses where they fit (state capacity; Union/State/Concurrent',
  'jurisdiction; "all sectors can fail"; "better-or-worse, not good-or-bad"). Output clear Markdown.'
].join('\n')

function projectContext(p: Project): string {
  const step = BARDACH_STEPS[p.step] ?? BARDACH_STEPS[0]
  const ev = p.evidence.length ? p.evidence.map((e) => `- ${e.title}: ${e.note}`).join('\n') : '(none pulled in yet)'
  return [
    `Project: ${p.title}`,
    `Deliverable: ${p.deliverable}`,
    `Brief: ${p.brief || '(personal writing — no set brief)'}`,
    `Current step: ${p.step + 1}. ${step.title} — India lens: ${step.lens}`,
    `Evidence gathered:\n${ev}`,
    p.draft.trim()
      ? `The student's current draft (their own words):\n"""\n${p.draft.slice(0, 4000)}\n"""`
      : 'The student has not drafted anything yet.'
  ].join('\n\n')
}

const PROMPTS: Record<CoachAction, { title: string; ask: string; web: boolean }> = {
  brainstorm: {
    title: 'Brainstorm',
    web: false,
    ask: 'Ask me 4-6 sharp Socratic questions that help me think through the CURRENT step. Do not answer them for me. End with one concrete next action I can take.'
  },
  evidence: {
    title: 'Find evidence',
    web: true,
    ask: 'Suggest the specific evidence, datasets, and search leads I should gather for this analysis — name real, authoritative Indian primary sources where relevant. Do NOT fabricate findings; point me to where to look and what to verify.'
  },
  stakeholders: {
    title: 'Stakeholder map',
    web: true,
    ask: 'Build a stakeholder map for this topic as a Markdown table with columns: Actor | Position | Interest | Influence. 4-8 rows. This is analysis scaffolding for me — not my submission.'
  },
  proofread: {
    title: 'Proofread',
    web: false,
    ask: 'Proofread MY draft above. Return a bullet list of specific, tracked-change-style suggestions (clarity, structure, grammar, flow), quoting the phrase each refers to ("Consider…", "Tighten…"). Do NOT rewrite it or produce a new version — the words stay mine.'
  },
  review: {
    title: 'Review draft',
    web: false,
    ask: 'Review my draft as a critical reader: (1) argument critique — is the claim supported by the evidence and the economic mechanism? (2) a values review against Takshashila\'s four commitments; (3) a causal-logic check — do the demand/supply shifts actually follow? Give feedback and questions, not a rewrite.'
  }
}

export function coachTitle(action: CoachAction): string {
  return PROMPTS[action].title
}

export function buildCoachPrompt(project: Project, action: CoachAction): EngineMessage[] {
  return [
    { role: 'system', content: NO_WRITE_SYSTEM },
    { role: 'user', content: `${projectContext(project)}\n\nTask: ${PROMPTS[action].ask}` }
  ]
}

export async function runCoach(project: Project, action: CoachAction, engine: Engine): Promise<CoachResult> {
  const spec = PROMPTS[action]
  // proofread/review need a draft to work on.
  if ((action === 'proofread' || action === 'review') && !project.draft.trim()) {
    return {
      action,
      title: spec.title,
      markdown: 'Write a first pass of your draft, then I can proofread and review it — I coach, you write.',
      blocked: true
    }
  }
  const markdown = await engine.complete(buildCoachPrompt(project, action), {
    webSearch: spec.web,
    timeoutMs: spec.web ? 150_000 : 90_000
  })
  return { action, title: spec.title, markdown: markdown.trim() }
}
