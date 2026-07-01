import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { buildIllustrationBrief } from './style'

// Direct OpenAI image generation (gpt-image-1) at LOW quality — our hand-drawn
// line art needs no photorealism, and low is ~15x cheaper than high (~$0.013 vs
// ~$0.20 for 16:9). One API request per image (vs the design tool's high-quality
// + vision-QA double call). Generated images are cached by a hash of the brief
// so a repeated brief is free; the concept library keys reuse above this.

const MODEL = process.env['PGP_IMAGE_MODEL'] ?? 'gpt-image-1'
const QUALITY = process.env['PGP_IMAGE_QUALITY'] ?? 'low'
const SIZE = process.env['PGP_IMAGE_SIZE'] ?? '1536x1024' // 16:9 landscape

function apiKey(): string | null {
  if (process.env['PGP_OPENAI_KEY']) return process.env['PGP_OPENAI_KEY']
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.gstack', 'openai.json'), 'utf8')) as { api_key?: string }
    return cfg.api_key ?? null
  } catch {
    return null
  }
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'illustrations')
  mkdirSync(dir, { recursive: true })
  return dir
}

function toDataUrl(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`
}

async function callOpenAI(key: string, prompt: string): Promise<Buffer> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 150_000)
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, size: SIZE, quality: QUALITY, n: 1 }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OpenAI images ${res.status}: ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { data?: { b64_json?: string }[] }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new Error('OpenAI images: no image in response')
    return Buffer.from(b64, 'base64')
  } finally {
    clearTimeout(timer)
  }
}

export class OpenAiImageEngine {
  isAvailable(): boolean {
    return apiKey() !== null
  }

  /** Generate (or return cached) a PNG for a concept; resolves to its data URL
   *  and cache filename (recorded in the concept library for reuse). */
  async generate(title: string, composition: string): Promise<{ dataUrl: string; file: string }> {
    const key = apiKey()
    if (!key) throw new Error('no OpenAI API key configured')
    const brief = buildIllustrationBrief(title, composition)
    const hash = createHash('sha256').update(`${MODEL}:${QUALITY}:${SIZE}:${brief}`).digest('hex').slice(0, 16)
    const file = `${hash}.png`
    const out = join(cacheDir(), file)
    if (!existsSync(out)) {
      const png = await callOpenAI(key, brief)
      writeFileSync(out, png)
    }
    return { dataUrl: toDataUrl(out), file }
  }

  /** Read an already-drawn library image (by cache filename) as a data URL. */
  read(file: string): string | null {
    const p = join(cacheDir(), file)
    return existsSync(p) ? toDataUrl(p) : null
  }
}

export const imageEngine = new OpenAiImageEngine()
