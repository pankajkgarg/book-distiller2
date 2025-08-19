import { createApp } from 'https://unpkg.com/petite-vue?module';
import { createGeminiService, createUserContent, createPartFromUri } from './gemini.js';

// Helpers
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const x=document.createElement(tag); if(cls) x.className=cls; if(html!==undefined) x.innerHTML=html; return x; };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const estimateTokens = s => Math.ceil((s||'').length/4);
function sim3(a,b){ const grams=s=>{const t=(s||'').toLowerCase().replace(/\s+/g,' ').trim(); const G=new Set(); for(let i=0;i<Math.max(0,t.length-2);i++) G.add(t.slice(i,i+3)); return G;}; const A=grams(a),B=grams(b); const inter=[...A].filter(x=>B.has(x)).length; const union=new Set([...A,...B]).size||1; return inter/union; }
function toast(msg,type='info',ms=3500){ const host=$('#toasts'); const n=el('div',`toast ${type}`,msg); host.appendChild(n); setTimeout(()=>n.remove(),ms);} 
function stripMd(md){ return (md||'').replace(/[>#*_`~\-]+/g,'').replace(/\n{3,}/g,'\n\n'); }
function download(name, text, type='text/plain;charset=utf-8'){ const blob=new Blob([text],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function makePdf(name, md, trace){ const { jsPDF } = window.jspdf; const doc=new jsPDF({unit:'pt',format:'a4'}); const margin=56,width=483; const lines=(stripMd(md)||'(empty)').split('\n'); let y=margin; doc.setFont('Times','Normal'); doc.setFontSize(12); for(const line of lines){ const chunk=doc.splitTextToSize(line,width); if(y+chunk.length*16>812){ doc.addPage(); y=margin;} doc.text(chunk,margin,y); y+=chunk.length*16+4; } if(trace){ doc.addPage(); doc.setFontSize(11); const t=JSON.stringify(trace,null,2).split('\n'); let yy=margin; for(const row of t){ const chunk=doc.splitTextToSize(row,width); if(yy+chunk.length*14>812){ doc.addPage(); yy=margin;} doc.text(chunk,margin,yy); yy+=chunk.length*14+2; } } doc.save(name); }

const DEFAULT_PROMPT = `# Book Deep-Dive Exploration Prompt\n\n**Your Mission:** You are tasked with creating an immersive, in-depth exploration of a book I provide. Your goal is to channel the author's voice and produce a series of thematic deep-dives that, when combined, will read as a single, flowing document—like an extended meditation on the book written by the author themselves.\n\n## For the First Response Only\n\n**Structure your first response in two parts:**\n\n### Part 1: Opening the Journey\n- **Book Introduction**: In the author's voice, introduce the book's core premise and why it was written\n- **The Architecture**: Present a roadmap of all major themes/sections that will be covered across our multi-turn exploration, showing how each builds upon the last\n- **Reading Guide**: Briefly explain how these sections work together to form the complete journey\n\n### Part 2: First Thematic Section\n- Proceed with the first major theme following the standard section structure below\n\n## For All Thematic Sections\n\n**Creating Each Section:**\nBegin each section with a **thematic title** that captures the essence of what you're exploring.\n\n## Our Process\n- I'll provide the book source\n- You'll create the first response with both the opening journey overview and the first thematic section\n- When I respond with "Next", identify the next logical theme and create another complete section\n- Each new section should begin in a way that flows naturally from the previous section\n- When you've covered all major themes and the book's journey is complete, respond only with: \`<end_of_book>\`\n\n## Key Principles\n- **The reader should feel they've read the book itself through your responses**\n- Privilege completeness and depth over conciseness\n- Think of the final combined document as the book's essence, distilled but not diluted\n\n## Remember\nYou're not summarizing or studying the book—you're presenting it in its full richness through the author's own eyes. The reader should finish feeling like they've genuinely experienced the book's complete content, receiving all its wisdom, stories, and insights directly from the source material itself.`;

createApp({
  // state
  apiKey: localStorage.getItem('distillboard.gemini_key')||'',
  prompt: localStorage.getItem('distillboard.prompt') || DEFAULT_PROMPT,
  endMarker: '<end_of_book>',
  budgetTokens: '',
  budgetTime: '',
  pauseOnAnomaly: true,

  status: 'idle', sections: 0, tokenTally: 0,
  running: false, paused: false,
  history: [], lastAssistant: '',
  fileBlob: null, fileInfo: '',
  trace: [],
  // retry/backoff UI state
  retrying: false, retryAttempt: 0, retryMax: 0, retryRemainingMs: 0,
  lastErrorMessage: '',

  model: localStorage.getItem('distillboard.model') || 'gemini-2.5-pro',
  useTemperature: (localStorage.getItem('distillboard.useTemperature')||'false')==='true',
  temperature: +(localStorage.getItem('distillboard.temperature')||'1.0'),
  themeMode: (()=>{ const v=localStorage.getItem('distillboard.themeMode'); if(v==='light'||v==='dark'||v==='auto') return v; const legacy=localStorage.getItem('distillboard.dark'); if(legacy!==null) return legacy==='true'?'dark':'light'; return 'auto'; })(),
  gem: null, uploadedFile: null, startTime: 0,

  // computed
  get endMarkerEscaped(){ return this.endMarker.replace(/^<|>$/g,''); },

  // methods
  saveKey(){ const k=this.apiKey.trim(); if(!k){ toast('Empty key not saved','warn'); return; } localStorage.setItem('distillboard.gemini_key',k); toast('API key saved','good'); },
  clearKey(){ localStorage.removeItem('distillboard.gemini_key'); this.apiKey=''; toast('API key cleared','good'); },
  onFileChange(e){ const f=e.target.files?.[0]; this.fileBlob=f||null; this.fileInfo = f? `${f.name} • ${(f.type||'').replace('application/','')} • ${(f.size/1048576).toFixed(2)} MB` : ''; },
  toggleTrace(){ const t=$('#trace'); t.classList.toggle('open'); t?.setAttribute?.('aria-hidden', t.classList.contains('open')?'false':'true'); },
  openTrace(){ const t=$('#trace'); t.classList.add('open'); t?.setAttribute?.('aria-hidden','false'); },
  closeTrace(){ const t=$('#trace'); t.classList.remove('open'); t?.setAttribute?.('aria-hidden','true'); },
  downloadTrace(){ const blob=new Blob([JSON.stringify(this.trace,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='trace.json'; a.click(); URL.revokeObjectURL(a.href); },
  openExport(){ $('#exportModal').showModal(); },
  openInfo(){ $('#infoModal').showModal(); },
  onThemeChange(){ this.applyTheme(); this.persist(); toast('Theme: '+this.themeMode,'info'); },
  async copyAll(){ const text=this.combinedText(); try{ await navigator.clipboard.writeText(text); toast('Copied combined text','good'); }catch{ download('distillation.txt', text); } },
  exportMd(){ download('distillation.md', this.combinedText(), 'text/markdown;charset=utf-8'); },
  exportTxt(){ download('distillation.txt', this.combinedText()); },
  exportPdf(){ const include = $('#includeTrace').checked ? this.trace : null; makePdf('distillation.pdf', this.combinedText(), include); },

  combinedText(){ return this.history.filter(h=>h.role==='model').map(h=>h.parts.map(p=>p.text||'').join('')).join('\n\n').trim(); },
  getTitleFromMd(md){
    const lines=(md||'').split(/\r?\n/);
    for(const line of lines){
      const m=line.match(/^\s{0,3}#{1,6}\s+(.+)/); if(m) return m[1].trim();
      if(line.trim()) return line.trim().slice(0,96);
    }
    return `Section ${this.sections+1}`;
  },
  appendDoc(md){ const host=$('#liveDoc'); if(host.firstElementChild && host.firstElementChild.classList.contains('muted')) host.innerHTML=''; const container=el('div','section'); const head=el('div','sectionHead'); const title=el('div','sectionTitle', `Section ${this.sections}: ${this.getTitleFromMd(md)}`); head.appendChild(title); container.appendChild(head); const body=el('div','sectionBody'); const prose=el('div','prose'); prose.innerHTML=window.marked.parse(md||''); body.appendChild(prose); container.appendChild(body); host.appendChild(container); host.scrollTo({top: host.scrollHeight, behavior:'smooth'}); },
  resetDoc(){ $('#liveDoc').innerHTML='<div class="muted">Output will appear here…</div>'; },

  async start(){
    if(!this.apiKey.trim()){ toast('Add your Gemini API key first','bad'); return; }
    if(!this.fileBlob){ toast('Upload a PDF/EPUB first','bad'); return; }
    if(!this.prompt.trim()){ toast('Prompt is empty','bad'); return; }

    // reset
    this.resetDoc(); this.history=[]; this.sections=0; this.tokenTally=0; this.lastAssistant=''; this.trace=[]; this.paused=false; this.running=false;
    this.status='uploading';

    // init Gemini service
    this.gem = createGeminiService({
      apiKey: this.apiKey.trim(),
      shouldContinue: ()=> !this.paused && (this.running || true),
      onTransient: async ({attempt, waitMs, err})=>{
        this.retrying=true;
        this.retryAttempt=attempt;
        this.retryMax='∞';
        this.lastErrorMessage = err?.error?.message || err?.message || 'Temporary error';
        await this.backoffWait(waitMs);
      }
    });

    // upload via Files API and poll ACTIVE (with retries and RetryInfo)
    {
      const [up, utries, uerr] = await this.gem.callWithRetriesFn(()=>this.gem.ai.files.upload({ file: this.fileBlob, config: { displayName: this.fileBlob.name } }));
      if(uerr){
        if(String(uerr?.message)==='__aborted__') return;
        this.paused = true; this.status='paused (error)'; this.lastErrorMessage = uerr?.message||'unknown';
        toast('Upload failed: '+(uerr?.message||'unknown'),'bad',6000);
        this.pushTrace({request:{step:'files.upload'}, error:this.serializeErr(uerr), retries:utries});
        return;
      }
      this.uploadedFile = up;
      let tries=0;
      while(this.uploadedFile.state==='PROCESSING' && tries<120){
        await sleep(2000);
        const [got, gtries, gerr] = await this.gem.callWithRetriesFn(()=>this.gem.ai.files.get({ name: this.uploadedFile.name }));
        if(gerr){
          if(String(gerr?.message)==='__aborted__') return;
          this.paused = true; this.status='paused (error)'; this.lastErrorMessage = gerr?.message||'unknown';
          toast('Polling failed: '+(gerr?.message||'unknown'),'bad',6000);
          this.pushTrace({request:{step:'files.get'}, error:this.serializeErr(gerr), retries:gtries});
          return;
        }
        this.uploadedFile = got; tries++;
      }
      if(this.uploadedFile.state==='FAILED'){
        const err=new Error('File processing failed on Gemini.');
        this.paused = true; this.status='paused (error)'; this.lastErrorMessage = err.message;
        this.pushTrace({request:{step:'files.process'}, error:this.serializeErr(err), retries:0});
        toast(err.message,'bad');
        return;
      }
    }

    this.running=true; this.status='running'; this.startTime=Date.now();

    // First turn
    const filePart = createPartFromUri(this.uploadedFile.uri, this.uploadedFile.mimeType);
    const userFirst = createUserContent([ filePart, 'Begin as instructed: include Opening the Journey (intro, architecture, reading guide) and the first complete thematic section.' ]);
    const req1 = { model: this.model, contents:[ userFirst ], config: this.makeConfig() };
    const [resp1, r1tries, r1err] = await this.gem.callWithRetries(req1);
    if(r1err){ if(String(r1err?.message)==='__aborted__') return; this.finishWithError(r1err, req1, r1tries); return; }
    const text1 = resp1?.text || this.gem.extractText(resp1);
    this.history.push(userFirst); this.history.push({role:'model', parts:[{text:text1}]});
    this.sections+=1; this.tokenTally+=estimateTokens(text1); this.appendDoc(text1);
    this.pushTrace({request:this.sanitize(req1), response:resp1, retries:r1tries});
    const done = await this.postTurnChecks(text1); if(done){ this.cleanFinish(); return; }
    this.nextLoop();
  },

  async nextLoop(){
    while(this.running && !this.paused){
      // budgets
      if(+this.budgetTime>0 && (Date.now()-this.startTime)/1000 > +this.budgetTime){ this.status='time budget reached'; toast('Time budget reached','warn'); break; }
      if(+this.budgetTokens>0 && this.tokenTally >= +this.budgetTokens){ this.status='token budget reached (est)'; toast('Token budget (estimated) reached','warn'); break; }

      const filePart = createPartFromUri(this.uploadedFile.uri, this.uploadedFile.mimeType);
      const nextUser = createUserContent([ filePart, 'Next' ]);
      const req = { model:this.model, contents:[...this.history, nextUser], config: this.makeConfig() };
      const [resp, tries, err] = await this.gem.callWithRetries(req);
      if(err){
        if(String(err?.message)==='__aborted__') return;
        if(err?.error?.status==='FAILED_PRECONDITION' || /Unsupported file uri/i.test(String(err?.message||''))){
          toast('File reference invalid; re-uploading once…','warn');
          try{ this.uploadedFile = await this.gem.ai.files.upload({ file:this.fileBlob, config:{ displayName:this.fileBlob.name }}); }
          catch(e){ this.finishWithError(err, req, tries); return; }
          continue; // retry next iteration
        }
        this.finishWithError(err, req, tries); return;
      }
      const text = resp?.text || this.gem.extractText(resp);
      this.history.push(nextUser); this.history.push({role:'model', parts:[{text}]});
      this.sections+=1; this.tokenTally+=estimateTokens(text); this.appendDoc(text);
      this.pushTrace({request:this.sanitize(req), response:resp, retries:tries});
      const done = await this.postTurnChecks(text); if(done) break;
    }
    this.cleanFinish();
  },

  togglePause(){ this.paused=!this.paused; toast(this.paused?'Paused':'Resumed', 'info'); if(!this.paused && this.running) this.nextLoop(); },
  stop(){ this.running=false; this.status='stopped'; toast('Stopped','warn'); },
  resumeOrStart(){
    if(this.running){
      if(this.paused) this.togglePause();
    } else {
      this.start();
    }
  },

  // helpers
  sanitize(req){ return JSON.parse(JSON.stringify(req)); },
  makeConfig(){ const cfg={ systemInstruction: this.prompt }; if(this.useTemperature){ cfg.generationConfig={ temperature: Number(this.temperature)||0 }; } return cfg; },
  applyTheme(){ const preferDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches; const isDark = this.themeMode==='dark' || (this.themeMode==='auto' && preferDark); document.body.classList.toggle('dark', isDark); },
  persist(){ try{ localStorage.setItem('distillboard.prompt', this.prompt||''); localStorage.setItem('distillboard.model', this.model||''); localStorage.setItem('distillboard.useTemperature', String(!!this.useTemperature)); localStorage.setItem('distillboard.temperature', String(this.temperature??'')); localStorage.setItem('distillboard.themeMode', this.themeMode||'auto'); localStorage.removeItem('distillboard.dark'); }catch{} },
  serializeErr(e){ if(!e) return {message:'unknown'}; if(typeof e==='string') return {message:e}; return { message: e.message||'unknown', name:e.name||'Error', raw:e?.response||e?.toString?.() }; },
  pushTrace({request,response,error,retries}){ const ts=new Date().toISOString(); this.trace.push({ts,request,response,error,retries}); const card=el('div','item'); card.appendChild(el('div','',`<b>${error?'Error':'Turn'}</b> <span class=\"muted\" style=\"float:right\">${new Date().toLocaleTimeString()}</span>`)); const rq=el('div','pre'); rq.textContent=JSON.stringify(request,null,2); card.appendChild(el('div','muted','Request:')); card.appendChild(rq); if(response){ const rs=el('div','pre'); rs.textContent=JSON.stringify(response,null,2); card.appendChild(el('div','muted','Response:')); card.appendChild(rs);} if(error){ const er=el('div','pre'); er.textContent=JSON.stringify(error,null,2); card.appendChild(el('div','muted','Error:')); card.appendChild(er);} if(retries>0) card.appendChild(el('div','muted',`Retries: ${retries}`)); $('#traceList').prepend(card); },

  // backoff UI helper (retry timings are driven by gemini service via onTransient)
  async backoffWait(ms){
    this.retrying=true; this.retryMax='∞'; this.retryRemainingMs=ms;
    const step=250; let remain=ms;
    while(remain>0 && this.running && !this.paused){ await sleep(step); remain-=step; this.retryRemainingMs=remain; }
  },

  async postTurnChecks(text){
    const re=new RegExp(String(this.endMarker||'<end_of_book>')+'$');
    if(re.test((text||'').trim())){ this.status='complete'; toast('Distillation complete','good'); return true; }
    if(this.pauseOnAnomaly){
      if(/^\s*(i\s+(can\'t|cannot|won\'t)|as an ai|i\'m unable|i do not have access)/i.test(text||'')){ this.paused=true; this.status='paused (refusal)'; toast('Paused: likely refusal','warn'); return true; }
      if(((text||'').trim().replace(/```[\s\S]*?```/g,'').length)<200){ this.paused=true; this.status='paused (empty/short)'; toast('Paused: response too short','warn'); return true; }
      if(sim3(this.lastAssistant, text)>0.9){ this.paused=true; this.status='paused (loop)'; toast('Paused: response repeating','warn'); return true; }
    }
    this.lastAssistant = text; return false;
  },

  cleanFinish(){ this.running=false; this.retrying=false; if(this.status==='running') this.status='stopped'; },
  finishWithError(err, req, retries){
    // Pause instead of aborting on errors
    this.retrying=false;
    this.paused=true;
    this.status='paused (error)';
    this.lastErrorMessage = err?.message || 'unknown';
    this.pushTrace({request:this.sanitize(req), error:this.serializeErr(err), retries});
    toast('API Error: '+(err?.message||'unknown'),'bad',7000);
  },
}).mount();

// Update theme on system preference change when in Auto mode
try{
  const media = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
  if(media && media.addEventListener){
    media.addEventListener('change', ()=>{
      const scope = document.body.__v_scope__;
      if(scope && scope.ctx && scope.ctx.themeMode==='auto') scope.ctx.applyTheme();
    });
  }
}catch{}
