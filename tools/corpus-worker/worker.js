// PGP Guide corpus delivery — Cloudflare Worker + KV.
//
// The private pgp-brain corpus, served to student apps behind the cohort
// passphrase (Worker secret CORPUS_KEY):
//
//   GET /manifest.json            → the manifest (what files exist, hashes)
//   GET /f/<key>                  → one corpus file (pgp/… or illustrations/…)
//
// Auth on every route: Authorization: Bearer <CORPUS_KEY>.
// Storage is Workers KV (value cap 25 MB — far above our biggest file; the
// account has no R2). Uploads happen out-of-band via wrangler
// (tools/publish in pgp-brain).
//
// Deploy:  cd tools/corpus-worker && npx wrangler deploy
//          npx wrangler kv namespace create CORPUS     (once; id → wrangler.toml)
//          npx wrangler secret put CORPUS_KEY          (once)

const ALLOWED = /^(manifest\.json$|pgp\/[\w.-]+$|illustrations\/[\w./-]+$)/

export default {
  async fetch(req, env) {
    if (req.method !== 'GET') return new Response('method', { status: 405 })
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${env.CORPUS_KEY}`) return new Response('unauthorized', { status: 401 })

    const url = new URL(req.url)
    const key = url.pathname === '/manifest.json' ? 'manifest.json' : decodeURIComponent(url.pathname).replace(/^\/f\//, '')
    if (!ALLOWED.test(key)) return new Response('not found', { status: 404 })

    const body = await env.CORPUS.get(key, 'stream')
    if (!body) return new Response('not found', { status: 404 })
    const type = key.endsWith('.json') ? 'application/json' : key.endsWith('.md') ? 'text/markdown' : 'application/octet-stream'
    return new Response(body, { headers: { 'content-type': type } })
  }
}
