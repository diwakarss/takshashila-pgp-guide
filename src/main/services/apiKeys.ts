import { safeStorage } from 'electron'
import { getSettings, setSettings } from './settings'

// API keys at rest: encrypted with the OS keychain (Electron safeStorage) and
// stored inside settings.json as base64. They are decrypted only in the main
// process at call time; the renderer only ever sees a masked suffix.

export type ApiProvider = 'anthropic' | 'openai'

export function saveApiKey(provider: ApiProvider, key: string): void {
  const value = safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(key.trim()).toString('base64')}`
    : `plain:${key.trim()}` // no OS keyring available — still works, less safe
  setSettings({ apiKeys: { ...getSettings().apiKeys, [provider]: value } })
}

export function clearApiKey(provider: ApiProvider): void {
  const keys = { ...getSettings().apiKeys }
  delete keys[provider]
  setSettings({ apiKeys: keys })
}

export function getApiKey(provider: ApiProvider): string | null {
  const stored = getSettings().apiKeys[provider]
  if (!stored) return null
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    if (stored.startsWith('plain:')) return stored.slice(6)
  } catch {
    /* key from another machine/keychain — treat as absent */
  }
  return null
}

/** For display only: `sk-…abcd`. */
export function maskedApiKey(provider: ApiProvider): string | null {
  const key = getApiKey(provider)
  if (!key) return null
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}
