import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { homedir } from 'node:os'
import { getSettings } from '../services/settings'

// Find the CLI binary reliably. GUI-launched apps don't inherit the shell
// PATH (Finder on macOS, Explorer on Windows), so we resolve an absolute path:
// user override (Settings) → env override → PATH → well-known locations.

const IS_WIN = process.platform === 'win32'

// Candidate file names per platform (npm ships .cmd shims on Windows).
const NAMES = (name: 'claude' | 'codex'): string[] => (IS_WIN ? [`${name}.exe`, `${name}.cmd`, name] : [name])

const PROBE_DIRS: string[] = IS_WIN
  ? [
      join(homedir(), 'AppData', 'Roaming', 'npm'), // npm -g shims
      join(homedir(), '.local', 'bin'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'claude'),
      'C:\\Program Files\\nodejs'
    ]
  : ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), join(homedir(), '.claude', 'local')]

const ENV_KEY: Record<'claude' | 'codex', string> = { claude: 'PGP_CLAUDE_BIN', codex: 'PGP_CODEX_BIN' }

export function resolveBin(name: 'claude' | 'codex'): string | null {
  // QA: simulate a machine without the CLI (PGP_DEV_FAKE_MISSING=claude,codex,ollama)
  if ((process.env['PGP_DEV_FAKE_MISSING'] ?? '').includes(name)) return null
  const settings = getSettings()
  const override = name === 'claude' ? settings.claudeBin : settings.codexBin
  if (override && existsSync(override)) return override
  const env = process.env[ENV_KEY[name]]
  if (env && existsSync(env)) return env
  const candidates = NAMES(name)
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    for (const file of candidates) if (existsSync(join(dir, file))) return join(dir, file)
  }
  for (const dir of PROBE_DIRS) {
    for (const file of candidates) if (existsSync(join(dir, file))) return join(dir, file)
  }
  return null
}
