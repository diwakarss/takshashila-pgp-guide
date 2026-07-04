import type { Engine } from './types'
import { agentCliEngine } from './agentCli'
import { codexCliEngine } from './codexCli'
import { anthropicApiEngine } from './apiAnthropic'
import { openAiApiEngine } from './apiOpenai'
import { ollamaEngine } from './ollama'
import { getSettings } from './../services/settings'

// The engine registry: every supported path (subscription CLIs, API keys,
// local Ollama) and the student's active pick. activeEngine() is resolved per
// call so a Settings change applies immediately.

export const ENGINES: Engine[] = [agentCliEngine, codexCliEngine]

export const ALL_ENGINES: Engine[] = [agentCliEngine, codexCliEngine, anthropicApiEngine, openAiApiEngine, ollamaEngine]

export function engineById(id: string | null): Engine | null {
  return ALL_ENGINES.find((e) => e.capabilities.id === id) ?? null
}

export function activeEngine(): Engine {
  return engineById(getSettings().engineChoice) ?? agentCliEngine
}
