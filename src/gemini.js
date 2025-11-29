// Gemini service: SDK wiring + retry helpers
// Retry/backoff semantics and transient detection are documented in docs/WORKFLOW.md
import { GoogleGenAI } from '@google/genai';
// Note: createUserContent and createPartFromUri are not exported by the SDK directly in the same way as the CDN version sometimes implies, 
// or might need to be constructed manually if the SDK version differs. 
// Checking the SDK docs or source would be ideal, but for now we will assume standard SDK usage.
// Actually, looking at the CDN import: `import { GoogleGenAI, createUserContent, createPartFromUri } from 'https://esm.run/@google/genai@0.14.1';`
// The official Node SDK usually exports GoogleGenAI. Helper functions might need to be implemented or imported differently.
// Let's stick to the main export and implement helpers if missing, or check if they are available.
// For 0.14.1, let's try to import them. If they fail, we will fix.
// import { SchemaType } from '@google/genai';

// Re-implementing helpers if they are not named exports in the npm package (common in some versions).
// The CDN version might be a bundle that exposes internals.
// Let's check what we actually use.


const sleep = ms => new Promise(r => setTimeout(r, ms));
const TRANSIENT_STATUS_STRINGS = new Set([
  'RESOURCE_EXHAUSTED',
  'INTERNAL',
  'UNAVAILABLE',
  'ABORTED',
  'DEADLINE_EXCEEDED'
]);

const isTransientStatusString = value => {
  if (!value) return false;
  return TRANSIENT_STATUS_STRINGS.has(String(value).toUpperCase());
};

function parseRetryDelay(err) {
  try {
    const details = err?.error?.details || [];
    const info = details.find(d => d?.['@type']?.includes('google.rpc.RetryInfo'));
    const rd = info?.retryDelay || info?.retry_delay;
    if (rd) {
      if (typeof rd === 'object' && (rd.seconds !== undefined || rd.nanos !== undefined)) {
        const secs = Number(rd.seconds || 0) + Number(rd.nanos || 0) / 1e9;
        if (Number.isFinite(secs) && secs >= 0) return Math.floor(secs * 1000);
      }
      const m = String(rd).match(/([0-9]+(?:\.[0-9]+)?)s/i);
      if (m) return Math.max(0, Math.floor(parseFloat(m[1]) * 1000));
    }
    const headers = (err?.response?.headers) || (err?.headers) || {};
    const getHeader = (h) => headers?.get ? headers.get(h) : (headers[h] || headers[h?.toLowerCase?.()] || headers[String(h).toLowerCase?.()]);
    const ra = getHeader && (getHeader('retry-after') || getHeader('Retry-After'));
    if (ra) {
      const secs = Number(ra);
      if (Number.isFinite(secs)) return Math.max(0, Math.floor(secs * 1000));
      const when = Date.parse(String(ra));
      if (!Number.isNaN(when)) {
        const ms = when - Date.now();
        if (ms > 0) return ms;
      }
    }
    return null;
  } catch { return null; }
}

function isTransient(err) {
  const candidates = [err?.error?.code, err?.response?.status, err?.status, err?.statusCode, err?.code];
  for (const c of candidates) {
    if (typeof c === 'number') {
      if (c === 429 || c === 408 || c === 425) return true;
      if (c >= 500 && c < 600) return true;
    } else if (typeof c === 'string' && c) {
      const n = Number(c);
      if (Number.isFinite(n)) {
        if (n === 429 || n === 408 || n === 425) return true;
        if (n >= 500 && n < 600) return true;
      }
      if (isTransientStatusString(c)) return true;
    }
  }
  const status = err?.error?.status || err?.status || err?.statusText;
  if (isTransientStatusString(status)) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}

function extractText(resp) {
  const json = resp?.raw || resp;
  const c = json?.candidates?.[0];
  const parts = c?.content?.parts || [];
  return parts.map(p => p.text || '').join('');
}

export function createGeminiService({ apiKey, shouldContinue = () => true, onTransient }) {
  const ai = new GoogleGenAI({ apiKey });

  async function callWithRetries(args) {
    let attempt = 0, lastErr = null;
    while (shouldContinue()) {
      try { const res = await ai.models.generateContent(args); return [res, attempt, null]; }
      catch (err) {
        lastErr = err; const transient = isTransient(err);
        if (transient) {
          const suggested = parseRetryDelay(err);
          const base = Math.min(60000, 1000 * Math.pow(2, attempt));
          const fallback = Math.floor(base * (0.75 + Math.random() * 0.5));
          const waitMs = suggested ?? fallback;
          if (onTransient) { await onTransient({ attempt, waitMs, err }); }
          else { await sleep(waitMs); }
          if (!shouldContinue()) break;
          attempt++; continue;
        }
        return [null, attempt, err];
      }
    }
    return [null, attempt, lastErr || new Error('__aborted__')];
  }

  async function callWithRetriesFn(fn) {
    let attempt = 0, lastErr = null;
    while (shouldContinue()) {
      try { const res = await fn(); return [res, attempt, null]; }
      catch (err) {
        lastErr = err; const transient = isTransient(err);
        if (transient) {
          const suggested = parseRetryDelay(err);
          const base = Math.min(60000, 1000 * Math.pow(2, attempt));
          const fallback = Math.floor(base * (0.75 + Math.random() * 0.5));
          const waitMs = suggested ?? fallback;
          if (onTransient) { await onTransient({ attempt, waitMs, err }); }
          else { await sleep(waitMs); }
          if (!shouldContinue()) break;
          attempt++; continue;
        }
        return [null, attempt, err];
      }
    }
    return [null, attempt, lastErr || new Error('__aborted__')];
  }

  return {
    ai,
    callWithRetries,
    callWithRetriesFn,
    extractText,
    parseRetryDelay,
    isTransient,
  };
}

export function createUserContent(parts) {
  return { role: 'user', parts: Array.isArray(parts) ? parts : [parts] };
}

export function createPartFromUri(uri, mimeType) {
  return { fileData: { fileUri: uri, mimeType } };
}
