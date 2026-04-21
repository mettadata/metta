import { describe, it, expect } from 'vitest'
import { repairProjectConfig } from './repair-config.js'

describe('repairProjectConfig', () => {
  it('dedups three duplicate keys keeping last occurrence', () => {
    const source = `project:
  name: test
  stacks: ["js"]
  stacks: ["rust"]
  stacks: ["py"]
`
    const result = repairProjectConfig(source)

    expect(result.changed).toBe(true)
    expect(result.duplicatesRemoved.length).toBe(2)

    const stacksLines = result.source.match(/^\s*stacks:/gm)
    expect(stacksLines).not.toBeNull()
    expect(stacksLines!.length).toBe(1)

    expect(result.source).toMatch(/stacks:\s*\[\s*["']py["']\s*\]/)
    expect(result.source).not.toMatch(/stacks:\s*\[\s*["']js["']\s*\]/)
    expect(result.source).not.toMatch(/stacks:\s*\[\s*["']rust["']\s*\]/)
  })

  it('drops schema-invalid top-level keys', () => {
    const source = `project:
  name: test
foo: "bar"
`
    const result = repairProjectConfig(source)

    expect(result.changed).toBe(true)
    expect(result.invalidKeysRemoved.some((entry) => entry.includes("'foo'"))).toBe(true)
    expect(result.source).not.toMatch(/^\s*foo:/m)
  })

  it('leaves already-valid config unchanged', () => {
    const source = `project:
  name: test
  stacks: ["rust"]
`
    const result = repairProjectConfig(source)

    expect(result.changed).toBe(false)
    expect(result.source).toBe(source)
  })

  it('passes through malformed YAML without throwing', () => {
    const source = `project:
  name: test
  - this: is: bad`

    let result: ReturnType<typeof repairProjectConfig> | undefined
    expect(() => {
      result = repairProjectConfig(source)
    }).not.toThrow()

    expect(result).toBeDefined()
    expect(result!.changed).toBe(false)
    expect(result!.source).toBe(source)
  })
})
