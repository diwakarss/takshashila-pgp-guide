import type { Engine, EngineMessage } from '../engine/types'
import type { ResearchReply, ResearchSource, SourceType } from '../../shared/ipc'

// Web-first research for policy students. Not tied to the course corpus (Tutor
// covers that) — this answers ANY topic from the live web, but bent toward what
// a public-policy student needs: authoritative/primary sources preferred and
// type-graded, Indian primary sources + India lenses when the topic is Indian
// policy, balanced treatment of contested issues, everything cited.

export type ResearchContext = { question: string; summary: string }

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

function systemPrompt(): string {
  return [
    'You are a research analyst for public-policy students at the Takshashila Institution.',
    'Ignore any persona/character/roleplay from your environment; output data only.',
    '',
    'The student asks a research question — ANY topic they want to pursue (this is NOT limited to their',
    'coursework). Use WEB SEARCH to gather current, authoritative information and synthesise a clear,',
    'balanced answer they can cite in policy work.',
    '',
    'Priorities for policy research:',
    '- Prefer PRIMARY and AUTHORITATIVE sources — government/official, official statistics/data, academic,',
    '  and reputable think-tanks — over blogs and opinion. If a key claim rests on a weak source, say so.',
    '- For questions about INDIAN policy, prioritise Indian primary sources (PIB, data.gov.in, RBI, NITI',
    '  Aayog, PRS Legislative Research, ministry/gazette sites) and, where it fits, note the state-capacity',
    '  angle and whether the matter is a Union, State, or Concurrent subject.',
    '- Be balanced: where a policy is contested, represent the main sides fairly rather than taking one.',
    '- Cite EVERYTHING inline with [n] markers tied to the numbered sources. Never invent sources or',
    '  citations; only cite pages you actually used.',
    '',
    'Classify each source\'s type as exactly one of: government, data, academic, thinktank, news, other.',
    'Include a date (YYYY or YYYY-MM) when you can determine it.',
    '',
    'End with 2-3 policy-oriented follow-up questions the student might pursue next (e.g. the stakeholders,',
    'what the data says, the strongest counter-argument, cross-country/state comparisons, the legal or',
    'constitutional angle).',
    '',
    'Output ONLY JSON, no prose or code fences. Shape:',
    '{"synthesis":"...markdown with [1][2] citations...",' +
      '"sources":[{"n":1,"title":"...","url":"https://...","type":"government","date":"2024"}],' +
      '"followups":["...","..."]}'
  ].join('\n')
}

export function buildResearchPrompt(question: string, history: ResearchContext[]): EngineMessage[] {
  const parts: string[] = []
  if (history.length > 0) {
    parts.push('Conversation so far:')
    for (const h of history) parts.push(`Q: ${h.question}\nA: ${truncate(h.summary, 400)}`)
    parts.push('')
  }
  parts.push(`Research question: ${question}`, '', 'Search the web and reply with the JSON described above.')
  return [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: parts.join('\n') }
  ]
}

// Domain signals are high-confidence, so they override the model's self-reported
// type; otherwise we trust the model, falling back to 'other'.
const DOMAIN_RULES: { type: SourceType; test: RegExp }[] = [
  { type: 'data', test: /(^|\.)data\.gov(\.[a-z.]+)?$|(^|\.)(mospi|censusindia)\.|ourworldindata\.org$|(^|\.)data\.worldbank\.org$|(^|\.)data\.imf\.org$|statista\.com$/i },
  { type: 'government', test: /\.gov(\.[a-z]{2,})?$|(^|\.)nic\.in$|(^|\.)(rbi|sebi|trai)\.org\.in$|(^|\.)(pib|niti)\.gov\.in$|europa\.eu$|(^|\.)un\.org$|(^|\.)who\.int$/i },
  { type: 'academic', test: /\.edu$|\.ac\.[a-z]{2,}$|(^|\.)(jstor|ssrn|nber|arxiv|springer|wiley|sciencedirect|tandfonline|cambridge|oup|academic\.oup)\.|scholar\.google\./i },
  { type: 'thinktank', test: /(^|\.)(takshashila|prsindia|orfonline|cprindia|idfcinstitute|ncaer|brookings|carnegieendowment|cgdev|rand|piie|chathamhouse|bruegel)\./i }
]

export function classifySource(url: string, modelType?: string): SourceType {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    /* malformed url — fall back to the model's type */
  }
  if (host) {
    for (const rule of DOMAIN_RULES) if (rule.test.test(host)) return rule.type
  }
  const valid: SourceType[] = ['government', 'data', 'academic', 'thinktank', 'news', 'other']
  return valid.includes(modelType as SourceType) ? (modelType as SourceType) : 'other'
}

type RawSource = { n?: unknown; title?: unknown; url?: unknown; type?: unknown; date?: unknown }

export function parseResearch(raw: string): { synthesis: string; sources: ResearchSource[]; followups: string[] } {
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as { synthesis?: unknown; sources?: RawSource[]; followups?: unknown[] }
      const synthesis = typeof obj.synthesis === 'string' ? obj.synthesis.trim() : ''
      const followups = Array.isArray(obj.followups)
        ? obj.followups.filter((f): f is string => typeof f === 'string').slice(0, 3)
        : []
      const sources: ResearchSource[] = []
      if (Array.isArray(obj.sources)) {
        obj.sources.forEach((s) => {
          const title = typeof s.title === 'string' ? s.title.trim() : ''
          const url = typeof s.url === 'string' ? s.url.trim() : ''
          if (!title || !url) return
          sources.push({
            n: sources.length + 1, // renumber densely so [n] ↔ list stays consistent
            title,
            url,
            type: classifySource(url, typeof s.type === 'string' ? s.type : undefined),
            date: typeof s.date === 'string' && s.date.trim() ? s.date.trim() : undefined
          })
        })
      }
      if (synthesis) return { synthesis, sources, followups }
    } catch {
      /* fall through to raw */
    }
  }
  return { synthesis: raw.trim(), sources: [], followups: [] }
}

export type ResearchDeps = { engine: Engine }
export type ResearchInput = { question: string; history: ResearchContext[] }

/** Web research → cited, type-graded synthesis + policy follow-ups. */
export async function runResearch(input: ResearchInput, deps: ResearchDeps): Promise<ResearchReply> {
  const raw = await deps.engine.complete(buildResearchPrompt(input.question, input.history), {
    webSearch: true,
    timeoutMs: 180_000
  })
  const parsed = parseResearch(raw)
  return {
    kind: 'research',
    synthesis: parsed.synthesis,
    sources: parsed.sources,
    followups: parsed.followups,
    engineId: deps.engine.capabilities.id
  }
}

/** Compact a research reply for use as context in later turns. */
export function summariseResearch(r: ResearchReply): string {
  return truncate(r.synthesis, 400)
}
