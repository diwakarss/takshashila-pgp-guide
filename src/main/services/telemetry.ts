import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { getSettings, setSettings } from './settings'

// Anonymous usage ping — strictly opt-in (settings.metrics) and strictly
// anonymous: a random install id, platform, arch, app version, event name.
// No account info, no content, no hostnames, no IP logging on our side
// (the worker stores only what's in the body). One launch ping per run.
//
// Endpoint: PGP_TELEMETRY_URL env wins (dev/testing); otherwise the baked-in
// production URL. Empty string = telemetry disabled at build level.
const PROD_URL = 'https://pgp-telemetry.takshashila.workers.dev/ping'

function endpoint(): string {
  return process.env['PGP_TELEMETRY_URL'] ?? PROD_URL
}

/** The stable anonymous install id (created on first use). */
export function anonId(): string {
  const s = getSettings()
  if (s.anonId) return s.anonId
  const id = randomUUID()
  setSettings({ anonId: id })
  return id
}

/** Fire-and-forget usage ping. Never throws, never blocks, never sends when
 *  the user has metrics off. Dev runs only send when PGP_TELEMETRY_URL is set. */
export function ping(event: 'launch' | 'sync' | 'update'): void {
  const url = endpoint()
  if (!url) return
  if (!getSettings().metrics) return
  if (!app.isPackaged && !process.env['PGP_TELEMETRY_URL']) return
  const body = {
    id: anonId(),
    event,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    ts: new Date().toISOString()
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 5000)
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctl.signal
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer))
}
