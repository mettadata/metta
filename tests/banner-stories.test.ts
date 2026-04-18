import { describe, it, expect } from 'vitest'
import { agentBanner } from '../src/cli/helpers.js'

// Strip ANSI color escape codes so assertions match plain label text.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('agentBanner (stories/product regression)', () => {
  it('renders [METTA-PRODUCT] for the product agent (single metta- prefix)', () => {
    const out = stripAnsi(agentBanner('product', 'stories'))
    expect(out).toContain('[METTA-PRODUCT]')
    expect(out).not.toContain('[METTA-METTA-PRODUCT]')
  })

  it('still renders other agents with a single metta- prefix', () => {
    const out = stripAnsi(agentBanner('executor', 'implementation'))
    expect(out).toContain('[METTA-EXECUTOR]')
    expect(out).not.toContain('[METTA-METTA-')
  })
})
