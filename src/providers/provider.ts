import { z } from 'zod'

export interface GenerateOptions {
  maxTokens?: number
  temperature?: number
  system?: string
  stopSequences?: string[]
}

export interface AIProvider {
  id: string
  generateText(prompt: string, options?: GenerateOptions): Promise<string>
  generateObject<T>(prompt: string, schema: z.ZodSchema<T>, options?: GenerateOptions): Promise<T>
  streamText(prompt: string, options?: GenerateOptions): AsyncGenerator<string>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class ProviderRegistry {
  private providers = new Map<string, AIProvider>()

  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): AIProvider {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`Provider '${id}' not registered`)
    }
    return provider
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  list(): string[] {
    return Array.from(this.providers.keys())
  }
}
