// Gemini service: SDK wiring + retry helpers
// Retry/backoff semantics and transient detection are documented in docs/WORKFLOW.md
import { GoogleGenAI, createUserContent, createPartFromUri } from 'https://esm.run/@google/genai@0.14.1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseRetryDelay(err){
  try{
    const details = err?.error?.details || [];
    const info = details.find(d=>d?.['@type']?.includes('google.rpc.RetryInfo'));
    const rd = info?.retryDelay || info?.retry_delay;
    if(rd){
      if(typeof rd === 'object' && (rd.seconds!==undefined || rd.nanos!==undefined)){
        const secs = Number(rd.seconds||0) + Number(rd.nanos||0)/1e9;
        if(Number.isFinite(secs) && secs>=0) return Math.floor(secs*1000);
      }
      const m = String(rd).match(/([0-9]+(?:\.[0-9]+)?)s/i);
      if(m) return Math.max(0, Math.floor(parseFloat(m[1])*1000));
    }
    const headers = (err?.response?.headers) || (err?.headers) || {};
    const getHeader = (h)=> headers?.get ? headers.get(h) : (headers[h] || headers[h?.toLowerCase?.()] || headers[String(h).toLowerCase?.()] );
    const ra = getHeader && (getHeader('retry-after') || getHeader('Retry-After'));
    if(ra){
      const secs = Number(ra);
      if(Number.isFinite(secs)) return Math.max(0, Math.floor(secs*1000));
      const when = Date.parse(String(ra));
      if(!Number.isNaN(when)){
        const ms = when - Date.now();
        if(ms>0) return ms;
      }
    }
    return null;
  }catch{ return null; }
}

function isTransient(err){
  const candidates = [err?.error?.code, err?.response?.status, err?.status, err?.statusCode, err?.code];
  for(const c of candidates){
    if(typeof c === 'number'){
      if(c===429 || c===408 || c===425) return true;
      if(c>=500 && c<600) return true;
    }else if(typeof c === 'string' && c){
      const n = Number(c);
      if(Number.isFinite(n)){
        if(n===429 || n===408 || n===425) return true;
        if(n>=500 && n<600) return true;
      }
    }
  }
  const status = err?.error?.status || err?.statusText;
  if(status==='RESOURCE_EXHAUSTED' || status==='INTERNAL' || status==='UNAVAILABLE' || status==='ABORTED') return true;
  if(typeof navigator!=='undefined' && navigator.onLine===false) return true;
  return false;
}

function extractText(resp){
  const json = resp?.raw || resp;
  const c = json?.candidates?.[0];
  const parts = c?.content?.parts||[];
  return parts.map(p=>p.text||'').join('');
}

export function createGeminiService({ apiKey, shouldContinue = ()=>true, onTransient }){
  const ai = new GoogleGenAI({ apiKey });

  async function callWithRetries(args){
    let attempt=0, lastErr=null;
    while(shouldContinue()){
      try{ const res = await ai.models.generateContent(args); return [res, attempt, null]; }
      catch(err){
        lastErr=err; const transient=isTransient(err);
        if(transient){
          const suggested=parseRetryDelay(err);
          const base=Math.min(60000, 1000*Math.pow(2,attempt));
          const fallback=Math.floor(base*(0.75+Math.random()*0.5));
          const waitMs = suggested ?? fallback;
          if(onTransient){ await onTransient({attempt, waitMs, err}); }
          else { await sleep(waitMs); }
          if(!shouldContinue()) break;
          attempt++; continue;
        }
        return [null, attempt, err];
      }
    }
    return [null, attempt, lastErr||new Error('__aborted__')];
  }

  async function callWithRetriesFn(fn){
    let attempt=0, lastErr=null;
    while(shouldContinue()){
      try{ const res = await fn(); return [res, attempt, null]; }
      catch(err){
        lastErr=err; const transient=isTransient(err);
        if(transient){
          const suggested=parseRetryDelay(err);
          const base=Math.min(60000, 1000*Math.pow(2,attempt));
          const fallback=Math.floor(base*(0.75+Math.random()*0.5));
          const waitMs = suggested ?? fallback;
          if(onTransient){ await onTransient({attempt, waitMs, err}); }
          else { await sleep(waitMs); }
          if(!shouldContinue()) break;
          attempt++; continue;
        }
        return [null, attempt, err];
      }
    }
    return [null, attempt, lastErr||new Error('__aborted__')];
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

export { createUserContent, createPartFromUri };
