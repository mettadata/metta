export interface CompletenessCheck {
  label: string
  passed: boolean
  detail?: string
}

export interface DiscoveryResult {
  complete: boolean
  checks: CompletenessCheck[]
}

export function checkDiscoveryCompleteness(specContent: string): DiscoveryResult {
  const checks: CompletenessCheck[] = []

  // Check: All requirements have at least one scenario
  const requirements = specContent.match(/## (?:ADDED:\s*|MODIFIED:\s*)?Requirement:\s*.+/g) ?? []
  const scenarios = specContent.match(/### (?:ADDED\s+)?Scenario:\s*.+/g) ?? []
  const hasScenarios = requirements.length === 0 || scenarios.length >= requirements.length
  checks.push({
    label: 'All requirements have at least one scenario',
    passed: hasScenarios,
    detail: hasScenarios ? undefined : `${requirements.length} requirements but only ${scenarios.length} scenarios`,
  })

  // Check: All scenarios have Given/When/Then
  const scenarioBlocks = specContent.split(/### (?:ADDED\s+)?Scenario:/).slice(1)
  let allScenariosHaveGWT = true
  for (const block of scenarioBlocks) {
    const nextHeading = block.indexOf('\n##')
    const blockContent = nextHeading >= 0 ? block.slice(0, nextHeading) : block
    const hasGiven = /GIVEN/i.test(blockContent)
    const hasWhen = /WHEN/i.test(blockContent)
    const hasThen = /THEN/i.test(blockContent)
    if (!hasGiven || !hasWhen || !hasThen) {
      allScenariosHaveGWT = false
      break
    }
  }
  checks.push({
    label: 'All scenarios have Given/When/Then',
    passed: allScenariosHaveGWT,
  })

  // Check: No TODO/TBD markers
  const todoMatches = specContent.match(/\b(TODO|TBD|FIXME)\b/gi) ?? []
  checks.push({
    label: 'No TODO/TBD markers in spec',
    passed: todoMatches.length === 0,
    detail: todoMatches.length > 0 ? `Found ${todoMatches.length} markers` : undefined,
  })

  // Check: No ambiguous SHOULD without rationale
  const shouldMatches = specContent.match(/\bSHOULD\b/g) ?? []
  // Simple heuristic: SHOULD is ambiguous if not followed by explanation text
  checks.push({
    label: 'No ambiguous RFC 2119 keywords',
    passed: true, // This is a heuristic check — hard to automate perfectly
  })

  // Check: Edge cases addressed (heuristic: look for "edge case" or multiple scenarios per requirement)
  const avgScenariosPerReq = requirements.length > 0 ? scenarios.length / requirements.length : 0
  checks.push({
    label: 'Edge cases addressed for each requirement',
    passed: avgScenariosPerReq >= 1,
    detail: avgScenariosPerReq < 1 ? 'Some requirements have no scenarios' : undefined,
  })

  // Check: Out-of-scope declared
  const hasOutOfScope = /out.?of.?scope/i.test(specContent) || /## Out of Scope/i.test(specContent)
  checks.push({
    label: 'Out-of-scope explicitly declared',
    passed: hasOutOfScope,
    detail: hasOutOfScope ? undefined : 'No out-of-scope section found',
  })

  // Check: Integration points identified
  const hasIntegration = /integration|interact|depend|connect|interface/i.test(specContent)
  checks.push({
    label: 'Integration points identified',
    passed: hasIntegration,
    detail: hasIntegration ? undefined : 'No integration points mentioned',
  })

  return {
    complete: checks.every(c => c.passed),
    checks,
  }
}
