import { describe, it, expect } from 'vitest'
import { checkDiscoveryCompleteness } from '../src/discovery/discovery-gate.js'

describe('checkDiscoveryCompleteness', () => {
  it('passes for a complete spec', () => {
    const spec = `# Payment Processing

## Requirement: Checkout Flow

The system MUST process payments via Stripe.

### Scenario: Successful payment
- GIVEN a user with items in cart
- WHEN they submit valid payment details
- THEN the order is created
- AND payment is captured

### Scenario: Failed payment
- GIVEN a user with items in cart
- WHEN payment is declined
- THEN an error message is shown

## Out of Scope
- Cryptocurrency payments
- Integration with other payment providers
`
    const result = checkDiscoveryCompleteness(spec)
    expect(result.complete).toBe(true)
    expect(result.checks.every(c => c.passed)).toBe(true)
  })

  it('fails when requirements have no scenarios', () => {
    const spec = `# Test

## Requirement: Feature A

The system MUST do A.

## Requirement: Feature B

The system MUST do B.

### Scenario: B works
- GIVEN x
- WHEN y
- THEN z

## Out of Scope
- Nothing
`
    const result = checkDiscoveryCompleteness(spec)
    const scenarioCheck = result.checks.find(c => c.label.includes('at least one scenario'))
    expect(scenarioCheck?.passed).toBe(false)
  })

  it('fails when TODO markers exist', () => {
    const spec = `# Test

## Requirement: Feature

The system MUST do something. TODO: clarify what.

### Scenario: It works
- GIVEN precondition
- WHEN action
- THEN result

## Out of Scope
- Nothing
`
    const result = checkDiscoveryCompleteness(spec)
    const todoCheck = result.checks.find(c => c.label.includes('TODO/TBD'))
    expect(todoCheck?.passed).toBe(false)
  })

  it('fails when scenarios lack Given/When/Then', () => {
    const spec = `# Test

## Requirement: Feature

The system MUST do something.

### Scenario: It works
- The feature should work properly
- Users should see results

## Out of Scope
- Nothing
`
    const result = checkDiscoveryCompleteness(spec)
    const gwtCheck = result.checks.find(c => c.label.includes('Given/When/Then'))
    expect(gwtCheck?.passed).toBe(false)
  })

  it('fails when out-of-scope is missing', () => {
    const spec = `# Test

## Requirement: Feature

The system MUST do something.

### Scenario: It works
- GIVEN precondition
- WHEN action
- THEN result
`
    const result = checkDiscoveryCompleteness(spec)
    const oosCheck = result.checks.find(c => c.label.includes('Out-of-scope'))
    expect(oosCheck?.passed).toBe(false)
  })

  it('returns detailed check results', () => {
    const spec = `# Empty`
    const result = checkDiscoveryCompleteness(spec)
    expect(result.checks.length).toBeGreaterThanOrEqual(5)
    expect(result.checks.every(c => 'label' in c && 'passed' in c)).toBe(true)
  })
})
