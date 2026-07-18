// Conversation workflow and error handling are documented in docs/WORKFLOW.md
import { createApp } from 'https://unpkg.com/petite-vue@0.4.1?module';
import { analyzeSourceFile } from './extractors.js';
import {
  chooseModel,
  DEFAULT_PROMPT,
  combinedSectionsText,
  estimateTokens,
  getDefaultGoogleModel,
  getFileSignature,
  getProviderLabel,
  getSavedKeysForProvider,
  getStorageKeys,
  filterModelsByQuery,
  loadProvider,
  loadProviderKeys,
  loadSavedKeys,
  loadSourceMode,
  migrateLegacyStorage,
  normalizeSavedKeys,
  OPENROUTER_PROVIDER,
  GOOGLE_PROVIDER,
  GOOGLE_MODELS,
  PROVIDER_LABELS,
  resolveSourceModeLabel,
  setStoredApiKey,
  clearStoredApiKey,
  sim3,
  sleep,
  SOURCE_MODE_EXTRACTED,
  SOURCE_MODE_NATIVE,
  stripMd,
  isNextOnlyUserMessage,
  persistSavedKeys,
} from './core.js';
import { getProvider, getProviderList } from './providers.js';

const $ = selector => document.querySelector(selector);

const STORAGE_KEYS = getStorageKeys();
const AUTO_WAIT_MS = 60000;
const ANOMALY_MAX_ATTEMPTS = 5;
const ANOMALY_WAIT_MS = 60000;
const BEGIN_INSTRUCTION = 'Begin as instructed: include Opening the Journey (intro, architecture, reading guide) and the first complete thematic section.';
const sourceAnalysisCache = new Map();

function toast(message, type = 'info', ms = 3500) {
  const host = $('#toasts');
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), ms);
}

function download(name, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function makePdf(name, md, trace, meta) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  try {
    const keywords = [meta?.provider, meta?.model].filter(Boolean).join(', ');
    doc.setProperties && doc.setProperties({
      title: name.replace(/\.[^.]+$/, ''),
      subject: 'Book excerpt',
      keywords,
      creator: 'book-distiller-petite-vue',
    });
  } catch { }
  const margin = 56;
  const width = 483;
  const lines = (stripMd(md) || '(empty)').split('\n');
  let y = margin;
  doc.setFont('Times', 'Normal');
  doc.setFontSize(12);
  for (const line of lines) {
    const chunk = doc.splitTextToSize(line, width);
    if (y + chunk.length * 16 > 812) {
      doc.addPage();
      y = margin;
    }
    doc.text(chunk, margin, y);
    y += chunk.length * 16 + 4;
  }
  if (trace) {
    doc.addPage();
    doc.setFontSize(11);
    const traceRows = JSON.stringify(trace, null, 2).split('\n');
    let traceY = margin;
    for (const row of traceRows) {
      const chunk = doc.splitTextToSize(row, width);
      if (traceY + chunk.length * 14 > 812) {
        doc.addPage();
        traceY = margin;
      }
      doc.text(chunk, margin, traceY);
      traceY += chunk.length * 14 + 2;
    }
  }
  doc.save(name);
}

createApp({
  initialized: false,
  providerOptions: getProviderList().map(provider => ({ id: provider.id, label: provider.label })),
  provider: loadProvider(),
  sourceMode: loadSourceMode(),
  providerKeys: loadProviderKeys(),
  apiKey: '',
  prompt: localStorage.getItem(STORAGE_KEYS.prompt) || DEFAULT_PROMPT,
  endMarker: '<end_of_book>',
  budgetTokens: '',
  budgetTime: '',
  pauseOnAnomaly: true,
  autoWaitBetweenRequests: localStorage.getItem(STORAGE_KEYS.autoWaitBetweenRequests) === 'true',
  isSettingsOpen: true,

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

  retrying: false,
  retryAttempt: 0,
  retryMax: 0,
  retryRemainingMs: 0,
  retryPlannedMs: 0,

  autoWaiting: false,
  autoWaitRemainingMs: 0,
  autoWaitPlannedMs: 0,
  lastErrorMessage: '',

  availableModels: [],
  model: localStorage.getItem(STORAGE_KEYS.model) || getDefaultGoogleModel(),
  modelLoading: false,
  modelLoadError: '',
  modelRefreshNonce: 0,
  modelQuery: '',

  useTemperature: (() => {
    const value = localStorage.getItem(STORAGE_KEYS.useTemperature);
    return value === null ? true : value === 'true';
  })(),
  temperature: +(localStorage.getItem(STORAGE_KEYS.temperature) || '1.0'),
  themeMode: (() => {
    const value = localStorage.getItem(STORAGE_KEYS.themeMode);
    if (value === 'light' || value === 'dark' || value === 'auto') return value;
    const legacy = localStorage.getItem('distillboard.dark');
    if (legacy !== null) return legacy === 'true' ? 'dark' : 'light';
    return 'auto';
  })(),

  providerSession: null,
  nativeSource: null,
  startTime: 0,
  lastRequestStartedAt: 0,
  nextSectionId: 1,
  sectionsMeta: [],

  savedKeys: loadSavedKeys(),
  savedPrompts: JSON.parse(localStorage.getItem(STORAGE_KEYS.savedPrompts) || '[]'),

  sourceAnalysisStatus: 'idle',
  sourceAnalysisError: '',
  sourceAnalysisPromise: null,
  extractedSource: null,

  get endMarkerEscaped() {
    return this.endMarker.replace(/^<|>$/g, '');
  },
  get filteredSavedKeys() {
    return getSavedKeysForProvider(this.savedKeys, this.provider);
  },
  get providerLabel() {
    return getProviderLabel(this.provider);
  },
  get sourceModeLabel() {
    return resolveSourceModeLabel(this.sourceMode);
  },
  get selectedModelMeta() {
    return this.availableModels.find(model => model.id === this.model) || null;
  },
  get visibleModels() {
    if (this.provider !== OPENROUTER_PROVIDER) return this.availableModels;
    return filterModelsByQuery(this.availableModels, this.modelQuery);
  },
  get extractionStatsSummary() {
    if (!this.fileBlob) return '';
    if (this.sourceAnalysisStatus === 'analyzing') return 'Analyzing local text extraction…';
    if (this.sourceAnalysisStatus === 'error') return `Words: unavailable • Est. tokens: unavailable`;
    if (this.sourceAnalysisStatus !== 'ready' || !this.extractedSource) return '';
    const parts = [
      `Words: ${this.extractedSource.wordCount.toLocaleString()}`,
      `Est. tokens: ${this.extractedSource.tokenEstimate.toLocaleString()}`,
    ];
    if (Number.isFinite(Number(this.extractedSource.pageCount))) parts.push(`Pages: ${Number(this.extractedSource.pageCount)}`);
    if (Number.isFinite(Number(this.extractedSource.chapterCount))) parts.push(`Chapters: ${Number(this.extractedSource.chapterCount)}`);
    return parts.join(' • ');
  },

  ensureInitialized() {
    if (this.initialized) return;
    const migrated = migrateLegacyStorage();
    this.providerKeys = migrated.providerKeys;
    this.savedKeys = migrated.savedKeys;
    this.provider = loadProvider();
    this.sourceMode = loadSourceMode();
    this.apiKey = this.providerKeys[this.provider] || '';
    this.isSettingsOpen = !this.apiKey;
    this.initialized = true;
    this.refreshAvailableModels({ silent: true });
  },

  extractCandidatesTokenCount(response) {
    return getProvider(this.provider).extractCandidatesTokenCount(response);
  },

  saveKey() {
    const key = this.apiKey.trim();
    if (!key) {
      toast('Empty key not saved', 'warn');
      return;
    }
    const existing = this.savedKeys.find(entry => entry.key === key && entry.provider === this.provider);
    if (existing) {
      toast(`Key already saved as "${existing.label}"`, 'info');
      return;
    }
    const label = prompt(`Enter a label for this ${this.providerLabel} key:`, 'Default');
    if (label === null) return;
    this.savedKeys.push({
      label: label || 'Default',
      key,
      provider: this.provider,
      created: Date.now(),
    });
    this.savedKeys = normalizeSavedKeys(this.savedKeys);
    persistSavedKeys(this.savedKeys);
    this.providerKeys[this.provider] = key;
    setStoredApiKey(this.provider, key);
    toast('API key saved', 'good');
  },

  deleteKey(entry) {
    const index = this.savedKeys.indexOf(entry);
    if (index === -1) return;
    this.savedKeys.splice(index, 1);
    persistSavedKeys(this.savedKeys);
    toast('Key deleted', 'info');
  },

  loadKey(entry) {
    this.apiKey = entry.key;
    this.providerKeys[this.provider] = entry.key;
    setStoredApiKey(this.provider, entry.key);
    toast(`Loaded key: ${entry.label}`, 'info');
  },

  clearKey() {
    clearStoredApiKey(this.provider);
    this.providerKeys[this.provider] = '';
    this.apiKey = '';
    toast('API key cleared', 'good');
  },

  savePrompt() {
    const promptText = this.prompt.trim();
    if (!promptText) {
      toast('Empty prompt not saved', 'warn');
      return;
    }
    const existing = this.savedPrompts.find(entry => entry.text === promptText);
    if (existing) {
      toast(`Prompt already saved as "${existing.label}"`, 'info');
      return;
    }
    const label = prompt('Enter a label for this prompt:', 'My Custom Prompt');
    if (label === null) return;
    this.savedPrompts.push({ label: label || 'Untitled', text: promptText, created: Date.now() });
    this.persistPrompts();
    toast('Prompt saved', 'good');
  },

  deletePrompt(index) {
    this.savedPrompts.splice(index, 1);
    this.persistPrompts();
    toast('Prompt deleted', 'info');
  },

  loadPrompt(entry) {
    this.prompt = entry.text;
    this.persist();
    toast(`Loaded prompt: ${entry.label}`, 'info');
  },

  persistPrompts() {
    localStorage.setItem(STORAGE_KEYS.savedPrompts, JSON.stringify(this.savedPrompts));
  },

  async onProviderChange(event) {
    this.provider = event.target.value;
    if (this.provider !== OPENROUTER_PROVIDER) this.modelQuery = '';
    this.apiKey = this.providerKeys[this.provider] || '';
    this.persist();
    await this.refreshAvailableModels();
  },

  async onSourceModeChange(event) {
    this.sourceMode = event.target.value;
    this.persist();
    await this.refreshAvailableModels({ silent: true });
  },

  async onFileChange(event) {
    const file = event.target.files?.[0] || null;
    this.fileBlob = file;
    this.fileInfo = file ? `${file.name} • ${(file.type || '').replace('application/', '')} • ${(file.size / 1048576).toFixed(2)} MB` : '';
    this.extractedSource = null;
    this.sourceAnalysisError = '';
    this.sourceAnalysisStatus = file ? 'analyzing' : 'idle';
    this.sourceAnalysisPromise = null;
    this.nativeSource = null;
    if (file) this.startSourceAnalysis(file);
    await this.refreshAvailableModels({ silent: true });
  },

  startSourceAnalysis(file) {
    const signature = getFileSignature(file);
    this.sourceAnalysisStatus = 'analyzing';
    this.sourceAnalysisError = '';
    this.sourceAnalysisPromise = analyzeSourceFile(file, sourceAnalysisCache)
      .then(result => {
        if (getFileSignature(this.fileBlob) !== signature) return result;
        this.extractedSource = result;
        this.sourceAnalysisStatus = 'ready';
        this.sourceAnalysisError = '';
        if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
          toast(result.warnings[0], 'warn', 5000);
        }
        this.refreshAvailableModels({ silent: true });
        return result;
      })
      .catch(err => {
        if (getFileSignature(this.fileBlob) !== signature) return null;
        this.extractedSource = null;
        this.sourceAnalysisStatus = 'error';
        this.sourceAnalysisError = err?.message || 'Failed to analyze source';
        this.refreshAvailableModels({ silent: true });
        return null;
      });
  },

  toggleTrace() {
    const trace = $('#trace');
    trace.classList.toggle('open');
    trace?.setAttribute?.('aria-hidden', trace.classList.contains('open') ? 'false' : 'true');
  },

  openTrace() {
    const trace = $('#trace');
    trace.classList.add('open');
    trace?.setAttribute?.('aria-hidden', 'false');
  },

  closeTrace() {
    const trace = $('#trace');
    trace.classList.remove('open');
    trace?.setAttribute?.('aria-hidden', 'true');
  },

  downloadTrace() {
    const blob = new Blob([JSON.stringify(this.trace, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'trace.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  },

  openExport() { $('#exportModal').showModal(); },
  openInfo() { $('#infoModal').showModal(); },

  onThemeChange() {
    const modes = ['auto', 'light', 'dark'];
    this.themeMode = modes[(modes.indexOf(this.themeMode) + 1) % modes.length];
    this.applyTheme();
    this.persist();
    toast(`Theme: ${this.themeMode}`, 'info');
  },

  async copyAll() {
    const text = this.combinedText();
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied combined text', 'good');
    } catch {
      download('distillation.txt', text);
    }
  },

  hasCtrlLeak(text) {
    return /<ctrl94>/i.test(String(text || ''));
  },

  sanitizeFilename(name) {
    return String(name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  },

  bookBaseName() {
    if (this.fileBlob?.name) return this.fileBlob.name.replace(/\.[^.]+$/, '');
    return 'Distillation';
  },

  exportBase() {
    return this.sanitizeFilename(`${this.bookBaseName()} - book excerpt`);
  },

  exportMeta() {
    const createdAt = new Date().toISOString();
    return {
      title: `${this.bookBaseName()} - book excerpt`,
      source: this.fileBlob?.name || '',
      provider: this.providerLabel,
      sourceMode: this.sourceModeLabel,
      model: this.model,
      temperature: this.useTemperature ? Number(this.temperature) : '(default)',
      sections: Number(this.sections) || 0,
      createdAt,
    };
  },

  metadataFrontMatter() {
    const meta = this.exportMeta();
    return `---\n`
      + `title: ${meta.title}\n`
      + (meta.source ? `source_file: ${meta.source}\n` : '')
      + `provider: ${meta.provider}\n`
      + `source_mode: ${meta.sourceMode}\n`
      + `model: ${meta.model}\n`
      + `temperature: ${meta.temperature}\n`
      + `sections: ${meta.sections}\n`
      + `date: ${meta.createdAt}\n`
      + `generator: book-distiller-petite-vue\n`
      + `---\n\n`;
  },

  metadataTextHeader() {
    const meta = this.exportMeta();
    return [
      meta.title,
      meta.source ? `Source: ${meta.source}` : '',
      `Provider: ${meta.provider}`,
      `Source mode: ${meta.sourceMode}`,
      `Model: ${meta.model}`,
      `Temperature: ${meta.temperature}`,
      `Sections: ${meta.sections}`,
      `Date: ${meta.createdAt}`,
      '',
    ].filter(Boolean).join('\n');
  },

  exportMd() {
    download(`${this.exportBase()}.md`, this.metadataFrontMatter() + this.combinedText(), 'text/markdown;charset=utf-8');
  },

  exportTxt() {
    download(`${this.exportBase()}.txt`, this.metadataTextHeader() + this.combinedText());
  },

  exportPdf() {
    const includeTrace = $('#includeTrace').checked ? this.trace : null;
    makePdf(`${this.exportBase()}.pdf`, this.combinedText(), includeTrace, this.exportMeta());
  },

  combinedText() {
    return combinedSectionsText(this.sectionsMeta);
  },

  renderMd(md) {
    try {
      return window.marked.parse(md || '');
    } catch {
      return md || '';
    }
  },

  stringify(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  },

  getTitleFromMd(md) {
    const lines = (md || '').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s{0,3}#{1,6}\s+(.+)/);
      if (match) return match[1].trim();
      if (line.trim()) return line.trim().slice(0, 96);
    }
    return `Section ${this.sections + 1}`;
  },

  rebuildDoc() {
    this.sections = this.sectionsMeta.length;
    this.tokenTally = this.sectionsMeta.reduce((sum, meta) => sum + estimateTokens(meta.text || ''), 0);
  },

  deleteSection(id) {
    const index = this.sectionsMeta.findIndex(section => section.id === id);
    if (index === -1) {
      toast('Section not found', 'warn');
      return;
    }
    const meta = this.sectionsMeta[index];
    try {
      const modelIndex = this.history.indexOf(meta.modelMsg);
      if (modelIndex >= 0) this.history.splice(modelIndex, 1);
      if (isNextOnlyUserMessage(meta.userMsgBefore)) {
        const userIndex = this.history.indexOf(meta.userMsgBefore);
        if (userIndex >= 0) this.history.splice(userIndex, 1);
      }
    } catch { }
    this.sectionsMeta.splice(index, 1);
    this.rebuildDoc();
    toast('Section deleted', 'good');
  },

  async refreshAvailableModels({ silent = false } = {}) {
    if (!this.initialized) return;
    const provider = getProvider(this.provider);
    const nonce = ++this.modelRefreshNonce;
    this.modelLoading = true;
    this.modelLoadError = '';
    try {
      const models = await provider.listModels({
        apiKey: this.apiKey.trim(),
        sourceMode: this.sourceMode,
        fileBlob: this.fileBlob,
        extracted: this.extractedSource,
      });
      if (nonce !== this.modelRefreshNonce) return;
      this.availableModels = models;
      const fallback = this.provider === GOOGLE_PROVIDER ? getDefaultGoogleModel() : '';
      this.model = chooseModel(this.model, models, fallback);
    } catch (err) {
      if (nonce !== this.modelRefreshNonce) return;
      this.availableModels = this.provider === GOOGLE_PROVIDER ? GOOGLE_MODELS : [];
      const fallback = this.provider === GOOGLE_PROVIDER ? getDefaultGoogleModel() : '';
      this.model = chooseModel(this.model, this.availableModels, fallback);
      this.modelLoadError = err?.message || 'Failed to load models';
      if (!silent && this.provider === OPENROUTER_PROVIDER) {
        toast(this.modelLoadError, 'warn', 6000);
      }
    } finally {
      if (nonce === this.modelRefreshNonce) this.modelLoading = false;
    }
  },

  createProviderSession() {
    return getProvider(this.provider).createSession({
      apiKey: this.apiKey.trim(),
      shouldContinue: () => !this.paused,
      onTransient: async ({ attempt, waitMs, err }) => {
        const rawCode = err?.error?.code ?? err?.response?.status ?? err?.status ?? err?.statusCode ?? err?.code;
        const code = Number(rawCode);
        const isRateOrServer = Number.isFinite(code) && (code === 429 || (code >= 500 && code < 600));
        const maxAutoRetries = 4;
        const plannedWait = isRateOrServer ? 60000 : waitMs;

        this.retrying = true;
        this.retryAttempt = attempt;
        this.retryMax = isRateOrServer ? maxAutoRetries : '∞';
        this.lastErrorMessage = err?.error?.message || err?.message || 'Temporary error';

        const statusLabel = isRateOrServer
          ? (code === 429 ? 'rate limited' : 'server overloaded')
          : 'transient error';
        this.status = `retrying (${statusLabel})`;

        if (isRateOrServer && (attempt + 1) >= maxAutoRetries) {
          this.retrying = false;
          this.retryRemainingMs = 0;
          this.retryPlannedMs = 0;
          this.paused = true;
          this.status = 'paused (auto-retry limit reached)';
          toast('Auto-retry limit reached. Click Resume to continue.', 'warn', 7000);
          return;
        }

        await this.backoffWait(plannedWait);
      },
    });
  },

  clearRetryState() {
    this.retrying = false;
    this.retryAttempt = 0;
    this.retryMax = 0;
    this.retryRemainingMs = 0;
    this.retryPlannedMs = 0;
    if (this.running && !this.paused && /^retrying/.test(this.status)) this.status = 'running';
  },

  async ensureExtractedSourceReady() {
    if (this.sourceAnalysisStatus === 'analyzing' && this.sourceAnalysisPromise) {
      await this.sourceAnalysisPromise.catch(() => null);
    }
  },

  createAssistantMessage(text) {
    return this.provider === GOOGLE_PROVIDER
      ? { role: 'model', parts: [{ text }] }
      : { role: 'assistant', content: text };
  },

  async prepareNativeSource(provider, session) {
    try {
      return await provider.prepareNativeSource(session, this.fileBlob);
    } catch (err) {
      if (String(err?.message) === '__aborted__') return null;
      this.paused = true;
      this.status = 'paused (error)';
      this.lastErrorMessage = err?.message || 'unknown';
      const step = err?.__providerStep || 'source.prepare';
      const retries = err?.__providerRetries || 0;
      this.pushTrace({ request: { step }, error: this.serializeErr(err), retries });
      toast(`${this.providerLabel} source preparation failed: ${err?.message || 'unknown'}`, 'bad', 6000);
      return null;
    }
  },

  // Runs one provider generation with anomaly detection (artifact leaks,
  // short/empty output) and optional native-source recovery. Returns
  // { response, retries, text } on success, or null when the run must stop —
  // error/pause/abort state has already been applied in that case.
  async runGenerationTurn(provider, request, { allowNativeRecovery = false } = {}) {
    for (let contentAttempts = 0; ;) {
      const [response, retries, err] = await provider.generate(this.providerSession, request);
      if (err) {
        if (String(err?.message) === '__aborted__') return null;
        if (allowNativeRecovery && this.sourceMode === SOURCE_MODE_NATIVE && provider.canRecoverNativeSource(err)) {
          toast('Source reference expired; refreshing source and retrying…', 'warn');
          try {
            this.nativeSource = await provider.recoverNativeSource(this.providerSession, this.fileBlob);
            provider.rewriteHistoryNativeSource(this.history, this.nativeSource);
          } catch (recoveryErr) {
            this.finishWithError(recoveryErr, request, retries);
            return null;
          }
          continue;
        }
        this.finishWithError(err, request, retries);
        return null;
      }
      const text = provider.extractText(response);
      const nonCode = (text || '').trim().replace(/```[\s\S]*?```/g, '');
      // A bare end-marker response is a valid completion, not a short-output anomaly.
      const isCompletion = (text || '').trim().endsWith(String(this.endMarker || '<end_of_book>'));
      const tooShort = nonCode.length < 200 && !isCompletion;
      const leak = this.hasCtrlLeak(text);
      if (leak || (tooShort && this.pauseOnAnomaly)) {
        if (contentAttempts < ANOMALY_MAX_ATTEMPTS) {
          const reason = leak ? 'artifact leak (<ctrl94>)' : 'Short/empty response';
          this.status = `retrying (${reason})`;
          this.retryAttempt = contentAttempts;
          this.retryMax = ANOMALY_MAX_ATTEMPTS;
          this.lastErrorMessage = reason;
          await this.backoffWait(ANOMALY_WAIT_MS);
          this.retrying = false;
          contentAttempts += 1;
          continue;
        }
        this.paused = true;
        this.status = leak ? 'paused (artifact leak)' : 'paused (empty/short)';
        toast(leak ? 'Paused: artifact leak detected' : 'Paused: response too short', 'warn');
        return null;
      }
      this.clearRetryState();
      return { response, retries, text };
    }
  },

  recordTurn({ userMsg, request, response, retries, text }) {
    this.pushTrace({ request: this.sanitize(request), response, retries });
    // A bare end-marker reply just closes the run; don't record it as a section.
    if ((text || '').trim() === String(this.endMarker || '<end_of_book>')) return;
    const modelMsg = this.createAssistantMessage(text);
    this.history.push(userMsg, modelMsg);
    this.sectionsMeta.push({
      id: this.nextSectionId++,
      text,
      modelMsg,
      userMsgBefore: userMsg,
      candidatesTokenCount: this.extractCandidatesTokenCount(response),
    });
    this.sections += 1;
    this.tokenTally += estimateTokens(text);
  },

  async start() {
    this.ensureInitialized();
    if (!this.apiKey.trim()) {
      toast(`Add your ${this.providerLabel} API key first`, 'bad');
      return;
    }
    if (!this.fileBlob) {
      toast('Upload a PDF/EPUB first', 'bad');
      return;
    }
    if (!this.prompt.trim()) {
      toast('Prompt is empty', 'bad');
      return;
    }

    await this.ensureExtractedSourceReady();
    const provider = getProvider(this.provider);
    const validation = provider.validateRun({
      sourceMode: this.sourceMode,
      fileBlob: this.fileBlob,
      extracted: this.extractedSource,
      modelMeta: this.selectedModelMeta,
    });
    if (!validation.ok) {
      toast(validation.message || 'Configuration is invalid', 'bad', 6000);
      return;
    }

    this.history = [];
    this.sections = 0;
    this.tokenTally = 0;
    this.lastAssistant = '';
    this.trace = [];
    this.paused = false;
    this.running = false;
    this.sectionsMeta = [];
    this.nextSectionId = 1;
    this.retrying = false;
    this.retryAttempt = 0;
    this.retryMax = 0;
    this.retryRemainingMs = 0;
    this.retryPlannedMs = 0;
    this.lastErrorMessage = '';
    this.autoWaiting = false;
    this.autoWaitRemainingMs = 0;
    this.autoWaitPlannedMs = 0;
    this.lastRequestStartedAt = 0;
    this.providerSession = this.createProviderSession();
    this.nativeSource = null;
    this.status = this.sourceMode === SOURCE_MODE_NATIVE ? 'preparing source' : 'running';

    if (this.sourceMode === SOURCE_MODE_NATIVE) {
      this.nativeSource = await this.prepareNativeSource(provider, this.providerSession);
      if (!this.nativeSource) return;
    }

    this.running = true;
    this.status = 'running';
    this.startTime = Date.now();

    const requestUserFirst = provider.buildFirstUserMessage({
      sourceMode: this.sourceMode,
      nativeSource: this.nativeSource,
      extracted: this.extractedSource,
      instructionText: BEGIN_INSTRUCTION,
    });
    const historyUserFirst = provider.buildPersistentHistoryFirstUserMessage({
      sourceMode: this.sourceMode,
      nativeSource: this.nativeSource,
      extracted: this.extractedSource,
      instructionText: BEGIN_INSTRUCTION,
    });
    const firstRequest = provider.buildRequest({
      model: this.model,
      history: [],
      userMessage: requestUserFirst,
      prompt: this.prompt,
      useTemperature: this.useTemperature,
      temperature: this.temperature,
    });

    await this.maybeAutoWaitBeforeRequest();
    this.lastRequestStartedAt = Date.now();
    const firstTurn = await this.runGenerationTurn(provider, firstRequest);
    if (!firstTurn) return;

    this.recordTurn({ userMsg: historyUserFirst, request: firstRequest, ...firstTurn });
    const complete = await this.postTurnChecks(firstTurn.text);
    if (complete) {
      this.cleanFinish();
      return;
    }
    this.nextLoop();
  },

  async nextLoop() {
    const provider = getProvider(this.provider);
    while (this.running && !this.paused) {
      if (+this.budgetTime > 0 && (Date.now() - this.startTime) / 1000 > +this.budgetTime) {
        this.status = 'time budget reached';
        toast('Time budget reached', 'warn');
        break;
      }
      if (+this.budgetTokens > 0 && this.tokenTally >= +this.budgetTokens) {
        this.status = 'token budget reached (est)';
        toast('Token budget (estimated) reached', 'warn');
        break;
      }

      const nextUser = provider.buildNextUserMessage();
      const request = provider.buildRequest({
        model: this.model,
        history: this.history,
        userMessage: nextUser,
        prompt: this.prompt,
        useTemperature: this.useTemperature,
        temperature: this.temperature,
      });

      await this.maybeAutoWaitBeforeRequest();
      this.lastRequestStartedAt = Date.now();

      const turn = await this.runGenerationTurn(provider, request, { allowNativeRecovery: true });
      if (!turn) return;

      this.recordTurn({ userMsg: nextUser, request, ...turn });
      const complete = await this.postTurnChecks(turn.text);
      if (complete) break;
    }
    this.cleanFinish();
  },

  togglePause() {
    this.paused = !this.paused;
    toast(this.paused ? 'Paused' : 'Resumed', 'info');
    if (!this.paused && this.running) this.nextLoop();
  },

  stop() {
    this.running = false;
    this.retrying = false;
    this.autoWaiting = false;
    this.autoWaitRemainingMs = 0;
    this.autoWaitPlannedMs = 0;
    this.status = 'stopped';
    toast('Stopped', 'warn');
  },

  resumeOrStart() {
    if (this.running) {
      if (this.paused) this.togglePause();
      return;
    }
    this.start();
  },

  sanitize(request) {
    return JSON.parse(JSON.stringify(request));
  },

  applyTheme() {
    const preferDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = this.themeMode === 'dark' || (this.themeMode === 'auto' && preferDark);
    document.body.classList.toggle('dark', isDark);
  },

  persist() {
    try {
      localStorage.setItem(STORAGE_KEYS.prompt, this.prompt || '');
      localStorage.setItem(STORAGE_KEYS.model, this.model || '');
      localStorage.setItem(STORAGE_KEYS.provider, this.provider || GOOGLE_PROVIDER);
      localStorage.setItem(STORAGE_KEYS.sourceMode, this.sourceMode || SOURCE_MODE_NATIVE);
      localStorage.setItem(STORAGE_KEYS.useTemperature, String(!!this.useTemperature));
      localStorage.setItem(STORAGE_KEYS.temperature, String(this.temperature ?? ''));
      localStorage.setItem(STORAGE_KEYS.themeMode, this.themeMode || 'auto');
      localStorage.setItem(STORAGE_KEYS.autoWaitBetweenRequests, String(!!this.autoWaitBetweenRequests));
      localStorage.removeItem('distillboard.dark');
      this.providerKeys[this.provider] = this.apiKey || '';
      setStoredApiKey(this.provider, this.apiKey || '');
    } catch { }
  },

  serializeErr(err) {
    if (!err) return { message: 'unknown' };
    if (typeof err === 'string') return { message: err };
    return {
      message: err.message || 'unknown',
      name: err.name || 'Error',
      error: err.error || null,
      raw: err.response || err.toString?.(),
    };
  },

  pushTrace({ request, response, error, retries }) {
    this.trace.push({ ts: new Date().toISOString(), request, response, error, retries });
  },

  async maybeAutoWaitBeforeRequest() {
    if (!this.autoWaitBetweenRequests) return;
    if (!this.running || this.paused) return;
    if (!this.lastRequestStartedAt) return;
    const elapsed = Date.now() - this.lastRequestStartedAt;
    const waitMs = AUTO_WAIT_MS - elapsed;
    if (waitMs <= 0) return;
    await this.autoSpacingWait(waitMs);
  },

  async autoSpacingWait(ms) {
    if (ms <= 0) return;
    const previousStatus = this.status;
    if (this.running && !this.paused) this.status = 'waiting (auto-spacing)';
    this.autoWaiting = true;
    this.autoWaitPlannedMs = ms;
    this.autoWaitRemainingMs = ms;
    const step = 250;
    let remaining = ms;
    while (remaining > 0 && this.running && !this.paused) {
      await sleep(step);
      remaining -= step;
      this.autoWaitRemainingMs = remaining;
    }
    this.autoWaitRemainingMs = Math.max(0, remaining);
    this.autoWaitPlannedMs = 0;
    this.autoWaiting = false;
    if (this.running && !this.paused) {
      this.status = (previousStatus === 'running' || previousStatus === 'waiting (auto-spacing)')
        ? 'running'
        : previousStatus;
    }
  },

  async backoffWait(ms) {
    this.retrying = true;
    if (!this.retryMax) this.retryMax = '∞';
    this.retryPlannedMs = ms;
    this.retryRemainingMs = ms;
    const step = 250;
    let remaining = ms;
    while (remaining > 0 && !this.paused && (this.running || this.retrying)) {
      const delta = Math.min(step, remaining);
      await sleep(delta);
      remaining = Math.max(0, remaining - delta);
      this.retryRemainingMs = remaining;
    }
    this.retryRemainingMs = Math.max(0, remaining);
    if (remaining <= 0) this.retryPlannedMs = 0;
  },

  async postTurnChecks(text) {
    // endsWith instead of RegExp: user-configurable markers may contain regex
    // metacharacters.
    const marker = String(this.endMarker || '<end_of_book>');
    if ((text || '').trim().endsWith(marker)) {
      this.status = 'complete';
      toast('Distillation complete', 'good');
      return true;
    }
    if (this.pauseOnAnomaly) {
      if (/^\s*(i\s+(can\'t|cannot|won\'t)|as an ai|i\'m unable|i do not have access)/i.test(text || '')) {
        this.paused = true;
        this.status = 'paused (refusal)';
        toast('Paused: likely refusal', 'warn');
        return true;
      }
      if (sim3(this.lastAssistant, text) > 0.9) {
        this.paused = true;
        this.status = 'paused (loop)';
        toast('Paused: response repeating', 'warn');
        return true;
      }
    }
    this.lastAssistant = text;
    return false;
  },

  cleanFinish() {
    // Paused runs must stay resumable: keep `running` so Resume continues the
    // loop instead of restarting the distillation from scratch.
    if (this.paused) return;
    this.running = false;
    this.retrying = false;
    this.autoWaiting = false;
    if (this.status === 'running') this.status = 'stopped';
  },

  finishWithError(err, request, retries) {
    this.retrying = false;
    this.autoWaiting = false;
    this.autoWaitRemainingMs = 0;
    this.autoWaitPlannedMs = 0;
    this.paused = true;
    this.status = 'paused (error)';
    this.lastErrorMessage = err?.message || 'unknown';
    this.pushTrace({ request: this.sanitize(request), error: this.serializeErr(err), retries });
    toast(`API Error: ${err?.message || 'unknown'}`, 'bad', 7000);
  },
}).mount();

try {
  const media = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
  if (media && media.addEventListener) {
    media.addEventListener('change', () => {
      const scope = document.body.__v_scope__;
      if (scope?.ctx?.themeMode === 'auto') scope.ctx.applyTheme();
    });
  }
} catch { }
