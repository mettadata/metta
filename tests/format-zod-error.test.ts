import { describe, it, expect } from 'vitest'
import { z, ZodError } from 'zod'
import { formatZodError } from '../src/util/format-zod-error.js'

function zodErrorFrom(schema: z.ZodTypeAny, value: unknown): ZodError {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('expected schema to reject value')
  return result.error
}

describe('formatZodError', () => {
  it('renders a single issue as a path: message line', () => {
    const schema = z.object({ release: z.object({ scheme: z.literal('semver') }) })
    const err = zodErrorFrom(schema, { release: { scheme: 'calver' } })
    const formatted = formatZodError(err)
    expect(formatted).toBe(`release.scheme: ${err.issues[0].message}`)
    expect(formatted).not.toContain('[')
    expect(formatted).not.toContain('"code"')
  })

  it('renders multiple issues as newline-joined lines', () => {
    const schema = z.object({ a: z.string(), b: z.number() })
    const err = zodErrorFrom(schema, { a: 1, b: 'x' })
    const lines = formatZodError(err).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(`a: ${err.issues[0].message}`)
    expect(lines[1]).toBe(`b: ${err.issues[1].message}`)
  })

  it('renders nested paths dot-joined, including array indices', () => {
    const schema = z.object({ specs: z.object({ items: z.array(z.string()) }) })
    const err = zodErrorFrom(schema, { specs: { items: ['ok', 42] } })
    expect(formatZodError(err)).toBe(`specs.items.1: ${err.issues[0].message}`)
  })

  it('renders an empty-path issue as the bare message (no leading colon)', () => {
    const schema = z.string()
    const err = zodErrorFrom(schema, 42)
    const formatted = formatZodError(err)
    expect(formatted).toBe(err.issues[0].message)
    expect(formatted.startsWith(':')).toBe(false)
  })

  it('escapes raw control characters from hostile values as \\uXXXX sequences', () => {
    const schema = z.object({ release: z.object({ scheme: z.enum(['semver', 'calver']) }) })
    const hostile = '\x1b[31mevil\x1b[0m'
    const err = zodErrorFrom(schema, { release: { scheme: hostile } })
    const formatted = formatZodError(err)
    expect(formatted).toContain('\\u001b')
    expect(formatted).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
  })

  it('prepends the prefix option to every line', () => {
    const schema = z.object({ a: z.string(), b: z.number() })
    const err = zodErrorFrom(schema, { a: 1, b: 'x' })
    const lines = formatZodError(err, { prefix: '  - ' }).split('\n')
    expect(lines[0]).toBe(`  - a: ${err.issues[0].message}`)
    expect(lines[1]).toBe(`  - b: ${err.issues[1].message}`)
  })
})
