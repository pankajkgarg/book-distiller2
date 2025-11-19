// Conversation workflow and error handling are documented in docs/WORKFLOW.md
import { createApp } from 'https://unpkg.com/petite-vue?module';
import { createGeminiService, createUserContent, createPartFromUri } from './gemini.js';

// Helpers
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const x = document.createElement(tag); if (cls) x.className = cls; if (html !== undefined) x.innerHTML = html; return x; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AUTO_WAIT_MS = 60000;
const estimateTokens = s => Math.ceil((s || '').length / 4);
function sim3(a, b) { const grams = s => { const t = (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); const G = new Set(); for (let i = 0; i < Math.max(0, t.length - 2); i++) G.add(t.slice(i, i + 3)); return G; }; const A = grams(a), B = grams(b); const inter = [...A].filter(x => B.has(x)).length; const union = new Set([...A, ...B]).size || 1; return inter / union; }
function toast(msg, type = 'info', ms = 3500) { const host = $('#toasts'); const n = el('div', `toast ${type}`, msg); host.appendChild(n); setTimeout(() => n.remove(), ms); }
function stripMd(md) { return (md || '').replace(/[>#*_`~\-]+/g, '').replace(/\n{3,}/g, '\n\n'); }
function download(name, text, type = 'text/plain;charset=utf-8') { const blob = new Blob([text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
function makePdf(name, md, trace, meta) {
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  try {
    const props = { title: name.replace(/\.[^.]+$/, ''), subject: 'Book excerpt', keywords: (meta ? `Gemini, ${meta.model || ''}` : ''), creator: 'book-distiller-petite-vue' };
    doc.setProperties && doc.setProperties(props);
  } catch { }
  const margin = 56, width = 483; const lines = (stripMd(md) || '(empty)').split('\n'); let y = margin; doc.setFont('Times', 'Normal'); doc.setFontSize(12);
  for (const line of lines) { const chunk = doc.splitTextToSize(line, width); if (y + chunk.length * 16 > 812) { doc.addPage(); y = margin; } doc.text(chunk, margin, y); y += chunk.length * 16 + 4; }
  if (trace) { doc.addPage(); doc.setFontSize(11); const t = JSON.stringify(trace, null, 2).split('\n'); let yy = margin; for (const row of t) { const chunk = doc.splitTextToSize(row, width); if (yy + chunk.length * 14 > 812) { doc.addPage(); yy = margin; } doc.text(chunk, margin, yy); yy += chunk.length * 14 + 2; } }
  doc.save(name);
}

const DEFAULT_PROMPT = `# Book Deep-Dive Exploration Prompt\n\n**Your Mission:** You are tasked with creating an immersive, in-depth exploration of a book I provide. Your goal is to channel the author's voice and produce a series of thematic deep-dives that, when combined, will read as a single, flowing document—like an extended meditation on the book written by the author themselves.\n\n## For the First Response Only\n\n**Structure your first response in two parts:**\n\n### Part 1: Opening the Journey\n- **Book Introduction**: In the author's voice, introduce the book's core premise and why it was written\n- **The Architecture**: Present a roadmap of all major themes/sections that will be covered across our multi-turn exploration, showing how each builds upon the last\n- **Reading Guide**: Briefly explain how these sections work together to form the complete journey\n\n### Part 2: First Thematic Section\n- Proceed with the first major theme following the standard section structure below\n\n## For All Thematic Sections\n\n**Creating Each Section:**\nBegin each section with a **thematic title** that captures the essence of what you're exploring.\n\n## Our Process\n- I'll provide the book source\n- You'll create the first response with both the opening journey overview and the first thematic section\n- When I respond with "Next", identify the next logical theme and create another complete section\n- Each new section should begin in a way that flows naturally from the previous section\n- When you've covered all major themes and the book's journey is complete, respond only with: \`<end_of_book>\`\n\n## Key Principles\n- **The reader should feel they've read the book itself through your responses**\n- Privilege completeness and depth over conciseness\n- Think of the final combined document as the book's essence, distilled but not diluted\n\n## Remember\nYou're not summarizing or studying the book—you're presenting it in its full richness through the author's own eyes. The reader should finish feeling like they've genuinely experienced the book's complete content, receiving all its wisdom, stories, and insights directly from the source material itself.`;

createApp({
  // state
  apiKey: localStorage.getItem('distillboard.gemini_key') || '',
  prompt: localStorage.getItem('distillboard.prompt') || DEFAULT_PROMPT,
  endMarker: '<end_of_book>',
  budgetTokens: '',
  budgetTime: '',
  pauseOnAnomaly: true,
  autoWaitBetweenRequests: localStorage.getItem('distillboard.autoWaitBetweenRequests') === 'true',
  isSettingsOpen: !localStorage.getItem('distillboard.gemini_key'),

  status: 'idle', sections: 0, tokenTally: 0,
  running: false, paused: false,
  history: [], lastAssistant: '',
  fileBlob: null, fileInfo: '',
  trace: [],
  // retry/backoff UI state
  retrying: false, retryAttempt: 0, retryMax: 0, retryRemainingMs: 0, retryPlannedMs: 0,
  // auto-wait UI state
  autoWaiting: false, autoWaitRemainingMs: 0, autoWaitPlannedMs: 0,
  lastErrorMessage: '',

  model: (() => { const allowed = ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']; const saved = localStorage.getItem('distillboard.model'); return allowed.includes(saved) ? saved : 'gemini-2.5-pro'; })(),
  useTemperature: (() => { const v = localStorage.getItem('distillboard.useTemperature'); return (v === null) ? true : (v === 'true'); })(),
  temperature: +(localStorage.getItem('distillboard.temperature') || '1.0'),
  themeMode: (() => { const v = localStorage.getItem('distillboard.themeMode'); if (v === 'light' || v === 'dark' || v === 'auto') return v; const legacy = localStorage.getItem('distillboard.dark'); if (legacy !== null) return legacy === 'true' ? 'dark' : 'light'; return 'auto'; })(),
  gem: null, uploadedFile: null, startTime: 0, lastRequestStartedAt: 0,
  // section bookkeeping
  nextSectionId: 1,
  sectionsMeta: [],
  anomalyRetryCount: 0,

  // computed
  get endMarkerEscaped() { return this.endMarker.replace(/^<|>$/g, ''); },

  savedKeys: JSON.parse(localStorage.getItem('distillboard.saved_keys') || '[]'),

  // methods
  // Pull candidatesTokenCount from the raw Gemini response (best-effort)
  extractCandidatesTokenCount(resp) {
    try {
      const raw = resp?.raw || resp || {};
      const direct = raw?.candidatesTokenCount ?? resp?.candidatesTokenCount;
      if (Number.isFinite(Number(direct))) return Number(direct);
      const um = raw?.usageMetadata || raw?.usage_metadata || resp?.usageMetadata || {};
      const viaUsage = um?.candidatesTokenCount ?? um?.candidates_token_count;
      if (Number.isFinite(Number(viaUsage))) return Number(viaUsage);
    } catch { }
    return null;
  },
  saveKey() {
    const k = this.apiKey.trim();
    if (!k) { toast('Empty key not saved', 'warn'); return; }

    // Check if key already exists
    const existing = this.savedKeys.find(s => s.key === k);
    if (existing) {
      toast('Key already saved as "' + existing.label + '"', 'info');
      return;
    }

    const label = prompt('Enter a label for this key (e.g. "Personal", "Work"):', 'Default');
    if (label === null) return; // cancelled

    const newEntry = { label: label || 'Default', key: k, created: Date.now() };
    this.savedKeys.push(newEntry);
    this.persistKeys();

    localStorage.setItem('distillboard.gemini_key', k);
    toast('API key saved', 'good');
  },
  deleteKey(index) {
    this.savedKeys.splice(index, 1);
    this.persistKeys();
    toast('Key deleted', 'info');
  },
  loadKey(entry) {
    this.apiKey = entry.key;
    localStorage.setItem('distillboard.gemini_key', entry.key);
    toast('Loaded key: ' + entry.label, 'info');
  },
  persistKeys() {
    localStorage.setItem('distillboard.saved_keys', JSON.stringify(this.savedKeys));
  },
  clearKey() { localStorage.removeItem('distillboard.gemini_key'); this.apiKey = ''; toast('API key cleared', 'good'); },
  onFileChange(e) { const f = e.target.files?.[0]; this.fileBlob = f || null; this.fileInfo = f ? `${f.name} • ${(f.type || '').replace('application/', '')} • ${(f.size / 1048576).toFixed(2)} MB` : ''; },
  toggleTrace() { const t = $('#trace'); t.classList.toggle('open'); t?.setAttribute?.('aria-hidden', t.classList.contains('open') ? 'false' : 'true'); },
  openTrace() { const t = $('#trace'); t.classList.add('open'); t?.setAttribute?.('aria-hidden', 'false'); },
  closeTrace() { const t = $('#trace'); t.classList.remove('open'); t?.setAttribute?.('aria-hidden', 'true'); },
  downloadTrace() { const blob = new Blob([JSON.stringify(this.trace, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'trace.json'; a.click(); URL.revokeObjectURL(a.href); },
  openExport() { $('#exportModal').showModal(); },
  openInfo() { $('#infoModal').showModal(); },
  onThemeChange() {
    const modes = ['auto', 'light', 'dark'];
    this.themeMode = modes[(modes.indexOf(this.themeMode) + 1) % modes.length];
    this.applyTheme();
    this.persist();
    toast('Theme: ' + this.themeMode, 'info');
  },
  async copyAll() { const text = this.combinedText(); try { await navigator.clipboard.writeText(text); toast('Copied combined text', 'good'); } catch { download('distillation.txt', text); } },
  // Helper: detect artifact leak token in output
  hasCtrlLeak(text) { return /<ctrl94>/i.test(String(text || '')); },
  // Export helpers: filename + metadata
  sanitizeFilename(name) { return String(name || '').replace(/[\\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(); },
  bookBaseName() {
    const fallback = 'Distillation';
    try {
      if (this.fileBlob && this.fileBlob.name) { return this.fileBlob.name.replace(/\.[^.]+$/, ''); }
    } catch { }
    return fallback;
  },
  exportBase() { return this.sanitizeFilename(`${this.bookBaseName()} - book excerpt`); },
  exportMeta() {
    const createdAt = new Date().toISOString();
    return {
      title: `${this.bookBaseName()} - book excerpt`,
      source: this.fileBlob?.name || '',
      model: this.model,
      temperature: this.useTemperature ? Number(this.temperature) : '(default)',
      sections: Number(this.sections) || 0,
      createdAt
    };
  },
  metadataFrontMatter() {
    const m = this.exportMeta(); return `---\n` +
      `title: ${m.title}\n` +
      (m.source ? `source_file: ${m.source}\n` : '') +
      `model: ${m.model}\n` +
      `temperature: ${m.temperature}\n` +
      `sections: ${m.sections}\n` +
      `date: ${m.createdAt}\n` +
      `generator: book-distiller-petite-vue\n` +
      `---\n\n`;
  },
  metadataTextHeader() { const m = this.exportMeta(); const lines = []; lines.push(`${m.title}`); if (m.source) lines.push(`Source: ${m.source}`); lines.push(`Model: ${m.model}`); lines.push(`Temperature: ${m.temperature}`); lines.push(`Sections: ${m.sections}`); lines.push(`Date: ${m.createdAt}`); lines.push(''); return lines.join('\n'); },
  exportMd() { const name = `${this.exportBase()}.md`; const body = this.combinedText(); download(name, this.metadataFrontMatter() + body, 'text/markdown;charset=utf-8'); },
  exportTxt() { const name = `${this.exportBase()}.txt`; const body = this.combinedText(); download(name, this.metadataTextHeader() + body); },
  exportPdf() { const include = $('#includeTrace').checked ? this.trace : null; const name = `${this.exportBase()}.pdf`; makePdf(name, this.combinedText(), include, this.exportMeta()); },

  combinedText() { return this.history.filter(h => h.role === 'model').map(h => h.parts.map(p => p.text || '').join('')).join('\n\n').trim(); },
  renderMd(md) { try { return window.marked.parse(md || ''); } catch { return md || ''; } },
  stringify(obj) { try { return JSON.stringify(obj, null, 2); } catch { return String(obj); } },
  getTitleFromMd(md) {
    const lines = (md || '').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s{0,3}#{1,6}\s+(.+)/); if (m) return m[1].trim();
      if (line.trim()) return line.trim().slice(0, 96);
    }
    return `Section ${this.sections + 1}`;
  },
  // appendDoc is now a no-op; rendering handled by template via v-for
  appendDoc(md, sid) { },
  // rebuildDoc now only recalculates counters; DOM handled by template
  rebuildDoc() {
    if (this.sectionsMeta.length === 0) { this.sections = 0; this.tokenTally = 0; return; }
    this.sections = 0; this.tokenTally = 0;
    for (const [i, meta] of this.sectionsMeta.entries()) {
      this.sections = i + 1;
      this.tokenTally += estimateTokens(meta.text || '');
    }
  },
  deleteSection(id) { const idx = this.sectionsMeta.findIndex(s => s.id === id); if (idx === -1) { toast('Section not found', 'warn'); return; } const meta = this.sectionsMeta[idx]; try { const mi = this.history.indexOf(meta.modelMsg); if (mi >= 0) this.history.splice(mi, 1); if (meta.userMsgBefore && Array.isArray(meta.userMsgBefore.parts)) { const isNextOnly = meta.userMsgBefore.parts.length === 1 && (meta.userMsgBefore.parts[0]?.text || '') === 'Next'; if (isNextOnly) { const ui = this.history.indexOf(meta.userMsgBefore); if (ui >= 0) this.history.splice(ui, 1); } } } catch { } this.sectionsMeta.splice(idx, 1); this.rebuildDoc(); toast('Section deleted', 'good'); },
  // resetDoc no longer manipulates DOM; placeholder handled in template
  resetDoc() { },

  async start() {
    if (!this.apiKey.trim()) { toast('Add your Gemini API key first', 'bad'); return; }
    if (!this.fileBlob) { toast('Upload a PDF/EPUB first', 'bad'); return; }
    if (!this.prompt.trim()) { toast('Prompt is empty', 'bad'); return; }

    // reset
    this.resetDoc(); this.history = []; this.sections = 0; this.tokenTally = 0; this.lastAssistant = ''; this.trace = []; this.paused = false; this.running = false; this.sectionsMeta = []; this.nextSectionId = 1; this.anomalyRetryCount = 0;
    this.retrying = false; this.retryAttempt = 0; this.retryMax = 0; this.retryRemainingMs = 0; this.retryPlannedMs = 0; this.lastErrorMessage = '';
    this.autoWaiting = false; this.autoWaitRemainingMs = 0; this.autoWaitPlannedMs = 0; this.lastRequestStartedAt = 0;
    this.status = 'uploading';

    // init Gemini service
    this.gem = createGeminiService({
      apiKey: this.apiKey.trim(),
      shouldContinue: () => !this.paused && (this.running || true),
      onTransient: async ({ attempt, waitMs, err }) => {
        // Determine status code if present
        const rawCode = (err?.error?.code ?? err?.response?.status ?? err?.status ?? err?.statusCode ?? err?.code);
        const code = Number(rawCode);
        const isRateOrServer = Number.isFinite(code) && (code === 429 || (code >= 500 && code < 600));

        // Policy: for 429/5xx, use fixed 60s retry and cap at 4 attempts
        const MAX_AUTO_RETRIES = 4;
        const plannedWait = isRateOrServer ? 60000 : waitMs;

        this.retrying = true;
        this.retryAttempt = attempt;
        this.retryMax = isRateOrServer ? MAX_AUTO_RETRIES : '∞';
        this.lastErrorMessage = err?.error?.message || err?.message || 'Temporary error';

        const statusLabel = isRateOrServer
          ? (code === 429 ? 'rate limited' : 'server overloaded')
          : 'transient error';
        this.status = `retrying (${statusLabel})`;

        // If we already reached the cap, pause and surface Resume
        if (isRateOrServer && (attempt + 1) >= MAX_AUTO_RETRIES) {
          this.retrying = false;
          this.retryRemainingMs = 0;
          this.retryPlannedMs = 0;
          this.paused = true;
          this.status = 'paused (auto-retry limit reached)';
          toast('Auto-retry limit reached. Click Resume to continue.', 'warn', 7000);
          return; // stop waiting; shouldContinue() becomes false and aborts the loop
        }

        await this.backoffWait(plannedWait);
      }
    });

    // upload via Files API and poll ACTIVE (with retries and RetryInfo)
    {
      const [up, utries, uerr] = await this.gem.callWithRetriesFn(() => this.gem.ai.files.upload({ file: this.fileBlob, config: { displayName: this.fileBlob.name } }));
      if (uerr) {
        if (String(uerr?.message) === '__aborted__') return;
        this.paused = true; this.status = 'paused (error)'; this.lastErrorMessage = uerr?.message || 'unknown';
        toast('Upload failed: ' + (uerr?.message || 'unknown'), 'bad', 6000);
        this.pushTrace({ request: { step: 'files.upload' }, error: this.serializeErr(uerr), retries: utries });
        return;
      }
      this.uploadedFile = up;
      let tries = 0;
      while (this.uploadedFile.state === 'PROCESSING' && tries < 120) {
        await sleep(2000);
        const [got, gtries, gerr] = await this.gem.callWithRetriesFn(() => this.gem.ai.files.get({ name: this.uploadedFile.name }));
        if (gerr) {
          if (String(gerr?.message) === '__aborted__') return;
          this.paused = true; this.status = 'paused (error)'; this.lastErrorMessage = gerr?.message || 'unknown';
          toast('Polling failed: ' + (gerr?.message || 'unknown'), 'bad', 6000);
          this.pushTrace({ request: { step: 'files.get' }, error: this.serializeErr(gerr), retries: gtries });
          return;
        }
        this.uploadedFile = got; tries++;
      }
      if (this.uploadedFile.state === 'FAILED') {
        const err = new Error('File processing failed on Gemini.');
        this.paused = true; this.status = 'paused (error)'; this.lastErrorMessage = err.message;
        this.pushTrace({ request: { step: 'files.process' }, error: this.serializeErr(err), retries: 0 });
        toast(err.message, 'bad');
        return;
      }
    }

    this.running = true; this.status = 'running'; this.startTime = Date.now();

    // First turn (see docs/WORKFLOW.md: Turn Structure)
    const filePart = createPartFromUri(this.uploadedFile.uri, this.uploadedFile.mimeType);
    const userFirst = createUserContent([filePart, 'Begin as instructed: include Opening the Journey (intro, architecture, reading guide) and the first complete thematic section.']);
    const req1 = { model: this.model, contents: [userFirst], tools: [], config: this.makeConfig() };
    let firstResp = null, firstTries = 0, firstText = '';
    await this.maybeAutoWaitBeforeRequest();
    this.lastRequestStartedAt = Date.now();
    for (let contentAttempts = 0; ;) {
      const [resp1, r1tries, r1err] = await this.gem.callWithRetries(req1);
      if (r1err) { if (String(r1err?.message) === '__aborted__') return; this.finishWithError(r1err, req1, r1tries); return; }
      const text1 = resp1?.text || this.gem.extractText(resp1);
      const nonCode = (text1 || '').trim().replace(/```[\s\S]*?```/g, '');
      const tooShort = nonCode.length < 200;
      const leak = this.hasCtrlLeak(text1);
      if (leak || (tooShort && this.pauseOnAnomaly)) {
        if (contentAttempts < 5) {
          const reason = leak ? 'artifact leak (<ctrl94>)' : 'Short/empty response';
          this.status = `retrying (${reason})`;
          this.retryAttempt = contentAttempts;
          this.retryMax = 5;
          this.lastErrorMessage = reason;
          await this.backoffWait(60000); this.retrying = false; continue;
        } else {
          this.paused = true; this.status = leak ? 'paused (artifact leak)' : 'paused (empty/short)';
          toast(leak ? 'Paused: artifact leak detected' : 'Paused: response too short', 'warn');
          return;
        }
      }
      firstResp = resp1; firstTries = r1tries; firstText = text1; break;
    }
    const modelMsg1 = { role: 'model', parts: [{ text: firstText }] };
    this.history.push(userFirst); this.history.push(modelMsg1);
    const sid1 = this.nextSectionId++;
    this.sectionsMeta.push({ id: sid1, text: firstText, modelMsg: modelMsg1, userMsgBefore: userFirst, candidatesTokenCount: this.extractCandidatesTokenCount(firstResp) });
    this.sections += 1; this.tokenTally += estimateTokens(firstText); this.appendDoc(firstText, sid1);
    this.pushTrace({ request: this.sanitize(req1), response: firstResp, retries: firstTries });
    this.lastRequestFinishedAt = Date.now();
    const done = await this.postTurnChecks(firstText); if (done) { this.cleanFinish(); return; }
    this.nextLoop();
  },

  async nextLoop() {
    while (this.running && !this.paused) {
      // budgets
      if (+this.budgetTime > 0 && (Date.now() - this.startTime) / 1000 > +this.budgetTime) { this.status = 'time budget reached'; toast('Time budget reached', 'warn'); break; }
      if (+this.budgetTokens > 0 && this.tokenTally >= +this.budgetTokens) { this.status = 'token budget reached (est)'; toast('Token budget (estimated) reached', 'warn'); break; }

      // After the first turn, only send "Next"; do not reattach the file.
      // See docs/WORKFLOW.md → Turn Structure
      const nextUser = createUserContent(['Next']);
      const req = { model: this.model, contents: [...this.history, nextUser], tools: [], config: this.makeConfig() };
      let resp = null, tries = 0;
      await this.maybeAutoWaitBeforeRequest();
      this.lastRequestStartedAt = Date.now();
      for (let contentAttempts = 0; ;) {
        const out = await this.gem.callWithRetries(req).catch(e => [null, 0, e]);
        const r = Array.isArray(out) ? out : [null, 0, new Error('unknown')];
        const [rresp, rtries, rerr] = r;
        if (rerr) {
          if (String(rerr?.message) === '__aborted__') return;
          if (rerr?.error?.status === 'FAILED_PRECONDITION' || /Unsupported file uri/i.test(String(rerr?.message || ''))) {
            // Invalid File Reference Recovery
            toast('File reference invalid; re-uploading and updating history…', 'warn');
            try {
              this.uploadedFile = await this.gem.ai.files.upload({ file: this.fileBlob, config: { displayName: this.fileBlob.name } });
              try { for (const msg of this.history) { if (!msg || msg.role !== 'user' || !Array.isArray(msg.parts)) continue; for (const p of msg.parts) { if (p && p.fileData) { p.fileData.fileUri = this.uploadedFile.uri; if (this.uploadedFile.mimeType) p.fileData.mimeType = this.uploadedFile.mimeType; } else if (p && p.file_data) { p.file_data.file_uri = this.uploadedFile.uri; if (this.uploadedFile.mimeType) p.file_data.mime_type = this.uploadedFile.mimeType; } } } } catch { }
            } catch (e) { this.finishWithError(rerr, req, rtries); return; }
            continue;
          }
          this.finishWithError(rerr, req, rtries); return;
        }
        const txt = rresp?.text || this.gem.extractText(rresp);
        const nonCode = (txt || '').trim().replace(/```[\s\S]*?```/g, '');
        const tooShort = nonCode.length < 200;
        const leak = this.hasCtrlLeak(txt);
        if (leak || (tooShort && this.pauseOnAnomaly)) {
          if (contentAttempts < 5) {
            const reason = leak ? 'artifact leak (<ctrl94>)' : 'Short/empty response';
            this.status = `retrying (${reason})`;
            this.retryAttempt = contentAttempts;
            this.retryMax = 5;
            this.lastErrorMessage = reason;
            await this.backoffWait(60000); this.retrying = false; continue;
          } else {
            this.paused = true; this.status = leak ? 'paused (artifact leak)' : 'paused (empty/short)';
            toast(leak ? 'Paused: artifact leak detected' : 'Paused: response too short', 'warn');
            return;
          }
        }
        resp = rresp; tries = rtries; var text = txt; break;
      }
      const modelMsg = { role: 'model', parts: [{ text }] };
      this.history.push(nextUser); this.history.push(modelMsg);
      const sid = this.nextSectionId++;
      this.sectionsMeta.push({ id: sid, text, modelMsg, userMsgBefore: nextUser, candidatesTokenCount: this.extractCandidatesTokenCount(resp) });
      this.sections += 1; this.tokenTally += estimateTokens(text); this.appendDoc(text, sid);
      this.pushTrace({ request: this.sanitize(req), response: resp, retries: tries });
      this.lastRequestFinishedAt = Date.now();
      const done = await this.postTurnChecks(text); if (done) break;
    }
    this.cleanFinish();
  },

  togglePause() { this.paused = !this.paused; toast(this.paused ? 'Paused' : 'Resumed', 'info'); if (!this.paused && this.running) this.nextLoop(); },
  stop() { this.running = false; this.retrying = false; this.autoWaiting = false; this.autoWaitRemainingMs = 0; this.autoWaitPlannedMs = 0; this.status = 'stopped'; toast('Stopped', 'warn'); },
  resumeOrStart() {
    if (this.running) {
      if (this.paused) this.togglePause();
    } else {
      this.start();
    }
  },

  // helpers
  sanitize(req) { return JSON.parse(JSON.stringify(req)); },
  makeConfig() { const cfg = { systemInstruction: this.prompt }; if (this.useTemperature) { cfg.generationConfig = { temperature: Number(this.temperature) || 0 }; } return cfg; },
  applyTheme() { const preferDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches; const isDark = this.themeMode === 'dark' || (this.themeMode === 'auto' && preferDark); document.body.classList.toggle('dark', isDark); },
  persist() { try { localStorage.setItem('distillboard.prompt', this.prompt || ''); localStorage.setItem('distillboard.model', this.model || ''); localStorage.setItem('distillboard.useTemperature', String(!!this.useTemperature)); localStorage.setItem('distillboard.temperature', String(this.temperature ?? '')); localStorage.setItem('distillboard.themeMode', this.themeMode || 'auto'); localStorage.setItem('distillboard.autoWaitBetweenRequests', String(!!this.autoWaitBetweenRequests)); localStorage.removeItem('distillboard.dark'); } catch { } },
  serializeErr(e) { if (!e) return { message: 'unknown' }; if (typeof e === 'string') return { message: e }; return { message: e.message || 'unknown', name: e.name || 'Error', raw: e?.response || e?.toString?.() }; },
  pushTrace({ request, response, error, retries }) { const ts = new Date().toISOString(); this.trace.push({ ts, request, response, error, retries }); },

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
    const prevStatus = this.status;
    if (this.running && !this.paused) this.status = 'waiting (auto-spacing)';
    this.autoWaiting = true;
    this.autoWaitPlannedMs = ms;
    this.autoWaitRemainingMs = ms;
    const step = 250;
    let remain = ms;
    while (remain > 0 && this.running && !this.paused) { await sleep(step); remain -= step; this.autoWaitRemainingMs = remain; }
    this.autoWaitRemainingMs = Math.max(0, remain);
    this.autoWaitPlannedMs = 0;
    this.autoWaiting = false;
    if (this.running && !this.paused) {
      if (prevStatus === 'running' || prevStatus === 'waiting (auto-spacing)') this.status = 'running';
      else this.status = prevStatus;
    }
  },

  // backoff UI helper (retry timings are driven by gemini service via onTransient)
  async backoffWait(ms) {
    this.retrying = true;
    if (!this.retryMax) this.retryMax = '∞';
    this.retryPlannedMs = ms;
    this.retryRemainingMs = ms;
    const step = 250;
    let remain = ms;
    while (remain > 0 && !this.paused && (this.running || this.retrying)) {
      const delta = Math.min(step, remain);
      await sleep(delta);
      remain = Math.max(0, remain - delta);
      this.retryRemainingMs = remain;
    }
    this.retryRemainingMs = Math.max(0, remain);
    if (remain <= 0) { this.retryPlannedMs = 0; }
  },

  async postTurnChecks(text) {
    const re = new RegExp(String(this.endMarker || '<end_of_book>') + '$');
    if (re.test((text || '').trim())) { this.status = 'complete'; toast('Distillation complete', 'good'); return true; }
    if (this.pauseOnAnomaly) {
      if (/^\s*(i\s+(can\'t|cannot|won\'t)|as an ai|i\'m unable|i do not have access)/i.test(text || '')) { this.paused = true; this.status = 'paused (refusal)'; toast('Paused: likely refusal', 'warn'); return true; }
      if (sim3(this.lastAssistant, text) > 0.9) { this.paused = true; this.status = 'paused (loop)'; toast('Paused: response repeating', 'warn'); return true; }
    }
    this.lastAssistant = text; return false;
  },

  cleanFinish() { this.running = false; this.retrying = false; this.autoWaiting = false; if (this.status === 'running') this.status = 'stopped'; },
  finishWithError(err, req, retries) {
    // Pause instead of aborting on errors
    this.retrying = false;
    this.autoWaiting = false; this.autoWaitRemainingMs = 0; this.autoWaitPlannedMs = 0;
    this.paused = true;
    this.status = 'paused (error)';
    this.lastErrorMessage = err?.message || 'unknown';
    this.pushTrace({ request: this.sanitize(req), error: this.serializeErr(err), retries });
    toast('API Error: ' + (err?.message || 'unknown'), 'bad', 7000);
  },
}).mount();

// Update theme on system preference change when in Auto mode
try {
  const media = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
  if (media && media.addEventListener) {
    media.addEventListener('change', () => {
      const scope = document.body.__v_scope__;
      if (scope && scope.ctx && scope.ctx.themeMode === 'auto') scope.ctx.applyTheme();
    });
  }
} catch { }
