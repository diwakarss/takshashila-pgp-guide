// Same concept at medium + high quality, to choose the tier vs low.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const key = JSON.parse(readFileSync(join(homedir(), '.gstack', 'openai.json'), 'utf8')).api_key
mkdirSync('.context/illustration-proto/quality', { recursive: true })

const STYLE = `One standalone 16:9 horizontal hand-drawn CONCEPT ILLUSTRATION for an INDIAN public-policy study app. Pure WHITE background. THIN, delicate black pen lines (fine-liner feel) — NOT thick brush or marker strokes. Minimalist, lots of empty white space. NO gradients/shadows/PPT/legend/title/mascot.
Recurring character 'the analyst': a small deadpan stick figure, WHITE-fill (unfilled body, thin black outline). FIGURE FILL RULE: every human figure white-fill; SOLID BLACK only for a wrongdoer.
Keep TEXT MINIMAL — at most 4 short labels, big clear hand-printed letters (spell them correctly).
Colour sparse: black lines + white analyst; orange for the main path/arrow; red only for a problem. Indian context if needed (₹, RBI, Parliament).`

const brief = `Theme: opportunity cost — you can take only ONE road. Composition: a WHITE-fill analyst stands at a clear FORK where a single path splits into TWO diverging roads. The left road has a green tick and the label "chosen". The right road fades out / is crossed, labelled "given up", with a small clock + ₹ coin beside it meaning the value you forgo. Make the FORK unmistakable. Labels (max 4): "chosen", "given up", "you forgo".`

for (const quality of ['medium', 'high']) {
  const t0 = Date.now()
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: `${STYLE}\n\n${brief}`, size: '1536x1024', quality, n: 1 })
  })
  if (!res.ok) {
    console.log(`FAILED ${quality}`, res.status, (await res.text()).slice(0, 200))
    continue
  }
  const json = await res.json()
  writeFileSync(`.context/illustration-proto/quality/opp-cost-${quality}.png`, Buffer.from(json.data[0].b64_json, 'base64'))
  console.log(`OK ${quality} in ${((Date.now() - t0) / 1000).toFixed(1)}s, out_tokens=${json.usage?.output_tokens}`)
}
console.log('done')
