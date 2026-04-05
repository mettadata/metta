import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { type AIProvider, type GenerateOptions, ProviderError } from './provider.js'

export interface AnthropicProviderConfig {
  apiKey?: string
  apiKeyEnv?: string
  model?: string
  maxRetries?: number
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic'
  private client: Anthropic
  private model: string
  private maxRetries: number

  constructor(config: AnthropicProviderConfig = {}) {
    const apiKey = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined)
    this.client = new Anthropic({ apiKey })
    this.model = config.model ?? 'claude-sonnet-4-6-20250414'
    this.maxRetries = config.maxRetries ?? 1
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
    return this.withRetry(async () => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature,
        system: options?.system,
        stop_sequences: options?.stopSequences,
        messages: [{ role: 'user', content: prompt }],
      })

      const textBlock = response.content.find(block => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        throw new ProviderError('No text content in response', this.id)
      }
      return textBlock.text
    })
  }

  async generateObject<T>(prompt: string, schema: z.ZodSchema<T>, options?: GenerateOptions): Promise<T> {
    const systemPrompt = [
      options?.system ?? '',
      'You MUST respond with valid JSON only. No markdown, no explanation, no code fences. Just the JSON object.',
    ].filter(Boolean).join('\n\n')

    const text = await this.generateText(prompt, { ...options, system: systemPrompt })

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ProviderError(
        `Provider returned invalid JSON: ${text.slice(0, 200)}`,
        this.id,
      )
    }

    const result = schema.safeParse(parsed)
    if (!result.success) {
      throw new ProviderError(
        `Provider response failed schema validation: ${result.error.message}`,
        this.id,
      )
    }

    return result.data
  }

  async *streamText(prompt: string, options?: GenerateOptions): AsyncGenerator<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature,
      system: options?.system ?? undefined,
      stop_sequences: options?.stopSequences,
      messages: [{ role: 'user', content: prompt }],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err))

        if (err instanceof Anthropic.RateLimitError) {
          const retryAfter = 60
          throw new ProviderError(
            `Rate limited by Anthropic. Retry after ${retryAfter}s.`,
            this.id,
            429,
            retryAfter,
          )
        }

        if (attempt < this.maxRetries) continue
      }
    }
    throw lastError
  }
}
