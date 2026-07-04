import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getSettings } from '../services/settings'

// Find the CLI binary reliably. Apps launched from Finder don't inherit the
// shell PATH, so "claude"/"codex" alone often fails — we resolve an absolute
// path: user override (Settings) → env override → PATH → well-known locations.

const PROBES: Record<'claude' | 'codex', string[]> = {
  claude: [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'local', 'claude')
  ],
  codex: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(homedir(), '.local', 'bin', 'codex')]
}

const ENV_KEY: Record<'claude' | 'codex', string> = { claude: 'PGP_CLAUDE_BIN', codex: 'PGP_CODEX_BIN' }

export function resolveBin(name: 'claude' | 'codex'): string | null {
  const settings = getSettings()
  const override = name === 'claude' ? settings.claudeBin : settings.codexBin
  if (override && existsSync(override)) return override
  const env = process.env[ENV_KEY[name]]
  if (env && existsSync(env)) return env
  for (const dir of (process.env['PATH'] ?? '').split(':')) {
    if (dir && existsSync(join(dir, name))) return join(dir, name)
  }
  for (const p of PROBES[name]) if (existsSync(p)) return p
  return null
}
