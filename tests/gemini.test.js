import { describe, expect, it } from 'vitest'
import {
  normalizeOpenRouterModel,
  OPENROUTER_PROVIDER,
  sortOpenRouterModels,
} from '../core.js'

describe('OpenRouter model normalization', () => {
  it('normalizes input modalities into app model metadata', () => {
    const model = normalizeOpenRouterModel({
      id: 'openai/gpt-5.4',
      name: 'GPT-5.4',
      context_length: 400000,
      architecture: {
        input_modalities: ['text', 'file', 'image'],
      },
    })

    expect(model.id).toBe('openai/gpt-5.4')
    expect(model.supportsText).toBe(true)
    expect(model.supportsFile).toBe(true)
    expect(model.contextLength).toBe(400000)
  })

  it('sorts file-capable models first when native-file mode prefers them', () => {
    const sorted = sortOpenRouterModels([
      { id: 'text-only', label: 'Text Only', supportsFile: false, contextLength: 900000 },
      { id: 'file-capable', label: 'File Capable', supportsFile: true, contextLength: 200000 },
    ], { preferFile: true })

    expect(sorted[0].id).toBe('file-capable')
  })

  it('keeps provider constant stable', () => {
    expect(OPENROUTER_PROVIDER).toBe('openrouter')
  })
})
