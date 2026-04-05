import { describe, it, expect } from 'vitest'
import { ProviderRegistry, ProviderError } from '../src/providers/provider.js'
import type { AIProvider, GenerateOptions } from '../src/providers/provider.js'
import { z } from 'zod'

class MockProvider implements AIProvider {
  id = 'mock'
  responses: string[] = []
  callCount = 0

  async generateText(prompt: string, _options?: GenerateOptions): Promise<string> {
    this.callCount++
    return this.responses.shift() ?? `response to: ${prompt}`
  }

  async generateObject<T>(prompt: string, schema: z.ZodSchema<T>, _options?: GenerateOptions): Promise<T> {
    const text = await this.generateText(prompt)
    const parsed = JSON.parse(text)
    return schema.parse(parsed)
  }

  async *streamText(prompt: string, _options?: GenerateOptions): AsyncGenerator<string> {
    const text = await this.generateText(prompt)
    for (const char of text) {
      yield char
    }
  }
}

describe('ProviderRegistry', () => {
  it('registers and retrieves a provider', () => {
    const registry = new ProviderRegistry()
    const mock = new MockProvider()
    registry.register(mock)
    expect(registry.get('mock')).toBe(mock)
  })

  it('throws for unregistered provider', () => {
    const registry = new ProviderRegistry()
    expect(() => registry.get('nope')).toThrow("Provider 'nope' not registered")
  })

  it('checks provider existence', () => {
    const registry = new ProviderRegistry()
    const mock = new MockProvider()
    registry.register(mock)
    expect(registry.has('mock')).toBe(true)
    expect(registry.has('nope')).toBe(false)
  })

  it('lists registered providers', () => {
    const registry = new ProviderRegistry()
    const mock1 = new MockProvider()
    mock1.id = 'provider-a'
    const mock2 = new MockProvider()
    mock2.id = 'provider-b'
    registry.register(mock1)
    registry.register(mock2)
    expect(registry.list()).toEqual(['provider-a', 'provider-b'])
  })
})

describe('ProviderError', () => {
  it('includes provider id and status code', () => {
    const err = new ProviderError('Rate limited', 'anthropic', 429, 60)
    expect(err.name).toBe('ProviderError')
    expect(err.message).toBe('Rate limited')
    expect(err.provider).toBe('anthropic')
    expect(err.statusCode).toBe(429)
    expect(err.retryAfter).toBe(60)
  })
})

describe('MockProvider', () => {
  it('generates text', async () => {
    const mock = new MockProvider()
    mock.responses = ['hello world']
    const result = await mock.generateText('say hello')
    expect(result).toBe('hello world')
  })

  it('generates typed objects', async () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    const mock = new MockProvider()
    mock.responses = [JSON.stringify({ name: 'Alice', age: 30 })]
    const result = await mock.generateObject('get user', schema)
    expect(result).toEqual({ name: 'Alice', age: 30 })
  })

  it('streams text', async () => {
    const mock = new MockProvider()
    mock.responses = ['hi']
    const chunks: string[] = []
    for await (const chunk of mock.streamText('greet')) {
      chunks.push(chunk)
    }
    expect(chunks.join('')).toBe('hi')
  })
})
