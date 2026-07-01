// Smoke: generate one illustration at LOW quality via the direct OpenAI call,
// to confirm it works + looks fine for line art (and costs ~$0.013).
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const key = JSON.parse(readFileSync(join(homedir(), '.gstack', 'openai.json'), 'utf8')).api_key
const brief = `One standalone 16:9 horizontal hand-drawn CONCEPT ILLUSTRATION. Pure WHITE background, minimalist BLACK hand-drawn slightly-wobbly line art, lots of white space. NO gradients/shadows/PPT/legend/title. Recurring character 'the analyst': a small WHITE-fill (unfilled) stick figure with thin black outline, dot eyes, performing the idea. A SOLID BLACK figure only for a bad actor. THEME: opportunity cost. COMPOSITION: the white analyst stands at a fork in a path, one way signed 'chosen', the other 'given up'; a small clock/coin marks what's forgone. Labels (max 4): 'opportunity cost', 'chosen', 'given up', 'what you forgo'. One orange arrow on the chosen path. Clean, loose, scholarly.`

const t0 = Date.now()
const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-image-1', prompt: brief, size: '1536x1024', quality: 'low', n: 1 })
})
if (!res.ok) {
  console.log('FAILED', res.status, (await res.text()).slice(0, 300))
  process.exit(1)
}
const json = await res.json()
const b64 = json.data?.[0]?.b64_json
writeFileSync('.context/illustration-proto/lowqual-opportunity-cost.png', Buffer.from(b64, 'base64'))
console.log(`OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log('usage:', JSON.stringify(json.usage ?? 'n/a'))
