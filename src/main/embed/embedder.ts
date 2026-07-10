import { fork, execSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { DOC_PREFIX, QUERY_PREFIX } from './contract'
import type { Embedder } from './types'

// Main-process proxy. Runs the model in a SYSTEM-NODE child process (not
// Electron's bundled Node, where onnxruntime's native addon SIGTRAPs). The
// prefix half of the parity contract is applied here; the child applies the
// pinned pooling/normalization. Lazy: the child spawns on first use.
//
// (Production note: students get a pre-embedded corpus and never run this over
// the corpus. A system-node dependency is acceptable for the builder dev loop;
// a renderer-WASM path for query/note embedding is a later-phase task.)

type Pending = { resolve: (v: number[][]) => void; reject: (e: Error) => void }

function resolveNodeBin(): string {
  if (process.env['PGP_NODE_BIN']) return process.env['PGP_NODE_BIN']
  // Packaged builds ship their own Node runtime — students don't have one.
  const bundled = join(process.resourcesPath ?? '', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  if (app.isPackaged && existsSync(bundled)) return bundled
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'command -v node'
    const p = execSync(cmd, { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
    if (p) return p
  } catch {
    /* fall through */
  }
  return 'node'
}

// onnxruntime's memory arena grows monotonically as batch shapes vary — over a
// full-corpus import the child climbs to many GB and the OS kills it ("exited
// (code null)"). Two bounds keep it flat: requests are capped at REQUEST_TEXTS
// texts each, and the child is retired + respawned after RECYCLE_TEXTS texts
// (a few seconds' model reload, amortized over ~16 pages).
const REQUEST_TEXTS = 64
const RECYCLE_TEXTS = 384

class NodeChildEmbedder implements Embedder {
  private child: ChildProcess | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private textsSinceSpawn = 0

  private ensure(): ChildProcess {
    if (this.child) return this.child
    const childPath = join(import.meta.dirname, 'embedderProcess.js')
    const child = fork(childPath, [], {
      execPath: resolveNodeBin(),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        // model cache must live in userData, never inside the install dir
        PGP_MODEL_CACHE: join(app.getPath('userData'), 'models')
      }
    })
    child.on('message', (m: { id: number; vectors?: number[][]; error?: string }) => {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error))
      else p.resolve(m.vectors ?? [])
    })
    const fail = (reason: string): void => {
      this.child = null
      const err = new Error(reason)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    }
    child.on('exit', (code) => fail(`embedder process exited (code ${code})`))
    child.on('error', (e) => fail(`could not start embedder (need Node on PATH): ${e.message}`))
    this.child = child
    return child
  }

  private request(texts: string[]): Promise<number[][]> {
    const child = this.ensure()
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.send({ id, texts })
    })
  }

  async warmup(): Promise<void> {
    await this.request([])
  }

  /** Retire the child between requests once it has embedded enough to have a
   *  bloated arena. The next request re-forks (and re-loads the model). */
  private recycleIfNeeded(): void {
    if (this.textsSinceSpawn < RECYCLE_TEXTS || !this.child || this.pending.size > 0) return
    const child = this.child
    this.child = null
    this.textsSinceSpawn = 0
    child.removeAllListeners('exit') // a planned retirement, not a failure
    child.kill()
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += REQUEST_TEXTS) {
      const slice = texts.slice(i, i + REQUEST_TEXTS)
      out.push(...(await this.request(slice.map((t) => DOC_PREFIX + t))))
      this.textsSinceSpawn += slice.length
      this.recycleIfNeeded()
    }
    return out
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.request([QUERY_PREFIX + text])
    return v
  }

  /** Kill the child on app quit — Windows never reaps orphans by itself. */
  shutdown(): void {
    if (!this.child) return
    const child = this.child
    this.child = null
    child.removeAllListeners('exit')
    child.kill()
  }
}

/** App-wide embedder: runs the model in a system-node child process. */
export const nomicEmbedder = new NodeChildEmbedder()
