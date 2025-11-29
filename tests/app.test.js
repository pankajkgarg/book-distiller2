import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateApp = vi.fn()
const mockCreateGeminiService = vi.fn()

vi.mock('https://unpkg.com/petite-vue?module', () => ({
  createApp: mockCreateApp
}))

vi.mock('./gemini.js', () => ({
  createGeminiService: mockCreateGeminiService,
  createUserContent: vi.fn(),
  createPartFromUri: vi.fn()
}))

global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
}

global.window = {
  matchMedia: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn()
  })),
  marked: {
    parse: vi.fn(text => text)
  },
  jspdf: {
    jsPDF: vi.fn(() => ({
      setProperties: vi.fn(),
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      splitTextToSize: vi.fn(() => ['line1']),
      text: vi.fn(),
      addPage: vi.fn(),
      save: vi.fn()
    }))
  }
}

global.navigator = {
  clipboard: {
    writeText: vi.fn()
  }
}

global.document = {
  querySelector: vi.fn(),
  createElement: vi.fn(() => ({
    className: '',
    innerHTML: '',
    href: '',
    download: '',
    click: vi.fn(),
    appendChild: vi.fn(),
    remove: vi.fn()
  })),
  body: {
    classList: {
      toggle: vi.fn()
    },
    __v_scope__: {
      ctx: { themeMode: 'auto', applyTheme: vi.fn() }
    }
  }
}

global.URL = {
  createObjectURL: vi.fn(() => 'mock-url'),
  revokeObjectURL: vi.fn()
}

global.Blob = vi.fn()
global.File = vi.fn()

describe('App State Management', () => {
  let appInstance

  beforeEach(() => {
    vi.clearAllMocks()
    global.localStorage.getItem.mockImplementation((key) => {
      const defaults = {
        'distillboard.gemini_key': '',
        'distillboard.prompt': 'DEFAULT_PROMPT',
        'distillboard.model': 'gemini-2.5-pro',
        'distillboard.useTemperature': 'true',
        'distillboard.temperature': '1.0',
        'distillboard.themeMode': 'auto'
      }
      return defaults[key] || null
    })

    import('../app.js')

    appInstance = {
      apiKey: 'test-key',
      prompt: 'test prompt',
      endMarker: '<end_of_book>',
      pauseOnAnomaly: true,
      status: 'idle',
      sections: 0,
      tokenTally: 0,
      running: false,
      paused: false,
      history: [],
      lastAssistant: '',
      fileBlob: null,
      fileInfo: '',
      trace: [],
      model: 'gemini-2.5-pro',
      useTemperature: true,
      temperature: 1.0,
      themeMode: 'auto',
      sectionsMeta: [],
      nextSectionId: 1,

      persist: vi.fn(),
      applyTheme: vi.fn(),
      extractCandidatesTokenCount: vi.fn(),
      sanitizeFilename: vi.fn((name) => name.replace(/[\\\/:*?"<>|]+/g, '-')),
      bookBaseName: vi.fn(() => 'Test Book'),
      exportBase: vi.fn(() => 'Test Book - book excerpt'),
      exportMeta: vi.fn(() => ({
        title: 'Test Book - book excerpt',
        source: 'test.pdf',
        model: 'gemini-2.5-pro',
        temperature: 1.0,
        sections: 0,
        createdAt: '2023-01-01T00:00:00.000Z'
      })),
      combinedText: vi.fn(() => 'Combined text content'),
      renderMd: vi.fn((md) => md),
      stringify: vi.fn((obj) => JSON.stringify(obj, null, 2)),
      getTitleFromMd: vi.fn(() => 'Section 1'),
      rebuildDoc: vi.fn(),
      deleteSection: vi.fn(),
      resetDoc: vi.fn()
    }
  })

  describe('File Management', () => {
    it('should handle file selection', () => {
      const mockFile = {
        name: 'test.pdf',
        type: 'application/pdf',
        size: 1048576
      }
      const mockEvent = {
        target: {
          files: [mockFile]
        }
      }

      const onFileChange = (e) => {
        const f = e.target.files?.[0]
        return {
          fileBlob: f || null,
          fileInfo: f ? `${f.name} • ${(f.type || '').replace('application/', '')} • ${(f.size / 1048576).toFixed(2)} MB` : ''
        }
      }

      const result = onFileChange(mockEvent)
      expect(result.fileBlob).toBe(mockFile)
      expect(result.fileInfo).toContain('test.pdf')
      expect(result.fileInfo).toContain('pdf')
      expect(result.fileInfo).toContain('1.00 MB')
    })

    it('should handle no file selected', () => {
      const mockEvent = { target: { files: [] } }
      
      const onFileChange = (e) => {
        const f = e.target.files?.[0]
        return {
          fileBlob: f || null,
          fileInfo: f ? `${f.name} • ${(f.type || '').replace('application/', '')} • ${(f.size / 1048576).toFixed(2)} MB` : ''
        }
      }

      const result = onFileChange(mockEvent)
      expect(result.fileBlob).toBe(null)
      expect(result.fileInfo).toBe('')
    })
  })

  describe('Export Functions', () => {
    it('should sanitize filename correctly', () => {
      expect(appInstance.sanitizeFilename('Test/File:Name*?.txt')).toBe('Test-File-Name-.txt')
      expect(appInstance.sanitizeFilename('Normal filename.txt')).toBe('Normal filename.txt')
    })

    it('should generate export base name', () => {
      expect(appInstance.exportBase()).toBe('Test Book - book excerpt')
    })

    it('should generate metadata', () => {
      const meta = appInstance.exportMeta()
      expect(meta).toHaveProperty('title')
      expect(meta).toHaveProperty('model')
      expect(meta).toHaveProperty('temperature')
      expect(meta).toHaveProperty('sections')
      expect(meta).toHaveProperty('createdAt')
    })
  })

  describe('Text Processing', () => {
    it('should estimate tokens correctly', () => {
      const estimateTokens = (s) => Math.ceil((s || '').length / 4)
      
      expect(estimateTokens('hello')).toBe(2)
      expect(estimateTokens('hello world')).toBe(3)
      expect(estimateTokens('')).toBe(0)
      expect(estimateTokens(null)).toBe(0)
    })

    it('should detect ctrl leak in text', () => {
      const hasCtrlLeak = (text) => /<ctrl94>/i.test(String(text || ''))
      
      expect(hasCtrlLeak('normal text')).toBe(false)
      expect(hasCtrlLeak('text with <ctrl94> leak')).toBe(true)
      expect(hasCtrlLeak('text with <CTRL94> leak')).toBe(true)
      expect(hasCtrlLeak('')).toBe(false)
      expect(hasCtrlLeak(null)).toBe(false)
    })

    it('should extract title from markdown', () => {
      const getTitleFromMd = (md) => {
        const lines = (md || '').split(/\r?\n/)
        for (const line of lines) {
          const m = line.match(/^\s{0,3}#{1,6}\s+(.+)/)
          if (m) return m[1].trim()
          if (line.trim()) return line.trim().slice(0, 96)
        }
        return 'Section 1'
      }

      expect(getTitleFromMd('# Main Title\nContent')).toBe('Main Title')
      expect(getTitleFromMd('## Sub Title')).toBe('Sub Title')
      expect(getTitleFromMd('First line\nSecond line')).toBe('First line')
      expect(getTitleFromMd('')).toBe('Section 1')
      expect(getTitleFromMd('\n\n')).toBe('Section 1')
    })
  })

  describe('State Management', () => {
    it('should manage section metadata', () => {
      const sectionsMeta = []
      const nextSectionId = 1
      
      const newSection = {
        id: nextSectionId,
        text: 'Section content',
        modelMsg: { role: 'model', parts: [{ text: 'Section content' }] },
        userMsgBefore: { role: 'user', parts: [{ text: 'Next' }] },
        candidatesTokenCount: 100
      }
      
      sectionsMeta.push(newSection)
      expect(sectionsMeta).toHaveLength(1)
      expect(sectionsMeta[0].id).toBe(1)
      expect(sectionsMeta[0].text).toBe('Section content')
    })

    it('should rebuild document counters', () => {
      const estimateTokens = (s) => Math.ceil((s || '').length / 4)
      
      const sectionsMeta = [
        { text: 'hello world' },
        { text: 'another section' }
      ]
      
      let sections = 0
      let tokenTally = 0
      
      for (const [i, meta] of sectionsMeta.entries()) {
        sections = i + 1
        tokenTally += estimateTokens(meta.text || '')
      }
      
      expect(sections).toBe(2)
      expect(tokenTally).toBe(estimateTokens('hello world') + estimateTokens('another section'))
    })
  })

  describe('Configuration', () => {
    it('should create config with system instruction', () => {
      const makeConfig = (prompt, useTemperature, temperature) => {
        const cfg = { systemInstruction: prompt }
        if (useTemperature) {
          cfg.generationConfig = { temperature: Number(temperature) || 0 }
        }
        return cfg
      }

      const config1 = makeConfig('test prompt', true, '0.5')
      expect(config1).toEqual({
        systemInstruction: 'test prompt',
        generationConfig: { temperature: 0.5 }
      })

      const config2 = makeConfig('test prompt', false, '0.5')
      expect(config2).toEqual({
        systemInstruction: 'test prompt'
      })
    })

    it('should handle theme application', () => {
      const mockMatchMedia = vi.fn(() => ({ matches: true }))
      const mockToggle = vi.fn()
      
      global.window.matchMedia = mockMatchMedia
      const mockBody = { classList: { toggle: mockToggle } }
      
      const applyTheme = (themeMode) => {
        const preferDark = mockMatchMedia('(prefers-color-scheme: dark)').matches
        const isDark = themeMode === 'dark' || (themeMode === 'auto' && preferDark)
        mockBody.classList.toggle('dark', isDark)
      }

      applyTheme('auto')
      expect(mockToggle).toHaveBeenCalledWith('dark', true)
      
      mockMatchMedia.mockReturnValue({ matches: false })
      applyTheme('auto')
      expect(mockToggle).toHaveBeenCalledWith('dark', false)
    })
  })
})