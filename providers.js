import { GoogleGenAI, createUserContent, createPartFromUri } from 'https://esm.run/@google/genai@0.14.1';
import {
  GOOGLE_MODELS,
  GOOGLE_PROVIDER,
  OPENROUTER_PROVIDER,
  PROVIDER_LABELS,
  SOURCE_MODE_EXTRACTED,
  SOURCE_MODE_NATIVE,
  getFileKind,
  filterRecentOpenRouterModels,
  normalizeOpenRouterModel,
  sleep,
  sortOpenRouterModels,
} from './core.js';

const TRANSIENT_STATUS_STRINGS = new Set([
  'RESOURCE_EXHAUSTED',
  'INTERNAL',
  'UNAVAILABLE',
  'ABORTED',
  'DEADLINE_EXCEEDED',
]);

function isTransientStatusString(value) {
  if (!value) return false;
  return TRANSIENT_STATUS_STRINGS.has(String(value).toUpperCase());
}

function parseRetryDelay(err) {
  try {
    const details = err?.error?.details || [];
    const info = details.find(detail => detail?.['@type']?.includes('google.rpc.RetryInfo'));
    const retryDelay = info?.retryDelay || info?.retry_delay;
    if (retryDelay) {
      if (typeof retryDelay === 'object' && (retryDelay.seconds !== undefined || retryDelay.nanos !== undefined)) {
        const seconds = Number(retryDelay.seconds || 0) + Number(retryDelay.nanos || 0) / 1e9;
        if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
      }
      const match = String(retryDelay).match(/([0-9]+(?:\.[0-9]+)?)s/i);
      if (match) return Math.max(0, Math.floor(parseFloat(match[1]) * 1000));
    }
    const headers = err?.response?.headers || err?.headers || {};
    const getHeader = header => headers?.get ? headers.get(header) : (headers[header] || headers[String(header).toLowerCase()] || headers[String(header).toUpperCase()]);
    const retryAfter = getHeader && (getHeader('retry-after') || getHeader('Retry-After'));
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds * 1000));
      const when = Date.parse(String(retryAfter));
      if (!Number.isNaN(when)) {
        const delayMs = when - Date.now();
        if (delayMs > 0) return delayMs;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function isTransient(err) {
  const candidates = [err?.error?.code, err?.response?.status, err?.status, err?.statusCode, err?.code];
  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      if (candidate === 429 || candidate === 408 || candidate === 425) return true;
      if (candidate >= 500 && candidate < 600) return true;
    } else if (typeof candidate === 'string' && candidate) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        if (numeric === 429 || numeric === 408 || numeric === 425) return true;
        if (numeric >= 500 && numeric < 600) return true;
      }
      if (isTransientStatusString(candidate)) return true;
    }
  }
  const status = err?.error?.status || err?.status || err?.statusText;
  if (isTransientStatusString(status)) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}

function createRetryService({ shouldContinue = () => true, onTransient } = {}) {
  async function callWithRetriesFn(fn) {
    let attempt = 0;
    let lastErr = null;
    while (shouldContinue()) {
      try {
        const response = await fn();
        return [response, attempt, null];
      } catch (err) {
        lastErr = err;
        if (!isTransient(err)) return [null, attempt, err];
        const suggestedWait = parseRetryDelay(err);
        const base = Math.min(60000, 1000 * Math.pow(2, attempt));
        const fallback = Math.floor(base * (0.75 + Math.random() * 0.5));
        const waitMs = suggestedWait ?? fallback;
        if (onTransient) await onTransient({ attempt, waitMs, err });
        else await sleep(waitMs);
        if (!shouldContinue()) break;
        attempt += 1;
      }
    }
    return [null, attempt, lastErr || new Error('__aborted__')];
  }

  async function callWithRetries(fnOrRequest, runner) {
    if (typeof runner === 'function') return callWithRetriesFn(() => runner(fnOrRequest));
    return callWithRetriesFn(fnOrRequest);
  }

  return {
    callWithRetries,
    callWithRetriesFn,
    isTransient,
    parseRetryDelay,
  };
}

function makeGoogleConfig(prompt, useTemperature, temperature) {
  const config = { systemInstruction: prompt };
  if (useTemperature) config.generationConfig = { temperature: Number(temperature) || 0 };
  return config;
}

function extractGeminiText(response) {
  const raw = response?.raw || response;
  const candidate = raw?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  return parts.map(part => part.text || '').join('');
}

function extractOpenRouterText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => part?.text || part?.content || '').join('');
  }
  return response?.text || '';
}

function isOpenRouterClaudeModel(model) {
  return /^anthropic\/claude-/i.test(String(model || ''));
}

function openRouterClaudeCacheControl(model) {
  if (!isOpenRouterClaudeModel(model)) return null;
  return { type: 'ephemeral' };
}

async function fileToDataUrl(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  const mimeType = file.type || 'application/pdf';
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function buildExtractedSourcePrompt(extracted, instructionText) {
  return `Book source:\n\n${extracted?.text || ''}\n\n${instructionText}`;
}

function extractCandidatesTokenCount(response, providerId) {
  if (providerId === OPENROUTER_PROVIDER) {
    const completionTokens = response?.usage?.completion_tokens;
    return Number.isFinite(Number(completionTokens)) ? Number(completionTokens) : null;
  }
  try {
    const raw = response?.raw || response || {};
    const direct = raw?.candidatesTokenCount ?? response?.candidatesTokenCount;
    if (Number.isFinite(Number(direct))) return Number(direct);
    const usage = raw?.usageMetadata || raw?.usage_metadata || response?.usageMetadata || {};
    const viaUsage = usage?.candidatesTokenCount ?? usage?.candidates_token_count;
    if (Number.isFinite(Number(viaUsage))) return Number(viaUsage);
  } catch {
    return null;
  }
  return null;
}

async function listOpenRouterModels({ sourceMode }) {
  const response = await fetch('https://openrouter.ai/api/v1/models');
  if (!response.ok) throw new Error(`Failed to load OpenRouter models (${response.status})`);
  const payload = await response.json();
  const preferFile = sourceMode === SOURCE_MODE_NATIVE;
  let models = (payload?.data || [])
    .map(normalizeOpenRouterModel)
    .filter(model => model.id && model.supportsText);
  models = filterRecentOpenRouterModels(models);
  if (preferFile) models = models.filter(model => model.supportsFile);
  return sortOpenRouterModels(models, { preferFile });
}

async function uploadGoogleFile(session, fileBlob) {
  const [uploaded, uploadRetries, uploadErr] = await session.retry.callWithRetriesFn(() => session.ai.files.upload({
    file: fileBlob,
    config: { displayName: fileBlob.name },
  }));
  if (uploadErr) {
    uploadErr.__providerStep = 'files.upload';
    uploadErr.__providerRetries = uploadRetries;
    throw uploadErr;
  }

  let current = uploaded;
  let tries = 0;
  while (current?.state === 'PROCESSING' && tries < 120) {
    await sleep(2000);
    const [latest, pollRetries, pollErr] = await session.retry.callWithRetriesFn(() => session.ai.files.get({ name: current.name }));
    if (pollErr) {
      pollErr.__providerStep = 'files.get';
      pollErr.__providerRetries = pollRetries;
      throw pollErr;
    }
    current = latest;
    tries += 1;
  }

  if (current?.state === 'FAILED') {
    const err = new Error('File processing failed on Google AI Studio.');
    err.__providerStep = 'files.process';
    err.__providerRetries = 0;
    throw err;
  }

  return current;
}

const googleProvider = {
  id: GOOGLE_PROVIDER,
  label: PROVIDER_LABELS[GOOGLE_PROVIDER],
  async listModels() {
    return GOOGLE_MODELS;
  },
  createSession({ apiKey, shouldContinue, onTransient }) {
    return {
      ai: new GoogleGenAI({ apiKey }),
      retry: createRetryService({ shouldContinue, onTransient }),
    };
  },
  validateRun({ sourceMode, fileBlob, extracted }) {
    if (!fileBlob) return { ok: false, message: 'Upload a PDF/EPUB first' };
    if (sourceMode === SOURCE_MODE_EXTRACTED && !extracted?.text) {
      return { ok: false, message: 'Extracted text is not ready yet' };
    }
    return { ok: true };
  },
  async prepareNativeSource(session, fileBlob) {
    return uploadGoogleFile(session, fileBlob);
  },
  buildFirstUserMessage({ sourceMode, nativeSource, extracted, instructionText }) {
    if (sourceMode === SOURCE_MODE_EXTRACTED) {
      return createUserContent([buildExtractedSourcePrompt(extracted, instructionText)]);
    }
    const filePart = createPartFromUri(nativeSource.uri, nativeSource.mimeType);
    return createUserContent([filePart, instructionText]);
  },
  buildPersistentHistoryFirstUserMessage(args) {
    return this.buildFirstUserMessage(args);
  },
  buildNextUserMessage() {
    return createUserContent(['Next']);
  },
  buildRequest({ model, history, userMessage, prompt, useTemperature, temperature }) {
    return {
      model,
      contents: [...history, userMessage],
      tools: [],
      config: makeGoogleConfig(prompt, useTemperature, temperature),
    };
  },
  async generate(session, request) {
    return session.retry.callWithRetries(request, req => session.ai.models.generateContent(req));
  },
  extractText(response) {
    return response?.text || extractGeminiText(response);
  },
  extractCandidatesTokenCount(response) {
    return extractCandidatesTokenCount(response, GOOGLE_PROVIDER);
  },
  canRecoverNativeSource(err) {
    return err?.error?.status === 'FAILED_PRECONDITION' || /Unsupported file uri/i.test(String(err?.message || ''));
  },
  async recoverNativeSource(session, fileBlob) {
    return uploadGoogleFile(session, fileBlob);
  },
  rewriteHistoryNativeSource(history, nativeSource) {
    for (const message of history) {
      if (!message || message.role !== 'user' || !Array.isArray(message.parts)) continue;
      for (const part of message.parts) {
        if (part?.fileData) {
          part.fileData.fileUri = nativeSource.uri;
          if (nativeSource.mimeType) part.fileData.mimeType = nativeSource.mimeType;
        } else if (part?.file_data) {
          part.file_data.file_uri = nativeSource.uri;
          if (nativeSource.mimeType) part.file_data.mime_type = nativeSource.mimeType;
        }
      }
    }
  },
};

const openRouterProvider = {
  id: OPENROUTER_PROVIDER,
  label: PROVIDER_LABELS[OPENROUTER_PROVIDER],
  async listModels({ sourceMode }) {
    return listOpenRouterModels({ sourceMode });
  },
  createSession({ apiKey, shouldContinue, onTransient }) {
    return {
      apiKey,
      retry: createRetryService({ shouldContinue, onTransient }),
    };
  },
  validateRun({ sourceMode, fileBlob, extracted, modelMeta }) {
    if (!fileBlob) return { ok: false, message: 'Upload a PDF/EPUB first' };
    if (sourceMode === SOURCE_MODE_EXTRACTED && !extracted?.text) {
      return { ok: false, message: 'Extracted text is not ready yet' };
    }
    if (sourceMode === SOURCE_MODE_NATIVE) {
      if (getFileKind(fileBlob) !== 'pdf') {
        return { ok: false, message: 'OpenRouter native file mode currently requires PDF. Use Extracted text for EPUB.' };
      }
      if (!modelMeta?.supportsFile) {
        return { ok: false, message: 'Choose an OpenRouter model with file support for Native file mode.' };
      }
    }
    return { ok: true };
  },
  async prepareNativeSource(_session, fileBlob) {
    return {
      filename: fileBlob.name || 'document.pdf',
      fileData: await fileToDataUrl(fileBlob),
    };
  },
  buildFirstUserMessage({ sourceMode, nativeSource, extracted, instructionText }) {
    const content = [];
    if (sourceMode === SOURCE_MODE_EXTRACTED) {
      content.push({ type: 'text', text: buildExtractedSourcePrompt(extracted, instructionText) });
    } else {
      content.push({ type: 'text', text: instructionText });
      content.push({ type: 'file', file: nativeSource });
    }
    return { role: 'user', content };
  },
  buildPersistentHistoryFirstUserMessage({ sourceMode, nativeSource, extracted, instructionText }) {
    if (sourceMode === SOURCE_MODE_NATIVE && extracted?.text) {
      return this.buildFirstUserMessage({
        sourceMode: SOURCE_MODE_EXTRACTED,
        nativeSource,
        extracted,
        instructionText,
      });
    }
    return this.buildFirstUserMessage({ sourceMode, nativeSource, extracted, instructionText });
  },
  buildNextUserMessage() {
    return { role: 'user', content: [{ type: 'text', text: 'Next' }] };
  },
  buildRequest({ model, history, userMessage, prompt, useTemperature, temperature }) {
    const request = {
      model,
      messages: [{ role: 'system', content: prompt }, ...history, userMessage],
      stream: false,
    };
    const cacheControl = openRouterClaudeCacheControl(model);
    if (cacheControl) request.cache_control = cacheControl;
    if (useTemperature) request.temperature = Number(temperature) || 0;
    return request;
  },
  async generate(session, request) {
    return session.retry.callWithRetriesFn(async () => {
      const headers = {
        Authorization: `Bearer ${session.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'DistillBoard',
      };
      if (typeof location !== 'undefined' && location.origin) headers['HTTP-Referer'] = location.origin;
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = new Error(payload?.error?.message || `OpenRouter request failed (${response.status})`);
        err.response = { status: response.status, headers: response.headers };
        err.error = payload?.error || { message: err.message, code: response.status };
        throw err;
      }
      return payload;
    });
  },
  extractText(response) {
    return extractOpenRouterText(response);
  },
  extractCandidatesTokenCount(response) {
    return extractCandidatesTokenCount(response, OPENROUTER_PROVIDER);
  },
  canRecoverNativeSource() {
    return false;
  },
  async recoverNativeSource() {
    return null;
  },
  rewriteHistoryNativeSource() { },
};

const PROVIDERS = {
  [GOOGLE_PROVIDER]: googleProvider,
  [OPENROUTER_PROVIDER]: openRouterProvider,
};

export function getProvider(providerId) {
  return PROVIDERS[providerId] || googleProvider;
}

export function getProviderList() {
  return [googleProvider, openRouterProvider];
}

export {
  createUserContent,
  createPartFromUri,
  extractCandidatesTokenCount,
  isTransient,
  parseRetryDelay,
};
