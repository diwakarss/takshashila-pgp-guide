import { parse as parseYaml } from 'yaml'
import { createHash } from 'node:crypto'

// Parses one gbrain markdown file (the pgp-brain format):
//
//   ---
//   type: study-notes
//   title: Microeconomics-1 (Part 1/2)
//   captured_at: '2026-06-20T...'
//   ...
//   ---
//   <body markdown>
//   ## Related
//   - [[some-other-slug]]
//
// Frontmatter → page metadata; `## Related [[wikilinks]]` → edges.

export type ParsedPage = {
  slug: string
  type: string | null
  title: string | null
  capturedAt: string | null
  frontmatter: Record<string, unknown>
  body: string
  contentHash: string
  edges: string[] // target slugs from [[wikilinks]] under ## Related
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Strip a trailing `.md` and any directory prefix to get the slug. */
export function slugFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/i, '')
}

function extractRelatedEdges(body: string): string[] {
  // Find a "## Related" heading and collect [[wikilink]] targets until the
  // next heading of the same-or-higher level.
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  let inRelated = false
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const isRelated = /^related\b/i.test(heading[2].trim())
      inRelated = isRelated
      continue
    }
    if (inRelated) {
      const re = /\[\[([^\]]+)\]\]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        // [[slug|alias]] -> slug
        out.push(m[1].split('|')[0].trim())
      }
    }
  }
  return [...new Set(out)]
}

export function parsePage(path: string, raw: string): ParsedPage {
  const slug = slugFromPath(path)
  const contentHash = createHash('sha256').update(raw).digest('hex').slice(0, 16)

  let frontmatter: Record<string, unknown> = {}
  let body = raw
  const fm = FRONTMATTER_RE.exec(raw)
  if (fm) {
    try {
      const parsed = parseYaml(fm[1])
      if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>
    } catch {
      // Malformed frontmatter shouldn't drop the whole page — keep the body,
      // lose the metadata. Better a less-tagged lesson than a missing one.
      frontmatter = {}
    }
    body = raw.slice(fm[0].length)
  }

  const asString = (v: unknown): string | null => {
    if (v == null) return null
    if (typeof v === 'string') return v
    // yaml parses unquoted ISO timestamps to Date — normalize to ISO so the
    // DB timestamptz column accepts it.
    if (v instanceof Date) return v.toISOString()
    return String(v)
  }

  return {
    slug,
    type: asString(frontmatter['type']),
    title: asString(frontmatter['title']),
    capturedAt: asString(frontmatter['captured_at'] ?? frontmatter['recorded_at'] ?? frontmatter['created']),
    frontmatter,
    body: body.trim(),
    contentHash,
    edges: extractRelatedEdges(body)
  }
}
