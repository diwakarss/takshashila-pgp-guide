import type { Engine } from './types'
import { agentCliEngine } from './agentCli'
import { codexCliEngine } from './codexCli'
import { getSettings } from '../services/settings'

// The harness registry: every supported engine, and the student's active pick.
// activeEngine() is resolved per call so a Settings change applies immediately.

export const ENGINES: Engine[] = [agentCliEngine, codexCliEngine]

export function activeEngine(): Engine {
  return getSettings().engineChoice === 'agent-cli:codex' ? codexCliEngine : agentCliEngine
}
