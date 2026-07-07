// PGP Guide anonymous telemetry — Cloudflare Worker + KV.
//
// POST /ping   {id, event, platform, arch, appVersion, ts}
//   → KV `install:<id>` = {platform, arch, appVersion, first, last, launches}
//   Stores nothing else. No IPs, no accounts, no content.
//
// GET /stats?key=<STATS_KEY>
//   → {installs, byPlatform, recent7d}   (STATS_KEY is a Worker secret)
//
// Deploy:  cd tools/telemetry-worker && npx wrangler deploy
//          npx wrangler kv namespace create PINGS   (once; paste id in wrangler.toml)
//          npx wrangler secret put STATS_KEY

export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    if (req.method === 'POST' && url.pathname === '/ping') {
      let b
      try {
        b = await req.json()
      } catch {
        return new Response('bad json', { status: 400 })
      }
      const id = String(b.id ?? '')
      if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('bad id', { status: 400 })
      const key = `install:${id}`
      const prev = (await env.PINGS.get(key, 'json')) ?? { first: b.ts, launches: 0 }
      await env.PINGS.put(
        key,
        JSON.stringify({
          platform: String(b.platform ?? '').slice(0, 16),
          arch: String(b.arch ?? '').slice(0, 16),
          appVersion: String(b.appVersion ?? '').slice(0, 24),
          first: prev.first,
          last: String(b.ts ?? '').slice(0, 32),
          launches: (prev.launches ?? 0) + 1
        })
      )
      return new Response('ok')
    }

    if (req.method === 'GET' && url.pathname === '/stats') {
      if (url.searchParams.get('key') !== env.STATS_KEY) return new Response('no', { status: 403 })
      const byPlatform = {}
      let installs = 0
      let recent7d = 0
      const cutoff = Date.now() - 7 * 24 * 3600 * 1000
      let cursor
      do {
        const page = await env.PINGS.list({ prefix: 'install:', cursor })
        for (const k of page.keys) {
          const v = await env.PINGS.get(k.name, 'json')
          if (!v) continue
          installs++
          byPlatform[v.platform] = (byPlatform[v.platform] ?? 0) + 1
          if (Date.parse(v.last) > cutoff) recent7d++
        }
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      return Response.json({ installs, byPlatform, recent7d })
    }

    return new Response('pgp-telemetry', { status: 404 })
  }
}
