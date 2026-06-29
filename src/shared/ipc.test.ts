import { describe, it, expect } from 'vitest'
import { IPC } from './ipc'

// Guards the IPC contract: channel names are the wire between two processes,
// so a silent rename in one place breaks the app. Pin them.
describe('IPC contract', () => {
  it('exposes stable channel names', () => {
    expect(IPC.ping).toBe('app:ping')
    expect(IPC.appInfo).toBe('app:info')
  })

  it('has no duplicate channel strings', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })
})
