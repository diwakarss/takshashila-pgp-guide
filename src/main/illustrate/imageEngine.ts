import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { buildIllustrationBrief } from './style'

// Builder image engine: generates a concept illustration by shelling the gstack
// `design` binary (the same generator behind the design mockups). This is the
// BUILDER path — students on a text-only LLM won't have it; a real product path
// (OpenAI images via the API-key engine, or a shipped cache) is a later task.
//
// Generated images are cached by a hash of the full brief, so a repeated
// concept is returned instantly instead of regenerated (~40s).

function resolveDesignBin(): string | null {
  const candidates = [
    join(process.cwd(), '.claude/skills/gstack/design/dist/design'),
    join(homedir(), '.claude/skills/gstack/design/dist/design')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'illustrations')
  mkdirSync(dir, { recursive: true })
  return dir
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`image generation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(err.trim() || `design exited ${code}`))
    })
  })
}

export class DesignBinaryImageEngine {
  isAvailable(): boolean {
    return resolveDesignBin() !== null
  }

  /** Generate (or return cached) a PNG for a concept; resolves to a data URL. */
  async generate(title: string, composition: string): Promise<string> {
    const bin = resolveDesignBin()
    if (!bin) throw new Error('image generator not available on this machine')
    const brief = buildIllustrationBrief(title, composition)
    const key = createHash('sha256').update(brief).digest('hex').slice(0, 16)
    const out = join(cacheDir(), `${key}.png`)
    if (!existsSync(out)) {
      await run(bin, ['generate', '--brief', brief, '--output', out], 150_000)
    }
    const buf = readFileSync(out)
    return `data:image/png;base64,${buf.toString('base64')}`
  }
}

export const imageEngine = new DesignBinaryImageEngine()
