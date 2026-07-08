import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Student-side corpus delivery: mirror the published corpus (pgp/*.md +
// illustrations/**) from the delivery Worker into a local folder, then the
// normal incremental import takes over. Auth is the cohort passphrase.
//
// The manifest lists every file with a sha256-prefix hash; we download only
// what's new or changed and delete local files the manifest no longer has,
// so the local mirror always matches the published corpus exactly.

export const CORPUS_URL_DEFAULT = 'https://pgp-corpus.diwakar-s-s.workers.dev'

export function corpusRemoteUrl(): string {
  return process.env['PGP_CORPUS_URL'] ?? CORPUS_URL_DEFAULT
}

type Manifest = { generatedAt: string; files: Record<string, { hash: string; bytes: number }> }

const hashOf = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)

async function fetchAuth(url: string, key: string): Promise<Response> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } })
  if (res.status === 401) throw new Error('The class passphrase was not accepted — check it in Settings.')
  if (!res.ok) throw new Error(`corpus server: ${res.status} for ${new URL(url).pathname}`)
  return res
}

export type RemoteSyncResult = { downloaded: number; deleted: number; total: number }

/** How many published files differ from the local mirror (badge check). */
export async function remoteChanges(base: string, key: string): Promise<number> {
  const url = corpusRemoteUrl()
  const manifest = (await (await fetchAuth(`${url}/manifest.json`, key)).json()) as Manifest
  let n = 0
  for (const [k, v] of Object.entries(manifest.files)) {
    const p = join(base, k)
    if (!existsSync(p) || hashOf(p) !== v.hash) n++
  }
  return n
}

/**
 * Mirror the remote corpus into `base` (creating `base/pgp` and
 * `base/illustrations`). Returns counts; throws on auth/network errors.
 */
export async function syncFromRemote(
  base: string,
  key: string,
  onProgress?: (file: string, index: number, total: number) => void
): Promise<RemoteSyncResult> {
  const url = corpusRemoteUrl()
  const manifest = (await (await fetchAuth(`${url}/manifest.json`, key)).json()) as Manifest
  const entries = Object.entries(manifest.files)

  const changed = entries.filter(([k, v]) => {
    const p = join(base, k)
    return !existsSync(p) || hashOf(p) !== v.hash
  })

  let i = 0
  for (const [k] of changed) {
    onProgress?.(k, ++i, changed.length)
    const buf = Buffer.from(await (await fetchAuth(`${url}/f/${k}`, key)).arrayBuffer())
    const dest = join(base, k)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
  }

  // Prune local files the published corpus no longer has (deleted classes,
  // replaced duplicates) so stale pages don't linger on students' machines.
  let deleted = 0
  for (const sub of ['pgp', 'illustrations']) {
    const dir = join(base, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir, { recursive: true }) as string[]) {
      const p = join(dir, String(f))
      if (!statSync(p).isFile()) continue
      const k = `${sub}/${String(f).split('\\').join('/')}`
      if (!manifest.files[k]) {
        rmSync(p)
        deleted++
      }
    }
  }

  return { downloaded: changed.length, deleted, total: entries.length }
}
