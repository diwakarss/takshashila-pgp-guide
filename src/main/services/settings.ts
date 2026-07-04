import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Small persisted app settings (userData/settings.json). Keeps the onboarding
// flag + a few preferences that aren't part of the brain. Read/written
// synchronously — the file is tiny and touched rarely.

export type AppSettings = {
  onboarded: boolean
  engineChoice: string | null // active harness: 'agent-cli:claude' | 'agent-cli:codex'
  metrics: boolean // anonymous usage metrics opt-in
  claudeBin: string | null // executable path overrides (Settings)
  codexBin: string | null
}

const DEFAULTS: AppSettings = { onboarded: false, engineChoice: null, metrics: true, claudeBin: null, codexBin: null }

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  try {
    if (existsSync(file())) {
      return { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppSettings>) }
    }
  } catch {
    /* corrupt file → fall back to defaults */
  }
  return { ...DEFAULTS }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(next, null, 2))
  return next
}
