// Throwaway smoke: confirm the agent-CLI adapter (claude -p via spawn + stdin)
// returns a grounded, cited answer. Mirrors the real flatten/spawn path.
import { spawn } from 'node:child_process'

function run(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (c) => (c === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${c}`))))
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

const prompt = `You are a study tutor. Answer using ONLY the numbered sources, cite as [n].

Sources:
[1] (Microeconomics-1) Manur argues bans fail: people respond to incentives, suppliers make thinner bags, enforcement needs state capacity India lacks, so compliance is near zero.
[2] (Microeconomics-1) The "in degrees" alternative: incentivize people at the margin to shift away from plastic, which is slower but more durable.

Question: why do outright bans on single-use plastic fail?

Answer (cite sources as [n]):`

const t0 = Date.now()
const answer = await run(prompt)
console.log(`answered in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
console.log(answer)
console.log(`\n[cites source markers]: ${/\[1\]|\[2\]/.test(answer) ? 'YES' : 'NO'}`)
