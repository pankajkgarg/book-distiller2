#!/usr/bin/env node
// Package a book-distill Markdown deliverable as a dependency-free EPUB 3 book.
// Usage: node scripts/markdown-to-epub.mjs --input <book.md> --output <book.epub>
//        [--cover <image>] [--title <title>] [--author <author>]
//        [--language <BCP-47 tag>]

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = name => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};

const inputArg = flag('--input');
const outputArg = flag('--output');
if (!inputArg || !outputArg) {
  console.error('Required: --input <book.md> --output <book.epub>');
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
if (inputPath === outputPath) {
  console.error('Input and output paths must be different.');
  process.exit(1);
}

const inputInfo = await stat(inputPath).catch(() => null);
if (!inputInfo?.isFile()) {
  console.error(`Markdown input is not a file: ${inputPath}`);
  process.exit(1);
}
if (!outputPath.toLowerCase().endsWith('.epub')) {
  console.error('Output filename must end in .epub.');
  process.exit(1);
}

const source = cleanXml(await readFile(inputPath, 'utf8'));
const sourceTitle = source.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(inputPath, '.md');
const parsed = parseTitle(sourceTitle);
const title = flag('--title') || parsed.title;
const author = flag('--author') || parsed.author || 'Unknown author';
const language = flag('--language') || 'en';
const cover = await resolveCover(flag('--cover'));
const editionTitle = `${title} (Distilled Edition)`;
const identifier = stableUuid(`${title}\n${author}\n${source}`);
const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const chapters = splitChapters(source);

if (!chapters.length) {
  console.error('No "## Chapter …" headings found in the Markdown input.');
  process.exit(1);
}

await mkdir(dirname(outputPath), { recursive: true });
const staging = await mkdtemp(`${tmpdir()}/book-distill-epub-`);

try {
  await mkdir(`${staging}/META-INF`, { recursive: true });
  await mkdir(`${staging}/OEBPS/text`, { recursive: true });
  await mkdir(`${staging}/OEBPS/styles`, { recursive: true });
  await mkdir(`${staging}/OEBPS/images`, { recursive: true });

  await writeFile(`${staging}/mimetype`, 'application/epub+zip');
  await writeFile(`${staging}/META-INF/container.xml`, containerXml());
  await writeFile(`${staging}/OEBPS/styles/book.css`, bookCss());
  if (cover.sourcePath) {
    await copyFile(cover.sourcePath, `${staging}/OEBPS/images/${cover.filename}`);
  } else {
    await writeFile(`${staging}/OEBPS/images/${cover.filename}`, coverSvg(title, author));
  }
  await writeFile(
    `${staging}/OEBPS/text/cover.xhtml`,
    coverPageXhtml(editionTitle, cover.filename, language),
  );
  await writeFile(
    `${staging}/OEBPS/text/title.xhtml`,
    titlePageXhtml(editionTitle, author, language),
  );

  for (const chapter of chapters) {
    await writeFile(
      `${staging}/OEBPS/text/${chapter.filename}`,
      chapterXhtml(chapter, language),
    );
  }

  await writeFile(`${staging}/OEBPS/nav.xhtml`, navXhtml(editionTitle, chapters, language));
  await writeFile(`${staging}/OEBPS/toc.ncx`, tocNcx(identifier, editionTitle, chapters));
  await writeFile(
    `${staging}/OEBPS/content.opf`,
    contentOpf({ identifier, editionTitle, author, language, modified, chapters, cover }),
  );

  const oldOutput = await stat(outputPath).catch(() => null);
  if (oldOutput && !oldOutput.isFile()) {
    throw new Error(`Output path exists and is not a file: ${outputPath}`);
  }
  if (oldOutput) await unlink(outputPath);

  // EPUB requires mimetype to be the first ZIP entry and stored without compression.
  await run('zip', ['-X0', outputPath, 'mimetype'], { cwd: staging });
  await run('zip', ['-Xr9D', outputPath, 'META-INF', 'OEBPS'], { cwd: staging });
  await access(outputPath);

  const words = (source.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu) || []).length;
  console.log(`wrote ${outputPath} (${chapters.length} chapters, ${words.toLocaleString()} words)`);
} finally {
  // staging was created by this process under the system temporary directory.
  await rm(staging, { recursive: true, force: false }).catch(() => {});
}

function cleanXml(value) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function escapeXml(value) {
  return cleanXml(String(value))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function parseTitle(value) {
  const split = value.match(/^(.*?)\s+[—–]\s+([^—–]+)$/);
  return split ? { title: split[1].trim(), author: split[2].trim() } : { title: value.trim() };
}

function stableUuid(value) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function resolveCover(value) {
  if (!value) return { filename: 'cover.svg', mediaType: 'image/svg+xml', sourcePath: null };
  const sourcePath = resolve(value);
  const info = await stat(sourcePath).catch(() => null);
  if (!info?.isFile()) {
    console.error(`Cover image is not a file: ${sourcePath}`);
    process.exit(1);
  }
  const extension = extname(sourcePath).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  if (!types[extension]) {
    console.error('Cover image must be JPEG, PNG, or SVG.');
    process.exit(1);
  }
  return {
    filename: `cover${extension === '.jpeg' ? '.jpg' : extension}`,
    mediaType: types[extension],
    sourcePath,
  };
}

function splitChapters(markdown) {
  const lines = markdown.replace(/<end_of_book>\s*$/m, '').split('\n');
  const result = [];
  let current = null;
  for (const line of lines) {
    const chapter = line.match(/^##\s+(Chapter\s+\d+[^\n]*)$/i);
    if (chapter) {
      if (current) result.push(current);
      current = { title: chapter[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) result.push(current);
  return result.map((chapter, index) => ({
    ...chapter,
    id: `chapter-${index + 1}`,
    filename: `chapter-${String(index + 1).padStart(2, '0')}.xhtml`,
  }));
}

function inlineMarkdown(value) {
  const tokens = [];
  let escaped = escapeXml(value);
  escaped = escaped.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0001${tokens.length}\u0002`;
    tokens.push(`<code>${code}</code>`);
    return token;
  });
  escaped = escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
  return escaped.replace(/\u0001(\d+)\u0002/g, (_, index) => tokens[Number(index)]);
}

function markdownBody(lines) {
  const output = [];
  let paragraph = [];
  let quote = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) {
      const quoteParagraphs = quote.join('\n').split(/\n\s*\n/);
      output.push(`<blockquote>${quoteParagraphs.map(text => `<p>${inlineMarkdown(text.replace(/\n/g, ' '))}</p>`).join('')}</blockquote>`);
    }
    quote = [];
  };
  const flushList = () => {
    if (listItems.length) {
      output.push(`<${listType}>${listItems.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${listType}>`);
    }
    listType = null;
    listItems = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ''));
      continue;
    }
    flushQuote();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      output.push('<hr/>');
      continue;
    }
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length, 3);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered || ordered)[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushAll();
  return output.join('\n');
}

function xhtmlDocument(title, body, language) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>${body}</body>
</html>\n`;
}

function titlePageXhtml(title, author, language) {
  const body = `<section class="title-page" epub:type="titlepage" xmlns:epub="http://www.idpf.org/2007/ops">
  <h1>${escapeXml(title)}</h1>
  <p class="author">${escapeXml(author)}</p>
  <p class="edition">Personal distilled edition</p>
  <p class="note">Generated from a user-provided source; not an official edition.</p>
</section>`;
  return xhtmlDocument(title, body, language);
}

function coverPageXhtml(title, coverFilename, language) {
  const body = `<section class="cover-page" epub:type="cover" xmlns:epub="http://www.idpf.org/2007/ops">
  <img src="../images/${escapeXml(coverFilename)}" alt="Cover of ${escapeXml(title)}"/>
</section>`;
  return xhtmlDocument(`Cover — ${title}`, body, language);
}

function chapterXhtml(chapter, language) {
  const body = `<section id="${chapter.id}" epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
  <h1>${inlineMarkdown(chapter.title)}</h1>
  ${markdownBody(chapter.lines)}
</section>`;
  return xhtmlDocument(chapter.title, body, language);
}

function navXhtml(title, chapters, language) {
  const items = chapters.map(chapter =>
    `      <li><a href="text/${chapter.filename}">${escapeXml(chapter.title)}</a></li>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head><meta charset="UTF-8"/><title>Contents — ${escapeXml(title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>\n`;
}

function tocNcx(identifier, title, chapters) {
  const points = chapters.map((chapter, index) => `
    <navPoint id="navPoint-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="text/${chapter.filename}"/>
    </navPoint>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${identifier}"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>${points}
  </navMap>
</ncx>\n`;
}

function contentOpf({ identifier, editionTitle, author, language, modified, chapters, cover }) {
  const chapterManifest = chapters.map((chapter, index) =>
    `    <item id="chapter-${index + 1}" href="text/${chapter.filename}" media-type="application/xhtml+xml"/>`,
  ).join('\n');
  const spine = chapters.map((_, index) => `    <itemref idref="chapter-${index + 1}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${identifier}</dc:identifier>
    <dc:title>${escapeXml(editionTitle)}</dc:title>
    <dc:creator id="creator">${escapeXml(author)}</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:description>Personal distilled edition generated from a user-provided source.</dc:description>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="styles/book.css" media-type="text/css"/>
    <item id="cover" href="images/${escapeXml(cover.filename)}" media-type="${cover.mediaType}" properties="cover-image"/>
    <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="title-page" href="text/title.xhtml" media-type="application/xhtml+xml"/>
${chapterManifest}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover-page" linear="no"/>
    <itemref idref="title-page"/>
${spine}
  </spine>
</package>\n`;
}

function containerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>\n`;
}

function coverSvg(title, author) {
  const words = title.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 22 && current) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  const startY = 500 - (lines.length - 1) * 45;
  const titleLines = lines.map((line, index) =>
    `<text x="600" y="${startY + index * 90}" text-anchor="middle" class="title">${escapeXml(line)}</text>`,
  ).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800" role="img" aria-labelledby="cover-title cover-desc">
  <title id="cover-title">${escapeXml(title)} — distilled edition</title>
  <desc id="cover-desc">Typographic cover for a personal distilled edition by ${escapeXml(author)}</desc>
  <rect width="1200" height="1800" fill="#17243f"/>
  <rect x="82" y="82" width="1036" height="1636" rx="14" fill="none" stroke="#d9b875" stroke-width="4"/>
  <text x="600" y="250" text-anchor="middle" class="kicker">DISTILLED EDITION</text>
  ${titleLines}
  <line x1="380" y1="1120" x2="820" y2="1120" stroke="#d9b875" stroke-width="3"/>
  <text x="600" y="1235" text-anchor="middle" class="author">${escapeXml(author)}</text>
  <style>
    .kicker { fill:#d9b875; font:600 34px sans-serif; letter-spacing:8px; }
    .title { fill:#f8f3e7; font:700 68px serif; }
    .author { fill:#d9b875; font:42px serif; }
  </style>
</svg>\n`;
}

function bookCss() {
  return `@charset "UTF-8";
body {
  color: #191919;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.55;
  margin: 5%;
  orphans: 2;
  widows: 2;
}
h1, h2, h3 { line-height: 1.2; page-break-after: avoid; }
h1 { font-size: 1.7em; margin: 0 0 1.4em; }
h2 { font-size: 1.3em; margin: 2.2em 0 .7em; }
h3 { font-size: 1.08em; margin: 1.7em 0 .5em; }
p { margin: 0 0 .9em; }
blockquote {
  border-left: .18em solid #9b7a3f;
  font-style: italic;
  margin: 1.2em 0;
  padding: .15em 0 .15em 1em;
}
blockquote p { margin: .35em 0; }
hr { border: 0; border-top: 1px solid #aaa; margin: 2em 30%; }
ol, ul { margin: .8em 0 1em 1.4em; padding: 0; }
li { margin: .3em 0; }
.title-page { margin-top: 25%; text-align: center; }
.title-page h1 { font-size: 2em; margin-bottom: 1em; }
.title-page .author { font-size: 1.25em; }
.title-page .edition { font-variant: small-caps; letter-spacing: .08em; margin-top: 3em; }
.title-page .note { color: #666; font-size: .8em; margin: 4em auto 0; max-width: 28em; }
.cover-page { margin: 0; padding: 0; text-align: center; }
.cover-page img { height: auto; max-height: 100%; max-width: 100%; }
`;
}
