#!/usr/bin/env node
// Lightweight diagnostics for adaptive distillation output. These measures are
// signals for editorial review, not pass/fail targets.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/audit-adaptive-output.mjs <chapter.md> [...]');
  process.exit(1);
}

const words = text => (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
const nonNameStarts = new Set([
  'A', 'After', 'Although', 'An', 'As', 'At', 'Before', 'But', 'By', 'Chapter',
  'During', 'For', 'Givers', 'Giving', 'How', 'If', 'In', 'Matchers', 'One',
  'Otherish', 'Research', 'Selfless', 'Several', 'Still', 'Takers', 'The',
  'These', 'This', 'When', 'Yet',
]);

function nameLikePhrases(paragraph) {
  const matches = paragraph.match(/\b[\p{Lu}][\p{L}’'-]*\s+[\p{Lu}][\p{L}’'-]*(?:\s+[\p{Lu}][\p{L}’'-]*)?/gu) || [];
  return matches.filter(match => !nonNameStarts.has(match.split(/\s+/)[0]));
}

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const blocks = text.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  const quotes = blocks.filter(block => block.split('\n').every(line => /^>\s?/.test(line)));
  const prose = blocks.filter(block => !/^(#|>|<end_of_book>)/.test(block));
  const quoteWords = words(quotes.map(block => block.replace(/^>\s?/gm, '')).join('\n'));
  const totalWords = words(text.replace('<end_of_book>', ''));
  const nameLikeMentions = prose.flatMap(nameLikePhrases).length;
  const namedParagraphs = prose.filter(paragraph => nameLikePhrases(paragraph).length).length;
  console.log(JSON.stringify({
    file: path.basename(file),
    words: totalWords,
    excerpts: quotes.length,
    excerpt_words: quoteWords,
    excerpt_share: Number((quoteWords / Math.max(totalWords, 1)).toFixed(3)),
    prose_paragraphs: prose.length,
    name_like_paragraphs: namedParagraphs,
    name_like_share: Number((namedParagraphs / Math.max(prose.length, 1)).toFixed(3)),
    name_like_mentions: nameLikeMentions,
    name_like_mentions_per_1000_words: Number((1000 * nameLikeMentions / Math.max(totalWords, 1)).toFixed(1)),
  }));
}
