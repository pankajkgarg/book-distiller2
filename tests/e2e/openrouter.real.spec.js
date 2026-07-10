import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, '..', 'fixtures')
const epubFixture = path.join(fixturesDir, 'tiny-book.epub')

const openRouterKey = process.env.OPENROUTER_API_KEY || ''
const preferredModel = process.env.OPENROUTER_E2E_MODEL || 'google/gemma-4-31b-it:free'

test.skip(!openRouterKey, 'OPENROUTER_API_KEY is required for the real OpenRouter smoke test')

async function ensureSettingsOpen(page) {
  const providerSelect = page.getByTestId('provider-select')
  if (await providerSelect.isVisible().catch(() => false)) return
  await page.locator('.settings-details summary').click()
  await expect(providerSelect).toBeVisible()
}

test('real OpenRouter extracted-text smoke run completes first turn', async ({ page }) => {
  await page.addInitScript(({ key }) => {
    localStorage.clear()
    localStorage.setItem('distillboard.provider_keys', JSON.stringify({
      'google-ai-studio': '',
      openrouter: key,
    }))
    localStorage.setItem(
      'distillboard.prompt',
      'Write exactly one complete section in markdown. Start with a heading. Mention the book title if present. Produce at least 250 characters total and end with <end_of_book> on its own final line.',
    )
  }, { key: openRouterKey })

  await page.goto('/')
  await ensureSettingsOpen(page)
  await page.getByTestId('provider-select').selectOption('openrouter')
  await page.getByTestId('source-mode-select').selectOption('extracted-text')
  await page.getByTestId('api-key-input').fill(openRouterKey)

  const modelSelect = page.getByTestId('model-select')
  await expect(modelSelect.locator('option')).not.toHaveCount(0, { timeout: 60_000 })
  await page.getByTestId('file-input').setInputFiles(epubFixture)

  await expect(page.getByTestId('source-analysis-summary')).toContainText('Chapters: 2')

  const preferredOption = modelSelect.locator(`option[value="${preferredModel}"]`)
  if (await preferredOption.count()) {
    await modelSelect.selectOption(preferredModel)
  }

  const pauseToggle = page.getByLabel('Pause on anomaly')
  if (await pauseToggle.isChecked()) await pauseToggle.uncheck()

  await page.getByTestId('start-button').click()

  await expect(page.getByTestId('status-badge')).not.toContainText('paused (error)', { timeout: 120_000 })
  await expect(page.getByTestId('live-document')).toContainText('Section 1:', { timeout: 120_000 })

  const stopButton = page.getByTestId('stop-button')
  if (await stopButton.isEnabled().catch(() => false)) {
    await stopButton.click()
  }
  await expect(page.getByTestId('export-button')).toBeEnabled({ timeout: 30_000 })
})
