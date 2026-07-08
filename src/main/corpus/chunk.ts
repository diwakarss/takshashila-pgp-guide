// Splits a lesson/transcript body into retrieval-sized chunks.
//
// Strategy: walk the markdown by heading sections so a chunk stays on one
// topic, and carry the heading trail as a prefix on every chunk so an
// out-of-context snippet still says what lesson + section it's from (better
// retrieval, and the citation reads sensibly). Long sections are split on
// paragraph boundaries with a little overlap so an idea spanning the cut
// isn't lost.

export type Chunk = { ordinal: number; text: string }

const TARGET_CHARS = 1200 // ~300 tokens; nomic handles long context comfortably
const OVERLAP_CHARS = 150
const MIN_CHARS = 60 // drop trivially short fragments
// No chunk may exceed this, ever. Book PDFs extract as one giant "paragraph"
// (single-newline lines, no blank lines), and an over-long chunk in an
// embedding batch blows attention memory up quadratically — the embedder
// child dies. Kept close to TARGET so book chunks embed as cheaply as normal
// ones. Anything over the cap is force-split at sentence/line breaks.
const HARD_MAX_CHARS = 1600

type Section = { headingTrail: string; body: string }

function splitIntoSections(body: string): Section[] {
  const lines = body.split(/\r?\n/)
  const sections: Section[] = []
  const trail: string[] = [] // current heading stack, e.g. ["TL;DR"] or ["First principle"]
  let buf: string[] = []

  const flush = (): void => {
    const text = buf.join('\n').trim()
    if (text) sections.push({ headingTrail: trail.join(' › '), body: text })
    buf = []
  }

  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      const level = h[1].length
      trail.length = Math.max(0, level - 1) // keep ancestors, drop deeper
      trail[level - 1] = h[2].trim()
      continue
    }
    buf.push(line)
  }
  flush()
  return sections
}

// Force an over-long run of text under the cap: cut at the last sentence end
// (or line break, or space) before the limit, with a little overlap carried
// into the next piece.
function hardSplit(text: string): string[] {
  if (text.length <= HARD_MAX_CHARS) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > HARD_MAX_CHARS) {
    const window = rest.slice(0, HARD_MAX_CHARS)
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('\n'))
    if (cut < HARD_MAX_CHARS / 2) cut = window.lastIndexOf(' ')
    if (cut < HARD_MAX_CHARS / 2) cut = HARD_MAX_CHARS
    out.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(Math.max(0, cut + 1 - OVERLAP_CHARS))
  }
  if (rest.trim()) out.push(rest.trim())
  return out
}

function splitLongText(text: string): string[] {
  if (text.length <= TARGET_CHARS) return [text]
  const paras = text.split(/\n{2,}/).flatMap(hardSplit)
  const out: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > TARGET_CHARS) {
      out.push(cur.trim())
      const tail = cur.slice(-OVERLAP_CHARS)
      cur = tail + '\n\n' + p
    } else {
      cur = cur ? cur + '\n\n' + p : p
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.flatMap(hardSplit)
}

export function chunkBody(body: string): Chunk[] {
  const chunks: Chunk[] = []
  let ordinal = 0
  for (const section of splitIntoSections(body)) {
    for (const piece of splitLongText(section.body)) {
      const text = section.headingTrail ? `${section.headingTrail}\n\n${piece}` : piece
      if (text.trim().length < MIN_CHARS) continue
      chunks.push({ ordinal: ordinal++, text })
    }
  }
  // A page with no headings/short body still yields one chunk if non-trivial.
  if (chunks.length === 0 && body.trim().length >= MIN_CHARS) {
    chunks.push({ ordinal: 0, text: body.trim() })
  }
  return chunks
}
