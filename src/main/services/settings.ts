import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Small persisted app settings (userData/settings.json). Keeps the onboarding
// flag + a few preferences that aren't part of the brain. Read/written
// synchronously — the file is tiny and touched rarely.

export type AppSettings = {
  onboarded: boolean
  engineChoice: string | null // active engine id (agent-cli:* | api:* | local:ollama)
  metrics: boolean // anonymous usage metrics opt-in
  claudeBin: string | null // executable path overrides (Settings)
  codexBin: string | null
  localModel: string | null // ollama model tag
}

/** Stored on disk (main-process only): settings + encrypted API keys. The keys
 *  never cross IPC — the renderer sees masked values via ai:status. */
export type StoredSettings = AppSettings & { apiKeys: Record<string, string> }

const DEFAULTS: StoredSettings = {
  onboarded: false,
  engineChoice: null,
  metrics: true,
  claudeBin: null,
  codexBin: null,
  localModel: null,
  apiKeys: {}
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): StoredSettings {
  try {
    if (existsSync(file())) {
      return { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<StoredSettings>) }
    }
  } catch {
    /* corrupt file → fall back to defaults */
  }
  return { ...DEFAULTS }
}

export function setSettings(patch: Partial<StoredSettings>): StoredSettings {
  const next = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(next, null, 2))
  return next
}

/** The renderer-safe view: everything except the (encrypted) API keys. */
export function publicSettings(): AppSettings {
  const { apiKeys: _apiKeys, ...rest } = getSettings()
  return rest
}
