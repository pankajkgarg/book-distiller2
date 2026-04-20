import { GlobalWorkerOptions, getDocument } from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
import { strFromU8, unzipSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import { countWords, estimateTokens, getFileKind, getFileSignature, normalizeWhitespace } from './core.js';

GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';

function buildAnalysis(text, extra = {}) {
  const normalized = normalizeWhitespace(text);
  return {
    text: normalized,
    wordCount: normalized ? countWords(normalized) : 0,
    tokenEstimate: normalized ? estimateTokens(normalized) : 0,
    charCount: normalized.length,
    warnings: [],
    ...extra,
  };
}

function localName(node) {
  return String(node?.localName || node?.nodeName || '').toLowerCase();
}

function getFirstByLocalName(root, name) {
  return root?.getElementsByTagNameNS?.('*', name)?.[0] || root?.getElementsByTagName?.(name)?.[0] || null;
}

function getAllByLocalName(root, name) {
  const nsMatches = Array.from(root?.getElementsByTagNameNS?.('*', name) || []);
  if (nsMatches.length > 0) return nsMatches;
  return Array.from(root?.getElementsByTagName?.(name) || []);
}

function normalizeZipPath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

function resolveZipPath(baseFilePath, relativePath) {
  const base = normalizeZipPath(baseFilePath);
  const relative = normalizeZipPath(String(relativePath || '').split('#')[0].split('?')[0]);
  if (!relative) return '';
  if (!base) return relative;
  const baseParts = base.split('/').slice(0, -1);
  const parts = [...baseParts, ...relative.split('/')];
  const resolved = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function extractReadableText(root) {
  const chunks = [];
  const blockTags = new Set([
    'address', 'article', 'aside', 'blockquote', 'body', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption',
    'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol',
    'p', 'pre', 'section', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
  ]);
  const skipTags = new Set(['head', 'script', 'style', 'svg', 'noscript']);

  const pushBreak = () => {
    const last = chunks[chunks.length - 1];
    if (last !== '\n\n') chunks.push('\n\n');
  };

  const walk = node => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) chunks.push(text, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = localName(node);
    if (skipTags.has(tag)) return;
    if (tag === 'nav' || String(node.getAttribute?.('epub:type') || '').includes('toc')) return;

    const isBlock = blockTags.has(tag);
    if (tag === 'br' || tag === 'hr') {
      pushBreak();
      return;
    }

    if (isBlock) pushBreak();
    for (const child of Array.from(node.childNodes || [])) walk(child);
    if (isBlock) pushBreak();
  };

  walk(root);
  return normalizeWhitespace(chunks.join(''));
}

function groupPdfItemsIntoLines(items) {
  const lines = [];
  let current = [];
  let currentY = null;
  for (const item of items || []) {
    const text = String(item?.str || '').trim();
    if (!text) continue;
    const y = Number(item?.transform?.[5] || 0);
    if (currentY === null) currentY = y;
    if (Math.abs(y - currentY) > 2.5 && current.length > 0) {
      lines.push(current.join(' ').replace(/\s+/g, ' ').trim());
      current = [];
      currentY = y;
    }
    current.push(text);
  }
  if (current.length > 0) lines.push(current.join(' ').replace(/\s+/g, ' ').trim());
  return lines.filter(Boolean);
}

function decodePdfLiteralString(raw) {
  return String(raw || '')
    .replace(/\\([\\()])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

async function extractPdfFallback(file) {
  const buffer = await file.arrayBuffer();
  const raw = new TextDecoder('latin1').decode(buffer);
  const matches = [...raw.matchAll(/\((?:\\.|[^()])*\)\s*Tj/g)];
  const texts = matches
    .map(match => {
      const literal = match[0].replace(/\)\s*Tj$/, '').replace(/^\(/, '');
      return decodePdfLiteralString(literal);
    })
    .filter(Boolean);
  return buildAnalysis(texts.join('\n'), {
    kind: 'pdf',
    pageCount: 1,
    warnings: texts.length > 0
      ? ['Used lightweight PDF text fallback; structured extraction was unavailable in this browser context.']
      : ['No extractable PDF text found. Native file mode may still work.'],
  });
}

async function extractPdf(file) {
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const lines = groupPdfItemsIntoLines(textContent.items || []);
      const pageText = normalizeWhitespace(lines.join('\n'));
      if (pageText) pages.push(`--- Page ${pageNumber} ---\n${pageText}`);
    }
    return buildAnalysis(pages.join('\n\n'), {
      kind: 'pdf',
      pageCount: pdf.numPages,
      warnings: pages.length > 0 ? [] : ['No extractable PDF text found. Native file mode may still work.'],
    });
  } catch (err) {
    const fallback = await extractPdfFallback(file);
    if (err?.message) fallback.warnings.unshift(err.message);
    return fallback;
  }
}

function parseXml(xmlText, mimeType = 'application/xml') {
  return new DOMParser().parseFromString(xmlText, mimeType);
}

function hasParserError(doc) {
  return !!getFirstByLocalName(doc, 'parsererror');
}

function readZipTextFile(zipEntries, path) {
  const entry = zipEntries[normalizeZipPath(path)];
  if (!entry) return '';
  return strFromU8(entry);
}

async function extractEpub(file) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const containerXml = readZipTextFile(entries, 'META-INF/container.xml');
  if (!containerXml) throw new Error('EPUB container.xml not found');

  const containerDoc = parseXml(containerXml);
  const rootfile = getFirstByLocalName(containerDoc, 'rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB package path missing');

  const opfXml = readZipTextFile(entries, opfPath);
  if (!opfXml) throw new Error('EPUB package document missing');

  const opfDoc = parseXml(opfXml);
  const manifestItems = new Map();
  for (const item of getAllByLocalName(opfDoc, 'item')) {
    manifestItems.set(item.getAttribute('id'), {
      href: item.getAttribute('href') || '',
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    });
  }

  const chapters = [];
  for (const itemref of getAllByLocalName(opfDoc, 'itemref')) {
    const item = manifestItems.get(itemref.getAttribute('idref'));
    if (!item?.href) continue;
    const mediaType = item.mediaType.toLowerCase();
    if (!mediaType.includes('html') && !mediaType.includes('xml')) continue;
    const chapterPath = resolveZipPath(opfPath, item.href);
    const chapterMarkup = readZipTextFile(entries, chapterPath);
    if (!chapterMarkup) continue;
    let chapterDoc = parseXml(chapterMarkup, 'application/xhtml+xml');
    if (hasParserError(chapterDoc)) chapterDoc = parseXml(chapterMarkup, 'text/html');
    const body = getFirstByLocalName(chapterDoc, 'body') || chapterDoc.documentElement;
    const chapterText = extractReadableText(body);
    if (chapterText) chapters.push(`--- Chapter ${chapters.length + 1} ---\n${chapterText}`);
  }

  return buildAnalysis(chapters.join('\n\n'), {
    kind: 'epub',
    chapterCount: chapters.length,
    warnings: chapters.length > 0 ? [] : ['No readable EPUB chapters found.'],
  });
}

export async function analyzeSourceFile(file, cache = new Map()) {
  const signature = getFileSignature(file);
  if (!signature) throw new Error('Missing file');
  if (cache.has(signature)) return cache.get(signature);

  const analysisPromise = (async () => {
    const fileKind = getFileKind(file);
    if (fileKind === 'pdf') return extractPdf(file);
    if (fileKind === 'epub') return extractEpub(file);
    throw new Error('Unsupported file type');
  })();

  cache.set(signature, analysisPromise);
  try {
    const analysis = await analysisPromise;
    cache.set(signature, analysis);
    return analysis;
  } catch (err) {
    cache.delete(signature);
    throw err;
  }
}
