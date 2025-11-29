import { describe, it, expect, vi } from 'vitest'

function sim3(a, b) {
  const grams = s => {
    const t = (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const G = new Set()
    for (let i = 0; i < Math.max(0, t.length - 2); i++) G.add(t.slice(i, i + 3))
    return G
  }
  const A = grams(a), B = grams(b)
  const inter = [...A].filter(x => B.has(x)).length
  const union = new Set([...A, ...B]).size || 1
  return inter / union
}

function stripMd(md) {
  return (md || '').replace(/[>#*_`~\-]+/g, '').replace(/\n{3,}/g, '\n\n')
}

function estimateTokens(s) {
  return Math.ceil((s || '').length / 4)
}

describe('Utility Functions', () => {
  describe('sim3', () => {
    it('should return 1 for identical strings', () => {
      expect(sim3('hello world', 'hello world')).toBe(1)
    })

    it('should return 0 for completely different strings', () => {
      expect(sim3('abc', 'xyz')).toBe(0)
    })

    it('should handle empty strings', () => {
      expect(sim3('', '')).toBe(0)
      expect(sim3('hello', '')).toBe(0)
      expect(sim3('', 'world')).toBe(0)
    })

    it('should handle undefined/null inputs', () => {
      expect(sim3(null, null)).toBe(0)
      expect(sim3(undefined, undefined)).toBe(0)
      expect(sim3('hello', null)).toBe(0)
    })

    it('should calculate similarity for partial matches', () => {
      const similarity = sim3('hello world', 'hello there')
      expect(similarity).toBeGreaterThan(0)
      expect(similarity).toBeLessThan(1)
    })

    it('should be case insensitive', () => {
      expect(sim3('Hello World', 'hello world')).toBe(1)
    })

    it('should handle whitespace normalization', () => {
      expect(sim3('hello  world', 'hello world')).toBe(1)
      expect(sim3('hello\tworld', 'hello world')).toBe(1)
    })
  })

  describe('stripMd', () => {
    it('should remove markdown symbols', () => {
      expect(stripMd('# Header')).toBe(' Header')
      expect(stripMd('**bold** text')).toBe('bold text')
      expect(stripMd('*italic* text')).toBe('italic text')
    })

    it('should remove code markers', () => {
      expect(stripMd('`code` here')).toBe('code here')
      expect(stripMd('~~strikethrough~~')).toBe('strikethrough')
    })

    it('should collapse multiple newlines', () => {
      expect(stripMd('line1\n\n\n\nline2')).toBe('line1\n\nline2')
    })

    it('should handle empty or null input', () => {
      expect(stripMd('')).toBe('')
      expect(stripMd(null)).toBe('')
      expect(stripMd(undefined)).toBe('')
    })

    it('should handle mixed markdown', () => {
      const input = '# Title\n\n**Bold** and *italic* with `code`'
      const expected = ' Title\n\nBold and italic with code'
      expect(stripMd(input)).toBe(expected)
    })
  })

  describe('estimateTokens', () => {
    it('should estimate tokens by dividing length by 4', () => {
      expect(estimateTokens('hello')).toBe(2) // Math.ceil(5/4) = 2
      expect(estimateTokens('hello world')).toBe(3) // Math.ceil(11/4) = 3
    })

    it('should handle empty strings', () => {
      expect(estimateTokens('')).toBe(0)
      expect(estimateTokens(null)).toBe(0)
      expect(estimateTokens(undefined)).toBe(0)
    })

    it('should round up using Math.ceil', () => {
      expect(estimateTokens('abc')).toBe(1) // Math.ceil(3/4) = 1
      expect(estimateTokens('abcd')).toBe(1) // Math.ceil(4/4) = 1
      expect(estimateTokens('abcde')).toBe(2) // Math.ceil(5/4) = 2
    })

    it('should handle longer text', () => {
      const text = 'This is a longer text that should be estimated correctly'
      expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4))
    })
  })
})