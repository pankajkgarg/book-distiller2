import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGeminiService } from '../gemini.js'

vi.mock('https://esm.run/@google/genai@0.14.1', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn()
    }
  })),
  createUserContent: vi.fn((parts) => ({ role: 'user', parts })),
  createPartFromUri: vi.fn((uri, mimeType) => ({ fileData: { fileUri: uri, mimeType } }))
}))

const mockGenerateContent = vi.fn()
vi.mocked(await import('https://esm.run/@google/genai@0.14.1')).GoogleGenAI.mockImplementation(() => ({
  models: { generateContent: mockGenerateContent }
}))

describe('Gemini Service', () => {
  let service
  let mockOnTransient

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnTransient = vi.fn()
    service = createGeminiService({
      apiKey: 'test-key',
      shouldContinue: () => true,
      onTransient: mockOnTransient
    })
  })

  describe('parseRetryDelay', () => {
    it('should extract retry delay from RetryInfo', () => {
      const err = {
        error: {
          details: [{
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: { seconds: 5, nanos: 500000000 }
          }]
        }
      }
      const delay = service.parseRetryDelay(err)
      expect(delay).toBe(5500)
    })

    it('should parse string delay format', () => {
      const err = {
        error: {
          details: [{
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '3.5s'
          }]
        }
      }
      const delay = service.parseRetryDelay(err)
      expect(delay).toBe(3500)
    })

    it('should parse Retry-After header', () => {
      const err = {
        response: {
          headers: {
            get: vi.fn().mockReturnValue('10')
          }
        }
      }
      const delay = service.parseRetryDelay(err)
      expect(delay).toBe(10000)
    })

    it('should return null for invalid input', () => {
      expect(service.parseRetryDelay({})).toBe(null)
      expect(service.parseRetryDelay(null)).toBe(null)
    })
  })

  describe('isTransient', () => {
    it('should identify transient HTTP status codes', () => {
      expect(service.isTransient({ status: 429 })).toBe(true)
      expect(service.isTransient({ status: 500 })).toBe(true)
      expect(service.isTransient({ status: 502 })).toBe(true)
      expect(service.isTransient({ response: { status: 429 } })).toBe(true)
    })

    it('should identify transient gRPC status codes', () => {
      expect(service.isTransient({ error: { status: 'RESOURCE_EXHAUSTED' } })).toBe(true)
      expect(service.isTransient({ error: { status: 'INTERNAL' } })).toBe(true)
      expect(service.isTransient({ error: { status: 'UNAVAILABLE' } })).toBe(true)
    })

    it('should handle string status on root error object', () => {
      expect(service.isTransient({ status: 'RESOURCE_EXHAUSTED' })).toBe(true)
      expect(service.isTransient({ status: 'deadline_exceeded' })).toBe(true)
    })

    it('should identify non-transient errors', () => {
      expect(service.isTransient({ status: 400 })).toBe(false)
      expect(service.isTransient({ status: 401 })).toBe(false)
      expect(service.isTransient({ status: 404 })).toBe(false)
    })

    it('should handle offline status', () => {
      const originalNavigator = global.navigator
      global.navigator = { onLine: false }
      expect(service.isTransient({})).toBe(true)
      global.navigator = originalNavigator
    })
  })

  describe('extractText', () => {
    it('should extract text from response candidates', () => {
      const resp = {
        raw: {
          candidates: [{
            content: {
              parts: [
                { text: 'Hello ' },
                { text: 'World' }
              ]
            }
          }]
        }
      }
      expect(service.extractText(resp)).toBe('Hello World')
    })

    it('should handle empty response', () => {
      expect(service.extractText({})).toBe('')
      expect(service.extractText(null)).toBe('')
    })

    it('should handle response without parts', () => {
      const resp = {
        raw: {
          candidates: [{
            content: {}
          }]
        }
      }
      expect(service.extractText(resp)).toBe('')
    })
  })

  describe('callWithRetries', () => {
    it('should return successful response on first try', async () => {
      const mockResponse = { text: 'success' }
      mockGenerateContent.mockResolvedValueOnce(mockResponse)

      const [result, attempts, error] = await service.callWithRetries({ model: 'test' })

      expect(result).toEqual(mockResponse)
      expect(attempts).toBe(0)
      expect(error).toBe(null)
    })

    it('should retry on transient errors', async () => {
      const transientError = new Error('Rate limited')
      transientError.status = 429
      const mockResponse = { text: 'success' }

      mockGenerateContent
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(mockResponse)

      const [result, attempts, error] = await service.callWithRetries({ model: 'test' })

      expect(result).toEqual(mockResponse)
      expect(attempts).toBe(1)
      expect(error).toBe(null)
      expect(mockOnTransient).toHaveBeenCalledWith({
        attempt: 0,
        waitMs: expect.any(Number),
        err: transientError
      })
    })

    it('should not retry on non-transient errors', async () => {
      const nonTransientError = new Error('Bad request')
      nonTransientError.status = 400

      mockGenerateContent.mockRejectedValueOnce(nonTransientError)

      const [result, attempts, error] = await service.callWithRetries({ model: 'test' })

      expect(result).toBe(null)
      expect(attempts).toBe(0)
      expect(error).toBe(nonTransientError)
      expect(mockOnTransient).not.toHaveBeenCalled()
    })

    it('should stop retrying when shouldContinue returns false', async () => {
      const transientError = new Error('Rate limited')
      transientError.status = 429

      mockGenerateContent.mockRejectedValue(transientError)
      
      const mockShouldContinue = vi.fn()
        .mockReturnValueOnce(true)  // First attempt
        .mockReturnValueOnce(false) // Stop retrying

      const serviceWithStopCondition = createGeminiService({
        apiKey: 'test-key',
        shouldContinue: mockShouldContinue,
        onTransient: mockOnTransient
      })

      const [result, attempts, error] = await serviceWithStopCondition.callWithRetries({ model: 'test' })

      expect(result).toBe(null)
      expect(error).toBeTruthy()
      expect(mockShouldContinue).toHaveBeenCalled()
    })
  })

  describe('callWithRetriesFn', () => {
    it('should execute function successfully', async () => {
      const mockFn = vi.fn().mockResolvedValue('success')
      
      const [result, attempts, error] = await service.callWithRetriesFn(mockFn)

      expect(result).toBe('success')
      expect(attempts).toBe(0)
      expect(error).toBe(null)
      expect(mockFn).toHaveBeenCalledOnce()
    })

    it('should retry function on transient errors', async () => {
      const transientError = new Error('Server error')
      transientError.status = 500
      const mockFn = vi.fn()
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce('success')

      const [result, attempts, error] = await service.callWithRetriesFn(mockFn)

      expect(result).toBe('success')
      expect(attempts).toBe(1)
      expect(error).toBe(null)
      expect(mockFn).toHaveBeenCalledTimes(2)
    })
  })
})
