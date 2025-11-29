<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { createGeminiService, createUserContent, createPartFromUri } from './gemini.js'
import { jsPDF } from 'jspdf'
import TopBar from './components/TopBar.vue'
import Settings from './components/Settings.vue'
import UploadZone from './components/UploadZone.vue'
import LiveDocument from './components/LiveDocument.vue'
import TraceDrawer from './components/TraceDrawer.vue'

// Constants
const DEFAULT_PROMPT = `# Book Deep-Dive Exploration Prompt\n\n**Your Mission:** You are tasked with creating an immersive, in-depth exploration of a book I provide. Your goal is to channel the author's voice and produce a series of thematic deep-dives that, when combined, will read as a single, flowing document—like an extended meditation on the book written by the author themselves.\n\n## For the First Response Only\n\n**Structure your first response in two parts:**\n\n### Part 1: Opening the Journey\n- **Book Introduction**: In the author's voice, introduce the book's core premise and why it was written\n- **The Architecture**: Present a roadmap of all major themes/sections that will be covered across our multi-turn exploration, showing how each builds upon the last\n- **Reading Guide**: Briefly explain how these sections work together to form the complete journey\n\n### Part 2: First Thematic Section\n- Proceed with the first major theme following the standard section structure below\n\n## For All Thematic Sections\n\n**Creating Each Section:**\nBegin each section with a **thematic title** that captures the essence of what you're exploring.\n\n## Our Process\n- I'll provide the book source\n- You'll create the first response with both the opening journey overview and the first thematic section\n- When I respond with "Next", identify the next logical theme and create another complete section\n- Each new section should begin in a way that flows naturally from the previous section\n- When you've covered all major themes and the book's journey is complete, respond only with: \`<end_of_book>\`\n\n## Key Principles\n- **The reader should feel they've read the book itself through your responses**\n- Privilege completeness and depth over conciseness\n- Think of the final combined document as the book's essence, distilled but not diluted\n\n## Remember\nYou're not summarizing or studying the book—you're presenting it in its full richness through the author's own eyes. The reader should finish feeling like they've genuinely experienced the book's complete content, receiving all its wisdom, stories, and insights directly from the source material itself.`
const AUTO_WAIT_MS = 60000

// State
const apiKey = ref(localStorage.getItem('distillboard.gemini_key') || '')
const prompt = ref(localStorage.getItem('distillboard.prompt') || DEFAULT_PROMPT)
const endMarker = ref('<end_of_book>')
const budgetTokens = ref('')
const pauseOnAnomaly = ref(true)
const autoWaitBetweenRequests = ref(localStorage.getItem('distillboard.autoWaitBetweenRequests') === 'true')
const isSettingsOpen = ref(!localStorage.getItem('distillboard.gemini_key'))

const status = ref('idle')
const sections = ref(0)
const tokenTally = ref(0)
const running = ref(false)
const paused = ref(false)
const history = ref([])
const lastAssistant = ref('')
const fileBlob = ref(null)
const trace = ref([])

// Retry/Backoff State
const retrying = ref(false)
const retryAttempt = ref(0)
const retryMax = ref(0)
const retryRemainingMs = ref(0)
const retryPlannedMs = ref(0)
const lastErrorMessage = ref('')

// Auto-wait State
const autoWaiting = ref(false)
const autoWaitRemainingMs = ref(0)
const autoWaitPlannedMs = ref(0)

// Settings
const savedKeys = ref(JSON.parse(localStorage.getItem('distillboard.saved_keys') || '[]'))
const model = ref(localStorage.getItem('distillboard.model') || 'gemini-2.5-pro')
const useTemperature = ref(localStorage.getItem('distillboard.useTemperature') === 'true')
const temperature = ref(+(localStorage.getItem('distillboard.temperature') || '1.0'))
const themeMode = ref(localStorage.getItem('distillboard.themeMode') || 'auto')

// Internal
let gem = null
let uploadedFile = null
let startTime = 0
let lastRequestStartedAt = 0
let nextSectionId = 1
const sectionsMeta = ref([])
const isTraceOpen = ref(false)
const toasts = ref([])

// Computed
const hasModelHistory = computed(() => history.value.some(h => h.role === 'model'))

// Methods
const sleep = ms => new Promise(r => setTimeout(r, ms))
const estimateTokens = s => Math.ceil((s || '').length / 4)

function toast(msg, type = 'info', ms = 3500) {
  const id = Date.now()
  toasts.value.push({ id, msg, type })
  setTimeout(() => {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }, ms)
}

function persist() {
  localStorage.setItem('distillboard.prompt', prompt.value || '')
  localStorage.setItem('distillboard.model', model.value || '')
  localStorage.setItem('distillboard.useTemperature', String(!!useTemperature.value))
  localStorage.setItem('distillboard.temperature', String(temperature.value ?? ''))
  localStorage.setItem('distillboard.themeMode', themeMode.value || 'auto')
  localStorage.setItem('distillboard.autoWaitBetweenRequests', String(!!autoWaitBetweenRequests.value))
}

// Watchers for persistence
watch([prompt, model, useTemperature, temperature, themeMode, autoWaitBetweenRequests], persist)

function applyTheme() {
  const preferDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = themeMode.value === 'dark' || (themeMode.value === 'auto' && preferDark)
  document.body.classList.toggle('dark', isDark)
}

watch(themeMode, applyTheme)
onMounted(applyTheme)

// Key Management
// Key Management
function saveKey(label) {
  const k = apiKey.value.trim()
  if (!k) { toast('Empty key not saved', 'warn'); return }
  const existing = savedKeys.value.find(s => s.key === k)
  if (existing) { toast('Key already saved as "' + existing.label + '"', 'info'); return }
  
  savedKeys.value.push({ label: label || 'Default', key: k, created: Date.now() })
  localStorage.setItem('distillboard.saved_keys', JSON.stringify(savedKeys.value))
  localStorage.setItem('distillboard.gemini_key', k)
  toast('API key saved', 'good')
}

function loadKey(entry) {
  apiKey.value = entry.key
  localStorage.setItem('distillboard.gemini_key', entry.key)
  toast('Loaded key: ' + entry.label, 'info')
}

function deleteKey(index) {
  savedKeys.value.splice(index, 1)
  localStorage.setItem('distillboard.saved_keys', JSON.stringify(savedKeys.value))
  toast('Key deleted', 'info')
}

function clearKey() {
  localStorage.removeItem('distillboard.gemini_key')
  apiKey.value = ''
  toast('API key cleared', 'good')
}

// File Handling
function onFileChange(f) {
  fileBlob.value = f || null
}

// Trace
function pushTrace(entry) {
  const ts = new Date().toISOString()
  trace.value.push({ ts, ...entry })
}

function serializeErr(e) {
  if (!e) return { message: 'unknown' }
  if (typeof e === 'string') return { message: e }
  return { message: e.message || 'unknown', name: e.name || 'Error', raw: e?.response || e?.toString?.() }
}

// Logic
function hasCtrlLeak(text) { return /<ctrl94>/i.test(String(text || '')) }

function extractCandidatesTokenCount(resp) {
  try {
    const raw = resp?.raw || resp || {}
    const direct = raw?.candidatesTokenCount ?? resp?.candidatesTokenCount
    if (Number.isFinite(Number(direct))) return Number(direct)
    const um = raw?.usageMetadata || raw?.usage_metadata || resp?.usageMetadata || {}
    const viaUsage = um?.candidatesTokenCount ?? um?.candidates_token_count
    if (Number.isFinite(Number(viaUsage))) return Number(viaUsage)
  } catch { }
  return null
}

function makeConfig() {
  const cfg = { systemInstruction: prompt.value }
  if (useTemperature.value) {
    cfg.generationConfig = { temperature: Number(temperature.value) || 0 }
  }
  return cfg
}

async function backoffWait(ms) {
  retrying.value = true
  if (!retryMax.value) retryMax.value = '∞'
  retryPlannedMs.value = ms
  retryRemainingMs.value = ms
  const step = 250
  let remain = ms
  while (remain > 0 && !paused.value && (running.value || retrying.value)) {
    const delta = Math.min(step, remain)
    await sleep(delta)
    remain = Math.max(0, remain - delta)
    retryRemainingMs.value = remain
  }
  retryRemainingMs.value = Math.max(0, remain)
  if (remain <= 0) { retryPlannedMs.value = 0 }
}

async function autoSpacingWait(ms) {
  if (ms <= 0) return
  const prevStatus = status.value
  if (running.value && !paused.value) status.value = 'waiting (auto-spacing)'
  autoWaiting.value = true
  autoWaitPlannedMs.value = ms
  autoWaitRemainingMs.value = ms
  const step = 250
  let remain = ms
  while (remain > 0 && running.value && !paused.value) {
    await sleep(step)
    remain -= step
    autoWaitRemainingMs.value = remain
  }
  autoWaitRemainingMs.value = Math.max(0, remain)
  autoWaitPlannedMs.value = 0
  autoWaiting.value = false
  if (running.value && !paused.value) {
    if (prevStatus === 'running' || prevStatus === 'waiting (auto-spacing)') status.value = 'running'
    else status.value = prevStatus
  }
}

async function maybeAutoWaitBeforeRequest() {
  if (!autoWaitBetweenRequests.value) return
  if (!running.value || paused.value) return
  if (!lastRequestStartedAt) return
  const elapsed = Date.now() - lastRequestStartedAt
  const waitMs = AUTO_WAIT_MS - elapsed
  if (waitMs <= 0) return
  await autoSpacingWait(waitMs)
}

function finishWithError(err, req, retries) {
  retrying.value = false
  autoWaiting.value = false
  autoWaitRemainingMs.value = 0
  autoWaitPlannedMs.value = 0
  paused.value = true
  status.value = 'paused (error)'
  lastErrorMessage.value = err?.message || 'unknown'
  pushTrace({ request: JSON.parse(JSON.stringify(req)), error: serializeErr(err), retries })
  toast('API Error: ' + (err?.message || 'unknown'), 'bad', 7000)
}

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

async function postTurnChecks(text) {
  const re = new RegExp(String(endMarker.value || '<end_of_book>') + '$')
  if (re.test((text || '').trim())) {
    status.value = 'complete'
    toast('Distillation complete', 'good')
    return true
  }
  if (pauseOnAnomaly.value) {
    if (/^\s*(i\s+(can\'t|cannot|won\'t)|as an ai|i\'m unable|i do not have access)/i.test(text || '')) {
      paused.value = true
      status.value = 'paused (refusal)'
      toast('Paused: likely refusal', 'warn')
      return true
    }
    if (sim3(lastAssistant.value, text) > 0.9) {
      paused.value = true
      status.value = 'paused (loop)'
      toast('Paused: response repeating', 'warn')
      return true
    }
  }
  lastAssistant.value = text
  return false
}

function cleanFinish() {
  running.value = false
  retrying.value = false
  autoWaiting.value = false
  if (status.value === 'running') status.value = 'stopped'
}

async function start() {
  if (!apiKey.value.trim()) { toast('Add your Gemini API key first', 'bad'); return }
  if (!fileBlob.value) { toast('Upload a PDF/EPUB first', 'bad'); return }
  if (!prompt.value.trim()) { toast('Prompt is empty', 'bad'); return }

  // Reset
  history.value = []
  sections.value = 0
  tokenTally.value = 0
  lastAssistant.value = ''
  trace.value = []
  paused.value = false
  running.value = false
  sectionsMeta.value = []
  nextSectionId = 1
  retrying.value = false
  retryAttempt.value = 0
  retryMax.value = 0
  retryRemainingMs.value = 0
  retryPlannedMs.value = 0
  lastErrorMessage.value = ''
  autoWaiting.value = false
  autoWaitRemainingMs.value = 0
  autoWaitPlannedMs.value = 0
  lastRequestStartedAt = 0
  status.value = 'uploading'

  // Init Gemini
  gem = createGeminiService({
    apiKey: apiKey.value.trim(),
    shouldContinue: () => !paused.value && (running.value || true),
    onTransient: async ({ attempt, waitMs, err }) => {
      const rawCode = (err?.error?.code ?? err?.response?.status ?? err?.status ?? err?.statusCode ?? err?.code)
      const code = Number(rawCode)
      const isRateOrServer = Number.isFinite(code) && (code === 429 || (code >= 500 && code < 600))
      const MAX_AUTO_RETRIES = 4
      const plannedWait = isRateOrServer ? 60000 : waitMs

      retrying.value = true
      retryAttempt.value = attempt
      retryMax.value = isRateOrServer ? MAX_AUTO_RETRIES : '∞'
      lastErrorMessage.value = err?.error?.message || err?.message || 'Temporary error'

      const statusLabel = isRateOrServer ? (code === 429 ? 'rate limited' : 'server overloaded') : 'transient error'
      status.value = `retrying (${statusLabel})`

      if (isRateOrServer && (attempt + 1) >= MAX_AUTO_RETRIES) {
        retrying.value = false
        retryRemainingMs.value = 0
        retryPlannedMs.value = 0
        paused.value = true
        status.value = 'paused (auto-retry limit reached)'
        toast('Auto-retry limit reached. Click Resume to continue.', 'warn', 7000)
        return
      }
      await backoffWait(plannedWait)
    }
  })

  // Upload
  {
    const [up, utries, uerr] = await gem.callWithRetriesFn(() => gem.ai.files.upload({ file: fileBlob.value, config: { displayName: fileBlob.value.name } }))
    if (uerr) {
      if (String(uerr?.message) === '__aborted__') return
      paused.value = true; status.value = 'paused (error)'; lastErrorMessage.value = uerr?.message || 'unknown'
      toast('Upload failed: ' + (uerr?.message || 'unknown'), 'bad', 6000)
      pushTrace({ request: { step: 'files.upload' }, error: serializeErr(uerr), retries: utries })
      return
    }
    uploadedFile = up
    let tries = 0
    while (uploadedFile.state === 'PROCESSING' && tries < 120) {
      await sleep(2000)
      const [got, gtries, gerr] = await gem.callWithRetriesFn(() => gem.ai.files.get({ name: uploadedFile.name }))
      if (gerr) {
        if (String(gerr?.message) === '__aborted__') return
        paused.value = true; status.value = 'paused (error)'; lastErrorMessage.value = gerr?.message || 'unknown'
        toast('Polling failed: ' + (gerr?.message || 'unknown'), 'bad', 6000)
        pushTrace({ request: { step: 'files.get' }, error: serializeErr(gerr), retries: gtries })
        return
      }
      uploadedFile = got; tries++
    }
    if (uploadedFile.state === 'FAILED') {
      const err = new Error('File processing failed on Gemini.')
      paused.value = true; status.value = 'paused (error)'; lastErrorMessage.value = err.message
      pushTrace({ request: { step: 'files.process' }, error: serializeErr(err), retries: 0 })
      toast(err.message, 'bad')
      return
    }
  }

  running.value = true; status.value = 'running'; startTime = Date.now()

  // First Turn
  const filePart = createPartFromUri(uploadedFile.uri, uploadedFile.mimeType)
  const userFirst = createUserContent([filePart, 'Begin as instructed: include Opening the Journey (intro, architecture, reading guide) and the first complete thematic section.'])
  const req1 = { model: model.value, contents: [userFirst], tools: [], config: makeConfig() }
  let firstResp = null, firstTries = 0, firstText = ''
  await maybeAutoWaitBeforeRequest()
  lastRequestStartedAt = Date.now()

  for (let contentAttempts = 0; ;) {
    const [resp1, r1tries, r1err] = await gem.callWithRetries(req1)
    if (r1err) { if (String(r1err?.message) === '__aborted__') return; finishWithError(r1err, req1, r1tries); return }
    const text1 = resp1?.text || gem.extractText(resp1)
    const nonCode = (text1 || '').trim().replace(/```[\s\S]*?```/g, '')
    const tooShort = nonCode.length < 200
    const leak = hasCtrlLeak(text1)
    if (leak || (tooShort && pauseOnAnomaly.value)) {
      if (contentAttempts < 5) {
        const reason = leak ? 'artifact leak (<ctrl94>)' : 'Short/empty response'
        status.value = `retrying (${reason})`
        retryAttempt.value = contentAttempts
        retryMax.value = 5
        lastErrorMessage.value = reason
        await backoffWait(60000); retrying.value = false; continue
      } else {
        paused.value = true; status.value = leak ? 'paused (artifact leak)' : 'paused (empty/short)'
        toast(leak ? 'Paused: artifact leak detected' : 'Paused: response too short', 'warn')
        return
      }
    }
    firstResp = resp1; firstTries = r1tries; firstText = text1; break
  }

  const modelMsg1 = { role: 'model', parts: [{ text: firstText }] }
  history.value.push(userFirst)
  history.value.push(modelMsg1)
  const sid1 = nextSectionId++
  sectionsMeta.value.push({ id: sid1, text: firstText, modelMsg: modelMsg1, userMsgBefore: userFirst, candidatesTokenCount: extractCandidatesTokenCount(firstResp) })
  sections.value += 1
  tokenTally.value += estimateTokens(firstText)
  pushTrace({ request: JSON.parse(JSON.stringify(req1)), response: firstResp, retries: firstTries })
  
  const done = await postTurnChecks(firstText)
  if (done) { cleanFinish(); return }
  nextLoop()
}

async function nextLoop() {
  while (running.value && !paused.value) {
    if (+budgetTokens.value > 0 && tokenTally.value >= +budgetTokens.value) { status.value = 'token budget reached (est)'; toast('Token budget (estimated) reached', 'warn'); break }

    const nextUser = createUserContent(['Next'])
    const req = { model: model.value, contents: [...history.value, nextUser], tools: [], config: makeConfig() }
    let resp = null, tries = 0
    await maybeAutoWaitBeforeRequest()
    lastRequestStartedAt = Date.now()

    for (let contentAttempts = 0; ;) {
      const out = await gem.callWithRetries(req).catch(e => [null, 0, e])
      const [rresp, rtries, rerr] = Array.isArray(out) ? out : [null, 0, new Error('unknown')]
      if (rerr) {
        if (String(rerr?.message) === '__aborted__') return
        if (rerr?.error?.status === 'FAILED_PRECONDITION' || /Unsupported file uri/i.test(String(rerr?.message || ''))) {
          toast('File reference invalid; re-uploading and updating history…', 'warn')
          try {
            uploadedFile = await gem.ai.files.upload({ file: fileBlob.value, config: { displayName: fileBlob.value.name } })
            try {
              for (const msg of history.value) {
                if (!msg || msg.role !== 'user' || !Array.isArray(msg.parts)) continue
                for (const p of msg.parts) {
                  if (p && p.fileData) { p.fileData.fileUri = uploadedFile.uri; if (uploadedFile.mimeType) p.fileData.mimeType = uploadedFile.mimeType }
                }
              }
            } catch { }
          } catch (e) { finishWithError(rerr, req, rtries); return }
          continue
        }
        finishWithError(rerr, req, rtries); return
      }
      const txt = rresp?.text || gem.extractText(rresp)
      const nonCode = (txt || '').trim().replace(/```[\s\S]*?```/g, '')
      const tooShort = nonCode.length < 200
      const leak = hasCtrlLeak(txt)
      if (leak || (tooShort && pauseOnAnomaly.value)) {
        if (contentAttempts < 5) {
          const reason = leak ? 'artifact leak (<ctrl94>)' : 'Short/empty response'
          status.value = `retrying (${reason})`
          retryAttempt.value = contentAttempts
          retryMax.value = 5
          lastErrorMessage.value = reason
          await backoffWait(60000); retrying.value = false; continue
        } else {
          paused.value = true; status.value = leak ? 'paused (artifact leak)' : 'paused (empty/short)'
          toast(leak ? 'Paused: artifact leak detected' : 'Paused: response too short', 'warn')
          return
        }
      }
      resp = rresp; tries = rtries; var text = txt; break
    }

    const modelMsg = { role: 'model', parts: [{ text }] }
    history.value.push(nextUser)
    history.value.push(modelMsg)
    const sid = nextSectionId++
    sectionsMeta.value.push({ id: sid, text, modelMsg, userMsgBefore: nextUser, candidatesTokenCount: extractCandidatesTokenCount(resp) })
    sections.value += 1
    tokenTally.value += estimateTokens(text)
    pushTrace({ request: JSON.parse(JSON.stringify(req)), response: resp, retries: tries })
    
    const done = await postTurnChecks(text)
    if (done) break
  }
  cleanFinish()
}

function togglePause() {
  paused.value = !paused.value
  toast(paused.value ? 'Paused' : 'Resumed', 'info')
  if (!paused.value && running.value) nextLoop()
}

function stop() {
  running.value = false
  retrying.value = false
  autoWaiting.value = false
  autoWaitRemainingMs.value = 0
  autoWaitPlannedMs.value = 0
  status.value = 'stopped'
  toast('Stopped', 'warn')
}

function resumeOrStart() {
  if (running.value) {
    if (paused.value) togglePause()
  } else {
    start()
  }
}

function deleteSection(id) {
  const idx = sectionsMeta.value.findIndex(s => s.id === id)
  if (idx === -1) { toast('Section not found', 'warn'); return }
  const meta = sectionsMeta.value[idx]
  try {
    const mi = history.value.indexOf(meta.modelMsg)
    if (mi >= 0) history.value.splice(mi, 1)
    if (meta.userMsgBefore && Array.isArray(meta.userMsgBefore.parts)) {
      const isNextOnly = meta.userMsgBefore.parts.length === 1 && (meta.userMsgBefore.parts[0]?.text || '') === 'Next'
      if (isNextOnly) {
        const ui = history.value.indexOf(meta.userMsgBefore)
        if (ui >= 0) history.value.splice(ui, 1)
      }
    }
  } catch { }
  sectionsMeta.value.splice(idx, 1)
  
  // Rebuild stats
  sections.value = 0
  tokenTally.value = 0
  for (const [i, m] of sectionsMeta.value.entries()) {
    sections.value = i + 1
    tokenTally.value += estimateTokens(m.text || '')
  }
  toast('Section deleted', 'good')
}

// Export
function stripMd(md) { return (md || '').replace(/[>#*_`~\-]+/g, '').replace(/\n{3,}/g, '\n\n') }
function combinedText() { return history.value.filter(h => h.role === 'model').map(h => h.parts.map(p => p.text || '').join('')).join('\n\n').trim() }
function bookBaseName() { return (fileBlob.value?.name || 'Distillation').replace(/\.[^.]+$/, '') }
function exportBase() { return (bookBaseName() + ' - book excerpt').replace(/[\\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() }
function exportMeta() {
  return {
    title: `${bookBaseName()} - book excerpt`,
    source: fileBlob.value?.name || '',
    model: model.value,
    temperature: useTemperature.value ? Number(temperature.value) : '(default)',
    sections: Number(sections.value) || 0,
    createdAt: new Date().toISOString()
  }
}
function download(name, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function openExport() { document.getElementById('exportModal').showModal() }
function copyAll() {
  const text = combinedText()
  navigator.clipboard.writeText(text).then(() => toast('Copied combined text', 'good'))
    .catch(() => download('distillation.txt', text))
}
function exportMd() {
  const m = exportMeta()
  const fm = `---\ntitle: ${m.title}\nsource_file: ${m.source}\nmodel: ${m.model}\ntemperature: ${m.temperature}\nsections: ${m.sections}\ndate: ${m.createdAt}\ngenerator: book-distiller-vue3\n---\n\n`
  download(`${exportBase()}.md`, fm + combinedText(), 'text/markdown;charset=utf-8')
}
function exportTxt() {
  const m = exportMeta()
  const head = `${m.title}\nSource: ${m.source}\nModel: ${m.model}\nTemperature: ${m.temperature}\nSections: ${m.sections}\nDate: ${m.createdAt}\n\n`
  download(`${exportBase()}.txt`, head + combinedText())
}
function exportPdf() {
  const includeTrace = document.getElementById('includeTrace')?.checked ? trace.value : null
  const name = `${exportBase()}.pdf`
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  try {
    doc.setProperties({ title: name.replace(/\.[^.]+$/, ''), subject: 'Book excerpt', keywords: `Gemini, ${model.value}`, creator: 'book-distiller-vue3' })
  } catch {}
  const margin = 56, width = 483
  const lines = (stripMd(combinedText()) || '(empty)').split('\n')
  let y = margin
  doc.setFont('Times', 'Normal'); doc.setFontSize(12)
  for (const line of lines) {
    const chunk = doc.splitTextToSize(line, width)
    if (y + chunk.length * 16 > 812) { doc.addPage(); y = margin }
    doc.text(chunk, margin, y)
    y += chunk.length * 16 + 4
  }
  if (includeTrace) {
    doc.addPage(); doc.setFontSize(11)
    const t = JSON.stringify(includeTrace, null, 2).split('\n')
    let yy = margin
    for (const row of t) {
      const chunk = doc.splitTextToSize(row, width)
      if (yy + chunk.length * 14 > 812) { doc.addPage(); yy = margin }
      doc.text(chunk, margin, yy)
      yy += chunk.length * 14 + 2
    }
  }
  doc.save(name)
}

// Modals
function openInfo() { document.getElementById('infoModal').showModal() }
</script>

<template>
  <TopBar 
    :running="running"
    :paused="paused"
    :status="status"
    :sections="sections"
    :token-tally="tokenTally"
    :last-error-message="lastErrorMessage"
    :retrying="retrying"
    :retry-attempt="retryAttempt"
    :retry-max="retryMax"
    :retry-remaining-ms="retryRemainingMs"
    :retry-planned-ms="retryPlannedMs"
    :auto-waiting="autoWaiting"
    :auto-wait-remaining-ms="autoWaitRemainingMs"
    :auto-wait-planned-ms="autoWaitPlannedMs"
    :theme-mode="themeMode"
    :has-model-history="hasModelHistory"
    @start="start"
    @stop="stop"
    @toggle-pause="togglePause"
    @resume="resumeOrStart"
    @open-export="openExport"
    @toggle-trace="isTraceOpen = !isTraceOpen"
    @toggle-theme="themeMode = (themeMode === 'dark' ? 'light' : 'dark')"
    @open-info="openInfo"
  />

  <div class="container grid">
    <Settings
      v-model:api-key="apiKey"
      v-model:model="model"
      v-model:use-temperature="useTemperature"
      v-model:temperature="temperature"
      v-model:pause-on-anomaly="pauseOnAnomaly"
      v-model:auto-wait-between-requests="autoWaitBetweenRequests"
      v-model:end-marker="endMarker"
      v-model:budget-tokens="budgetTokens"
      v-model:is-settings-open="isSettingsOpen"
      :saved-keys="savedKeys"
      @save-key="saveKey"
      @delete-key="deleteKey"
      @load-key="loadKey"
      @clear-key="clearKey"
    >
      <template #upload-zone>
        <UploadZone :file-blob="fileBlob" @file-change="onFileChange" />
      </template>
      <template #prompt-area>
        <textarea v-model="prompt" placeholder="Enter your instructions here..."></textarea>
      </template>
    </Settings>

    <LiveDocument 
      :sections-meta="sectionsMeta"
      @delete-section="deleteSection"
    />
  </div>

  <TraceDrawer 
    :trace="trace" 
    :is-open="isTraceOpen" 
    @close="isTraceOpen = false"
    @download="download('trace.json', JSON.stringify(trace, null, 2), 'application/json')"
  />

  <!-- Modals (kept as dialogs for now) -->
  <dialog id="exportModal" style="border:none;border-radius:12px;max-width:680px;width:calc(100% - 24px)">
    <form method="dialog" style="margin:0">
      <div class="card">
        <div class="head">Export</div>
        <div class="body">
          <label><input id="includeTrace" type="checkbox"> Include trace.json</label>
          <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn primary" @click="copyAll">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M8 7h10a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V9a2 2 0 012-2z" />
                <path d="M6 3h10a2 2 0 012 2v2" />
              </svg>
              Copy all
            </button>
            <button type="button" class="btn" @click="exportMd">.md</button>
            <button type="button" class="btn" @click="exportTxt">.txt</button>
            <button type="button" class="btn" @click="exportPdf">.pdf</button>
            <button id="btnCloseExport" class="btn">Close</button>
          </div>
        </div>
      </div>
    </form>
  </dialog>

  <dialog id="infoModal" style="border:none;border-radius:12px;max-width:640px;width:calc(100% - 24px)">
    <form method="dialog" style="margin:0">
      <div class="card">
        <div class="head">About & How-To</div>
        <div class="body">
          <div style="font-weight:600;margin-bottom:6px">Tech Stack</div>
          <ul class="muted" style="margin:0 0 12px 18px">
            <li>Vue 3 + Vite</li>
            <li>Google Gemini SDK (@google/genai)</li>
            <li>Marked for Markdown → HTML, jsPDF for PDF export</li>
          </ul>
          <div style="margin-top:12px;text-align:right">
            <button class="btn">Close</button>
          </div>
        </div>
      </div>
    </form>
  </dialog>

  <div class="toastHost">
    <div v-for="t in toasts" :key="t.id" :class="['toast', t.type]">
      {{ t.msg }}
    </div>
  </div>
</template>
