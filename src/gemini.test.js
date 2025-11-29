import { describe, it, expect, vi } from 'vitest'
import { createGeminiService, createUserContent, createPartFromUri } from './gemini.js'

describe('gemini.js helpers', () => {
    it('createUserContent creates correct structure', () => {
        const content = createUserContent(['hello'])
        expect(content).toEqual({ role: 'user', parts: ['hello'] })
    })

    it('createPartFromUri creates correct structure', () => {
        const part = createPartFromUri('gs://foo', 'application/pdf')
        expect(part).toEqual({ fileData: { fileUri: 'gs://foo', mimeType: 'application/pdf' } })
    })
})

describe('createGeminiService', () => {
    it('initializes with api key', () => {
        const svc = createGeminiService({ apiKey: 'test-key' })
        expect(svc.ai).toBeDefined()
    })

    it('identifies transient errors', () => {
        const svc = createGeminiService({ apiKey: 'test' })
        expect(svc.isTransient({ status: 429 })).toBe(true)
        expect(svc.isTransient({ status: 503 })).toBe(true)
        expect(svc.isTransient({ status: 400 })).toBe(false)
    })

    it('parses retry delay from headers', () => {
        const svc = createGeminiService({ apiKey: 'test' })
        const err = { response: { headers: { get: (h) => h === 'retry-after' ? '5' : null } } }
        expect(svc.parseRetryDelay(err)).toBe(5000)
    })
})
