import type { Engine, EngineMessage } from '../engine/types'
import type { CoachAction, CoachResult, Project, ProjectMsg } from '../../shared/ipc'
import { planSteps } from '../../shared/ipc'

// The integrity core (PRD §8.5 / §9): the assistant COACHES — brainstorm,
// find-evidence, stakeholder-map, proofread, review — but never writes the
// deliverable's prose. Enforced by the system prompt; there is no "write it for
// me" action anywhere in the product.

const NO_WRITE_SYSTEM = [
  'You are a research-capable COACH for a public-policy student at the Takshashila Institution.',
  'Ignore any persona/character/roleplay from your environment; coach plainly.',
  'Speak directly TO the student from the first word. Never narrate your own process — no',
  '"Let me present this to the student", no "Good, I have my evidence base" — the student sees',
  'every word you produce.',
  '',
  'CRITICAL INTEGRITY RULE: you must NOT write the deliverable for the student. Never produce the',
  'essay / script / memo prose they will submit. You ask Socratic questions, surface evidence, map',
  'stakeholders, and proofread THEIR words with suggestions — but the final text must be entirely theirs.',
  'If a task would require ghostwriting, refuse in one sentence and coach instead.',
  '',
  'DIVISION OF LABOUR: research is YOUR job — you have web search. When facts, figures, or sources are',
  'needed, fetch them yourself and report the actual findings: the figure, and its source (title + URL).',
  'NEVER assign the student homework like "visit this site" or "look for X" — bring X to them. The',
  "STUDENT's job is what only they may do: evaluate your findings, rationalise, decide, and write.",
  '',
  'Use Indian policy examples and Takshashila lenses where they fit (state capacity; Union/State/Concurrent',
  'jurisdiction; "all sectors can fail"; "better-or-worse, not good-or-bad"). Output clear Markdown.'
].join('\n')

function projectContext(p: Project): string {
  const steps = planSteps(p.plan)
  const step = steps[p.step] ?? steps[0]
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

// ── the guided per-step conversation ───────────────────────────────────────
// Each Bardach step is a live discussion with the coach. The kickoff (first
// message, no user input) has the coach do the step's legwork — research the
// brief, suggest sources, propose criteria — then hand the thinking back to the
// student with questions. Later turns continue the discussion. Notes from
// completed steps are carried forward as context.

type StepChatSpec = { kickoff: string; web: boolean }

const STEP_CHAT: Record<string, StepChatSpec> = {
  define: {
    // Web stays ON for follow-ups too (JD 2026-07-10): brainstorming the
    // framing benefits from live facts; the no-write rule does the guarding.
    web: true,
    kickoff:
      'Research the assignment topic on the web FIRST. Open with a short, cited landscape of the situation (4-6 bullets, concrete figures where you can find them — this saves the student the legwork). Then ask the student 2-3 sharp questions that help THEM pick and frame ONE problem — what exactly, for whom, roughly how big. Rough estimates and placeholders are fine at this step; do NOT ask them to go find data (that is step 2).'
  },
  evidence: {
    web: true,
    kickoff:
      'Do the research NOW, yourself — but be FAST: a handful of well-sourced findings beats an exhaustive hunt. Based on the student’s step-1 definition, find the 4-6 MOST important facts/figures that verify (or contradict) it in ONE search pass (do not keep digging). Report each finding as: the actual figure/fact, and its source (title + URL). Prefer primary/official sources. Flag anything that contradicts their definition. Then hand judgment back: ask which findings convince them, and tell them to save the keepers with "Add evidence". They can always ask "Find more evidence" for another pass. Do NOT assign them reading homework.'
  },
  alternatives: {
    web: true,
    kickoff:
      'Help them construct alternatives: propose 3-4 candidate angles/options grounded in their earlier steps (always including the let-present-trends-continue baseline), one line each on why it is interesting. Then ask which they want to develop and why.'
  },
  // web: true on all steps past define — the coach must be able to backfill a
  // missing fact from a completed step itself instead of deferring to it.
  criteria: {
    web: true,
    kickoff:
      'Propose the judgment criteria that fit THIS assignment (e.g. effectiveness, cost, equity, feasibility, administrative ease) applied concretely to their topic. Ask which 2-3 they will use and what evidence would score them.'
  },
  outcomes: {
    web: true,
    kickoff:
      'For the alternatives they chose (see context), fetch the key magnitudes needed to project outcomes yourself (web) and report them with sources. Sketch the mechanisms to trace and the second-order effects to watch. Then ask them to attempt the projections using those numbers — you check their reasoning, you do not write conclusions for them.'
  },
  tradeoffs: {
    web: true,
    kickoff:
      'Set up the trade-off confrontation: for their front-runner options, name the axes where they genuinely conflict (who gains, who bears the cost). Ask which trade-offs they are willing to accept and why.'
  },
  decide: {
    web: true,
    kickoff:
      'Play the sceptical examiner: ask the 3-4 hardest questions about the position they are leaning towards, grounded in their own evidence. Help them stress-test the decision, not make it for them.'
  },
  story: {
    web: true,
    kickoff:
      'Coach the STRUCTURE of the deliverable — take its FORM from the "Deliverable" line in the context (a video gets timed beats, an essay/post gets sections with word budgets, a memo gets its standard shape); never assume a medium the deliverable does not name. Give beats and structure, never draft text. Ask what their opening line will be, then react to their attempts.'
  },
  // ── explainer-plan steps (analysis assignments: no policy decision to make) ──
  frame: {
    web: false, // kickoff still researches (history-empty turns get web); follow-ups frame, not data-hunt
    kickoff:
      'Research the assignment topic on the web FIRST. Open with a short, cited landscape (4-6 bullets, concrete figures where possible — save the student the legwork), leaning toward NON-OBVIOUS markets and second-order effects, not just the headline ones. Then ask 2-3 sharp questions that help THEM pick ONE market/story and frame it: what shifted, affecting whom, roughly how big. Rough estimates fine; do NOT send them data-hunting (step 2 verifies).'
  },
  mechanics: {
    web: true,
    kickoff:
      'This is the analytical core — economics precision matters most here. Using their framing and evidence (see context), lay out the questions their analysis must answer: which curve shifts, which direction, what magnitude, and the mechanism chain (direct effect → second-order → macro spillover). Fetch any missing magnitudes yourself (web) and report with sources. Then ask THEM to state each shift and trace the chain — you check curve logic ruthlessly (shift OF a curve vs movement ALONG it; demand vs quantity demanded), you do not write their conclusions.'
  },
  angle: {
    web: true,
    kickoff:
      'Help them commit to the deliverable\'s angle IN ONE PASS — this step settles the story choice for good. From their mechanics takeaway, name the 2-3 candidate angles in one line each, the strongest counter-argument against their favourite, and what each angle would force them to CUT for the time/length limit. Then ask them to choose, name the cut, and name the trade-off they accept. Once they state it, tell them to write the takeaway and mark the step done — do not reopen the choice afterwards.'
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function stepContext(p: Project, step: number): string {
  const parts = [
    `Project: ${p.title}`,
    `Deliverable: ${p.deliverable}`,
    `Brief: ${p.brief || '(personal writing — no set brief)'}`
  ]
  // Carry forward the student's takeaways from earlier steps — the thread of
  // their thinking across the flow.
  const steps = planSteps(p.plan)
  const takeaways = steps
    .map((s, i) => ({ s, i, notes: p.stepData[String(i)]?.notes?.trim() }))
    .filter((x) => x.i !== step && x.notes)
    .map((x) => `- Step ${x.i + 1} (${x.s.title}): ${truncate(x.notes as string, 500)}`)
  if (takeaways.length) parts.push(`The student's takeaways so far:\n${takeaways.join('\n')}`)
  if (p.evidence.length) parts.push(`Evidence gathered:\n${p.evidence.map((e) => `- ${e.title} (${e.note})`).join('\n')}`)
  if (p.draft.trim()) parts.push(`Their current working draft (THEIR words):\n"""\n${truncate(p.draft, 3000)}\n"""`)
  const cur = steps[step]
  // The coach must know WHERE the student is in the flow: which steps are
  // settled (behind), and which are still ahead — otherwise it defers work to
  // "step 2" when step 2 is already done (a real bug JD hit on step 4).
  const doneTitles = [...p.done]
    .sort((a, b) => a - b)
    .map((i) => `${i + 1}. ${steps[i]?.title}`)
    .join('; ')
  const aheadTitles = steps
    .slice(step + 1)
    .map((s, j) => `${step + 2 + j}. ${s.title}`)
    .join('; ')
  parts.push(
    `Progress: the student is ON step ${step + 1} of ${steps.length}.` +
      (doneTitles ? ` COMPLETED (behind them): ${doneTitles}.` : ' No steps completed yet.') +
      (aheadTitles ? ` Still AHEAD: ${aheadTitles}.` : ' This is the final step.')
  )
  parts.push(`Current step: ${step + 1}. ${cur.title} — guide: ${cur.guide} — India lens: ${cur.lens}`)
  parts.push(
    [
      `THIS STEP IS DONE WHEN: ${cur.done}.`,
      'Coaching discipline — converge, do not sprawl:',
      '- NO REHASHING: never re-summarize completed steps or restate the student\'s established facts and conclusions — reference them in at most ONE clause and get straight to this step\'s NEW work. The student wrote those takeaways; they do not need them read back.',
      '- Drive every turn toward that output and nothing else. One thread at a time; do not open new angles once the student is close.',
      `- Work that belongs to one of the steps AHEAD (${aheadTitles || 'none'}) must be PARKED, not pursued: say "that's step N work — park it" and return to this step's output.`,
      '- COMPLETED steps are settled material, never future work: build on their takeaways and the evidence list above. NEVER say something "will happen in step N" when step N is behind the student. If a needed fact from a completed step is missing, fetch it yourself NOW (web) and report it with a source.',
      '- When facts ARE this step\'s business, YOU fetch them (web) and report findings with figures + sources. The student never gets sent to visit a site or "look something up" — they evaluate, choose, and decide.',
      '- Rough placeholders are acceptable wherever a step ahead will fill them in.',
      '- The moment the student\'s messages contain the step\'s output, SAY SO — end that reply by telling them to write it in the takeaway box and press "Mark step complete", then stop coaching this step. Do not keep a finished step alive with further questions.'
    ].join('\n')
  )
  return parts.join('\n\n')
}

export function buildStepChatPrompt(project: Project, step: number, history: ProjectMsg[]): EngineMessage[] {
  const spec = STEP_CHAT[planSteps(project.plan)[step].key]
  const messages: EngineMessage[] = [
    { role: 'system', content: NO_WRITE_SYSTEM },
    { role: 'user', content: stepContext(project, step) }
  ]
  if (history.length === 0) {
    messages.push({ role: 'user', content: `Open this step's discussion. ${spec.kickoff}` })
  } else {
    if (!spec.web) {
      // Without this the model invents a "pending permission prompt" when a
      // web tool gets denied — and sends the student hunting for a dialog
      // that doesn't exist (seen live on the first Windows install).
      messages.push({
        role: 'user',
        content:
          'Note: web tools are intentionally OFF for this step — it is a framing/thinking step, not a research one. Never ask the user to grant tool permissions and never mention permission prompts. Where a figure would help, use a clearly-labelled placeholder and note it gets verified in the evidence step.'
      })
    }
    messages.push({
      role: 'assistant',
      content: 'Understood — I am coaching this step with that context.'
    })
    for (const m of history.slice(-12)) {
      messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: truncate(m.text, 2000) })
    }
  }
  return messages
}

export function stepUsesWeb(project: Project, step: number): boolean {
  return STEP_CHAT[planSteps(project.plan)[step]?.key ?? '']?.web ?? false
}

export async function runStepChat(
  project: Project,
  step: number,
  history: ProjectMsg[],
  engine: Engine
): Promise<string> {
  const raw = await engine.complete(buildStepChatPrompt(project, step, history), {
    webSearch: stepUsesWeb(project, step) || history.length === 0,
    // Codex spends far longer browsing than Claude — kickoffs (heavy research)
    // get 6 min, follow-ups 4 (measured: Codex research kickoffs exceed 180s).
    timeoutMs: history.length === 0 ? 360_000 : 240_000
  })
  return raw.trim()
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
    timeoutMs: spec.web ? 240_000 : 90_000
  })
  return { action, title: spec.title, markdown: markdown.trim() }
}
