import { describe, it, expect } from 'vitest'
import { deriveClaudePlan, parseCodexIdToken } from './accounts'

describe('deriveClaudePlan', () => {
  it('maps organizationType to plan names', () => {
    expect(deriveClaudePlan({ organizationType: 'claude_max' })).toBe('Max')
    expect(deriveClaudePlan({ organizationType: 'claude_pro' })).toBe('Pro')
    expect(deriveClaudePlan({ organizationType: 'team_x' })).toBe('Team')
    expect(deriveClaudePlan({ organizationType: 'enterprise' })).toBe('Enterprise')
  })
  it('falls back to tier, then billing, then null', () => {
    expect(deriveClaudePlan({ seatTier: 'seat_pro' })).toBe('seat pro')
    expect(deriveClaudePlan({ billingType: 'stripe_subscription' })).toBe('Subscription')
    expect(deriveClaudePlan({})).toBeNull()
  })
})

describe('parseCodexIdToken', () => {
  it('extracts email + plan from the JWT payload', () => {
    const payload = Buffer.from(
      JSON.stringify({ email: 's@t.in', 'https://api.openai.com/auth': { chatgpt_plan_type: 'team' } })
    ).toString('base64url')
    expect(parseCodexIdToken(`h.${payload}.sig`)).toEqual({ email: 's@t.in', plan: 'Team' })
  })
  it('is safe on junk', () => {
    expect(parseCodexIdToken('not-a-jwt')).toEqual({ email: null, plan: null })
  })
})
