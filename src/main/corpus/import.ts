import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePage } from './parse'
import { chunkBody } from './chunk'
import { resolveCourse } from './course'
import type { Embedder } from '../embed/types'
import type { SourceWriter } from '../brain/brain'

export type ImportProgress = {
  file: string
  index: number
  total: number
  chunks: number
}

export type ImportResult = { files: number; pages: number; chunks: number }

/**
 * Import a directory of gbrain markdown files into the brain through a
 * source-scoped writer. Pass `brain.corpusWriter` and the import can only
 * ever land in the corpus source (eng-review D3). Per file: parse → chunk →
 * embed (document prefix) → upsert page + edges.
 */
export async function importDirectory(opts: {
  dir: string
  embedder: Embedder
  writer: SourceWriter
  onProgress?: (p: ImportProgress) => void
  /** Dev/diagnostic: import at most this many files. */
  limit?: number
}): Promise<ImportResult> {
  const { dir, embedder, writer, onProgress, limit } = opts
  const all = await readdir(dir)
  let files = all
    .filter((f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
  if (limit && limit > 0) files = files.slice(0, limit)

  let pages = 0
  let totalChunks = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const raw = await readFile(join(dir, file), 'utf8')
    const page = parsePage(file, raw)
    const chunks = chunkBody(page.body)

    if (chunks.length > 0) {
      const embeddings = await embedder.embedDocuments(chunks.map((c) => c.text))
      const records = chunks.map((c, idx) => ({
        ordinal: c.ordinal,
        text: c.text,
        embedding: embeddings[idx]
      }))
      const course = resolveCourse(page.frontmatter, page.slug, page.title)
      await writer.upsertPage(
        {
          slug: page.slug,
          type: page.type,
          title: page.title,
          courseCode: course.code,
          courseName: course.name,
          frontmatter: page.frontmatter,
          markdown: page.body,
          contentHash: page.contentHash,
          capturedAt: page.capturedAt
        },
        records
      )
      for (const to of page.edges) await writer.upsertEdge(page.slug, to)
      totalChunks += records.length
    }

    pages++
    onProgress?.({ file, index: i + 1, total: files.length, chunks: chunks.length })
  }

  return { files: files.length, pages, chunks: totalChunks }
}
