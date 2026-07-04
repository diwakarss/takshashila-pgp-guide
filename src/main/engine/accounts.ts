import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { HarnessAccount } from '../../shared/ipc'

// Read the signed-in account behind each CLI from its local config — the
// "Connected — Max plan · you@email" detail that makes auth trustworthy.
// Local reads only; no network, no tokens ever leave the machine.

/** Pure: derive a human plan label from Claude's oauthAccount fields. */
export function deriveClaudePlan(a: {
  organizationType?: string | null
  seatTier?: string | null
  userRateLimitTier?: string | null
  billingType?: string | null
}): string | null {
  const org = (a.organizationType ?? '').toLowerCase()
  if (org.includes('max')) return 'Max'
  if (org.includes('pro')) return 'Pro'
  if (org.includes('team')) return 'Team'
  if (org.includes('enterprise')) return 'Enterprise'
  const tier = a.seatTier ?? a.userRateLimitTier
  if (tier) return tier.replace(/_/g, ' ')
  if (a.billingType === 'stripe_subscription') return 'Subscription'
  return null
}

export function claudeAccount(): HarnessAccount | null {
  try {
    const file = join(homedir(), '.claude.json')
    if (!existsSync(file)) return null
    const j = JSON.parse(readFileSync(file, 'utf8')) as {
      oauthAccount?: {
        emailAddress?: string
        displayName?: string
        organizationName?: string
        organizationType?: string
        seatTier?: string | null
        userRateLimitTier?: string | null
        billingType?: string | null
      }
    }
    const a = j.oauthAccount
    if (!a?.emailAddress) return null
    return {
      provider: 'Anthropic',
      plan: deriveClaudePlan(a),
      account: a.emailAddress,
      org: a.organizationName ?? null
    }
  } catch {
    return null
  }
}

/** Pure: pull email + plan out of Codex's id_token JWT (no verification —
 *  this is a local display read, not an auth decision). */
export function parseCodexIdToken(idToken: string): { email: string | null; plan: string | null } {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()) as {
      email?: string
      'https://api.openai.com/auth'?: { chatgpt_plan_type?: string }
    }
    const plan = payload['https://api.openai.com/auth']?.chatgpt_plan_type ?? null
    return { email: payload.email ?? null, plan: plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null }
  } catch {
    return { email: null, plan: null }
  }
}

export function codexAccount(): HarnessAccount | null {
  try {
    const file = join(process.env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'auth.json')
    if (!existsSync(file)) return null
    const j = JSON.parse(readFileSync(file, 'utf8')) as { tokens?: { id_token?: string } }
    if (!j.tokens?.id_token) return null
    const { email, plan } = parseCodexIdToken(j.tokens.id_token)
    if (!email) return null
    return { provider: 'OpenAI', plan, account: email, org: null }
  } catch {
    return null
  }
}
