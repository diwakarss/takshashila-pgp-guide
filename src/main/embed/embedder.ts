import { fork, execSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
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
  try {
    const p = execSync('command -v node', { encoding: 'utf8' }).trim()
    if (p) return p
  } catch {
    /* fall through */
  }
  return 'node'
}

class NodeChildEmbedder implements Embedder {
  private child: ChildProcess | null = null
  private seq = 0
  private pending = new Map<number, Pending>()

  private ensure(): ChildProcess {
    if (this.child) return this.child
    const childPath = join(import.meta.dirname, 'embedderProcess.js')
    const child = fork(childPath, [], {
      execPath: resolveNodeBin(),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
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

  embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return Promise.resolve([])
    return this.request(texts.map((t) => DOC_PREFIX + t))
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.request([QUERY_PREFIX + text])
    return v
  }
}

/** App-wide embedder: runs the model in a system-node child process. */
export const nomicEmbedder: Embedder = new NodeChildEmbedder()
