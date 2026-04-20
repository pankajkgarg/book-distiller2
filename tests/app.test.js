import { describe, expect, it } from 'vitest'
import {
  GOOGLE_PROVIDER,
  OPENROUTER_PROVIDER,
  SOURCE_MODE_EXTRACTED,
  chooseModel,
  combinedSectionsText,
  countWords,
  estimateTokens,
  getSavedKeysForProvider,
  isNextOnlyUserMessage,
  migrateLegacyStorage,
} from '../core.js'

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

describe('core state helpers', () => {
  it('migrates the legacy Gemini key into Google AI Studio storage', () => {
    const storage = createStorage({
      'distillboard.gemini_key': 'legacy-google-key',
      'distillboard.saved_keys': JSON.stringify([{ label: 'Old', key: 'legacy-google-key', created: 1 }]),
    })

    const migrated = migrateLegacyStorage(storage)

    expect(migrated.providerKeys[GOOGLE_PROVIDER]).toBe('legacy-google-key')
    expect(migrated.savedKeys[0].provider).toBe(GOOGLE_PROVIDER)
  })

  it('filters saved keys by provider', () => {
    const savedKeys = [
      { label: 'Google', key: 'g-key', provider: GOOGLE_PROVIDER, created: 1 },
      { label: 'Router', key: 'o-key', provider: OPENROUTER_PROVIDER, created: 2 },
    ]

    expect(getSavedKeysForProvider(savedKeys, GOOGLE_PROVIDER)).toHaveLength(1)
    expect(getSavedKeysForProvider(savedKeys, OPENROUTER_PROVIDER)[0].key).toBe('o-key')
  })

  it('chooses a valid model or falls back cleanly', () => {
    const models = [{ id: 'a' }, { id: 'b' }]

    expect(chooseModel('b', models, 'a')).toBe('b')
    expect(chooseModel('missing', models, 'a')).toBe('a')
    expect(chooseModel('missing', models, 'missing-too')).toBe('a')
  })

  it('recognizes next-only user messages across provider formats', () => {
    expect(isNextOnlyUserMessage({ role: 'user', parts: ['Next'] })).toBe(true)
    expect(isNextOnlyUserMessage({ role: 'user', content: 'Next' })).toBe(true)
    expect(isNextOnlyUserMessage({
      role: 'user',
      content: [{ type: 'text', text: 'Next' }],
    })).toBe(true)
    expect(isNextOnlyUserMessage({
      role: 'user',
      content: [{ type: 'text', text: 'Continue' }],
    })).toBe(false)
  })

  it('combines rendered sections in order', () => {
    const text = combinedSectionsText([{ text: 'One' }, { text: 'Two' }])
    expect(text).toBe('One\n\nTwo')
  })

  it('keeps extraction heuristics aligned', () => {
    const text = 'This is a short extracted sample'
    expect(countWords(text)).toBe(6)
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4))
    expect(SOURCE_MODE_EXTRACTED).toBe('extracted-text')
  })
})
