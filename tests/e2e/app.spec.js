import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, '..', 'fixtures')

const pdfFixture = path.join(fixturesDir, 'tiny-book.pdf')
const epubFixture = path.join(fixturesDir, 'tiny-book.epub')

async function resetApp(page, overrides = {}) {
  await page.addInitScript((values) => {
    localStorage.clear()
    if (values.provider) localStorage.setItem('distillboard.provider', values.provider)
    if (values.sourceMode) localStorage.setItem('distillboard.source_mode', values.sourceMode)
    if (values.model) localStorage.setItem('distillboard.model', values.model)
    if (values.providerKeys) localStorage.setItem('distillboard.provider_keys', JSON.stringify(values.providerKeys))
    if (values.prompt) localStorage.setItem('distillboard.prompt', values.prompt)
  }, overrides)
  await page.goto('/')
}

async function stubOpenRouterModels(page, models = []) {
  await page.addInitScript((payload) => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'https://openrouter.ai/api/v1/models') {
        return new Response(JSON.stringify({ data: payload.models }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return nativeFetch(input, init)
    }
  }, { models })
}

// Model `created` stamps must stay relative to the real clock: the app filters
// models to the last 12 months, so absolute dates rot as time passes.
function monthsAgoUnixSeconds(months) {
  const date = new Date()
  date.setMonth(date.getMonth() - months)
  return Math.floor(date.getTime() / 1000)
}

test('PDF upload shows local word/token/page stats', async ({ page }) => {
  await resetApp(page)
  await page.getByTestId('file-input').setInputFiles(pdfFixture)

  await expect(page.getByTestId('source-analysis-summary')).toContainText('Words:')
  await expect(page.getByTestId('source-analysis-summary')).toContainText('Est. tokens:')
  await expect(page.getByTestId('source-analysis-summary')).toContainText('Pages: 1')
})

test('EPUB upload shows local word/token/chapter stats', async ({ page }) => {
  await resetApp(page)
  await page.getByTestId('file-input').setInputFiles(epubFixture)

  await expect(page.getByTestId('source-analysis-summary')).toContainText('Words:')
  await expect(page.getByTestId('source-analysis-summary')).toContainText('Est. tokens:')
  await expect(page.getByTestId('source-analysis-summary')).toContainText('Chapters: 2')
})

test('OpenRouter native mode blocks EPUB runs', async ({ page }) => {
  await stubOpenRouterModels(page, [
    {
      id: 'openai/gpt-5.4',
      name: 'GPT-5.4',
      created: monthsAgoUnixSeconds(2),
      context_length: 400000,
      architecture: { input_modalities: ['text', 'file', 'image'] },
    },
  ])
  await resetApp(page)

  await page.getByTestId('provider-select').selectOption('openrouter')
  await expect(page.getByTestId('model-select')).toContainText('GPT-5.4')
  await page.getByTestId('api-key-input').fill('test-openrouter-key')
  await page.getByTestId('source-mode-select').selectOption('native-file')
  await page.getByTestId('file-input').setInputFiles(epubFixture)
  await page.getByTestId('start-button').click()

  await expect(page.getByTestId('toast-host')).toContainText('OpenRouter native file mode currently requires PDF')
  await expect(page.getByTestId('status-badge')).toContainText('idle')
})

test('OpenRouter provider refreshes model options by source mode', async ({ page }) => {
  await stubOpenRouterModels(page, [
    {
      id: 'file-model',
      name: 'File Model',
      created: monthsAgoUnixSeconds(3),
      context_length: 200000,
      architecture: { input_modalities: ['text', 'file'] },
    },
    {
      id: 'text-model',
      name: 'Text Model',
      created: monthsAgoUnixSeconds(4),
      context_length: 300000,
      architecture: { input_modalities: ['text'] },
    },
  ])
  await resetApp(page)

  await page.getByTestId('provider-select').selectOption('openrouter')
  await expect(page.getByTestId('model-select')).toContainText('File Model')
  await expect(page.getByTestId('model-select')).not.toContainText('Text Model')

  await page.getByTestId('source-mode-select').selectOption('extracted-text')
  await expect(page.getByTestId('model-select')).toContainText('Text Model')
  await expect(page.getByTestId('model-select')).toContainText('File Model')
})

test('OpenRouter model list only shows recent models and supports text filtering', async ({ page }) => {
  await stubOpenRouterModels(page, [
    {
      id: 'google/gemma-4-31b-it:free',
      name: 'Gemma 4 31B',
      created: monthsAgoUnixSeconds(2),
      context_length: 128000,
      architecture: { input_modalities: ['text'] },
    },
    {
      id: 'nvidia/nemotron-3-super-120b-a12b:free',
      name: 'Nemotron 3 Super',
      created: monthsAgoUnixSeconds(11),
      context_length: 128000,
      architecture: { input_modalities: ['text'] },
    },
    {
      id: 'openai/gpt-4-legacy',
      name: 'GPT-4 Legacy',
      created: monthsAgoUnixSeconds(20),
      context_length: 32000,
      architecture: { input_modalities: ['text'] },
    },
  ])
  await resetApp(page)

  await page.getByTestId('provider-select').selectOption('openrouter')
  await page.getByTestId('source-mode-select').selectOption('extracted-text')

  const modelSelect = page.getByTestId('model-select')
  await expect(modelSelect).toContainText('Gemma 4 31B')
  await expect(modelSelect).toContainText('Nemotron 3 Super')
  await expect(modelSelect).not.toContainText('GPT-4 Legacy')
  await expect(page.getByText('Showing 2 of 2 models from the last 12 months.')).toBeVisible()

  await page.getByTestId('model-search-input').fill('gemma')
  await expect(modelSelect).toContainText('Gemma 4 31B')
  await expect(modelSelect).not.toContainText('Nemotron 3 Super')
  await expect(page.getByText('Showing 1 of 2 models from the last 12 months.')).toBeVisible()
})
