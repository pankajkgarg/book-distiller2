import { describe, expect, it } from 'vitest'
import {
  filterModelsByQuery,
  filterRecentOpenRouterModels,
  normalizeOpenRouterModel,
  normalizeTimestamp,
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

describe('OpenRouter model filtering', () => {
  it('normalizes unix-second and millisecond timestamps to milliseconds', () => {
    expect(normalizeTimestamp(1767225600)).toBe(1767225600000)
    expect(normalizeTimestamp(1767225600000)).toBe(1767225600000)
    expect(normalizeTimestamp(undefined)).toBe(0)
    expect(normalizeTimestamp('not-a-date')).toBe(0)
  })

  it('keeps only models created within the recency window', () => {
    const now = Date.UTC(2026, 6, 1)
    const recent = { id: 'new', createdAt: Date.UTC(2026, 0, 1) }
    const old = { id: 'old', createdAt: Date.UTC(2024, 0, 1) }
    const missing = { id: 'missing', createdAt: 0 }

    const kept = filterRecentOpenRouterModels([recent, old, missing], { nowMs: now, months: 12 })
    expect(kept.map(model => model.id)).toEqual(['new'])
  })

  it('filters models by every whitespace-separated query term', () => {
    const models = [
      { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
      { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2' },
    ]

    expect(filterModelsByQuery(models, '')).toHaveLength(2)
    expect(filterModelsByQuery(models, 'claude sonnet')).toHaveLength(1)
    expect(filterModelsByQuery(models, 'claude deepseek')).toHaveLength(0)
    expect(filterModelsByQuery(models, 'DEEPSEEK')[0].id).toBe('deepseek/deepseek-v3.2')
  })
})
