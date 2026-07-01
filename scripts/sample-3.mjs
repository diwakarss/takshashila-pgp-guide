// Generate 3 sample illustrations at LOW quality with the tightened style, so
// the cost can be verified on the OpenAI dashboard before regenerating all.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const key = JSON.parse(readFileSync(join(homedir(), '.gstack', 'openai.json'), 'utf8')).api_key
mkdirSync('.context/illustration-proto/samples', { recursive: true })

const STYLE = `One standalone 16:9 horizontal hand-drawn CONCEPT ILLUSTRATION for an INDIAN public-policy study app. Pure WHITE background, minimalist BLACK hand-drawn slightly-wobbly line art, lots of empty white space (>=35% blank). NO gradients, NO shadows, NO PPT infographic, NO legend box, NO title bar, NO checklists, NO cute mascot.
Recurring character 'the analyst': a small deadpan stick figure drawn WHITE-fill (unfilled body, thin black outline), dot eyes, performing the idea. FIGURE FILL RULE (strict): EVERY human figure is WHITE-fill. The ONLY black-filled figure allowed is a wrongdoer (rule-breaker / exploiter / corrupt / threat). Never fill a figure black for "the other option" or contrast.
Indian context: use Indian institutions/examples if a referent is needed (Parliament, RBI, GST, a ration shop) — never US ones.
Colour sparse: black line art + white analyst; orange for main flow/arrows; red only for a problem; blue only for a secondary note. A few short handwritten ENGLISH labels (4-6, 2-4 words). No corner title. ONE idea only, subject 40-60% of canvas.`

const concepts = [
  {
    file: 'opportunity-cost',
    brief: `Theme: opportunity cost. Composition: a WHITE-fill analyst stands at a fork in a path; one way signed "chosen", the other signed "given up" with a small clock and a rupee coin marking what is forgone. NO black figures at all. Labels: "opportunity cost", "chosen", "given up", "what you forgo". One orange arrow along the chosen path.`
  },
  {
    file: 'state-capacity',
    brief: `Theme: state capacity — the implementation gap. Composition: a WHITE-fill analyst (the state) tries to carry a big box labelled "good scheme" across a broken bridge with a gap in the middle; the far bank is "delivery". Labels: "good scheme", "the gap", "capacity", "delivery". A small red mark on the gap. All figures white-fill.`
  },
  {
    file: 'regulatory-capture',
    brief: `Theme: regulatory capture. Composition: a WHITE-fill analyst as "regulator" sits at a desk with a rulebook; a SOLID BLACK figure (the captured industry lobbyist — a wrongdoer) leans over the desk and steers the regulator's pen. Labels: "regulator", "industry", "captured", "rules bent". Red on "rules bent".`
  }
]

for (const c of concepts) {
  const t0 = Date.now()
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: `${STYLE}\n\n${c.brief}`, size: '1536x1024', quality: 'low', n: 1 })
  })
  if (!res.ok) {
    console.log(`FAILED ${c.file}`, res.status, (await res.text()).slice(0, 200))
    continue
  }
  const json = await res.json()
  writeFileSync(`.context/illustration-proto/samples/${c.file}.png`, Buffer.from(json.data[0].b64_json, 'base64'))
  console.log(`OK ${c.file} in ${((Date.now() - t0) / 1000).toFixed(1)}s, out_tokens=${json.usage?.output_tokens}`)
}
console.log('done — check https://platform.openai.com usage for the delta')
