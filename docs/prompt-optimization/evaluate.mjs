#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const [sourcePath, summaryPath] = process.argv.slice(2);
if (!sourcePath || !summaryPath) {
  console.error('Usage: node docs/prompt-optimization/evaluate.mjs <source.txt> <summary.md>');
  process.exit(1);
}

const [source, summary] = await Promise.all([
  readFile(sourcePath, 'utf8'),
  readFile(summaryPath, 'utf8'),
]);

function words(text) {
  return text.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu) || [];
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const quoteGroups = [];
let current = [];
for (const line of summary.split(/\r?\n/)) {
  if (/^>/.test(line)) {
    current.push(line.replace(/^>\s?/, ''));
  } else if (current.length) {
    quoteGroups.push(normalize(current.join(' ')));
    current = [];
  }
}
if (current.length) quoteGroups.push(normalize(current.join(' ')));

const normalizedSource = normalize(source);
const sourceWords = words(source).length;
const summaryWords = words(summary.replace(/<end_of_book>/g, '')).length;
const excerptWords = quoteGroups.reduce((sum, quote) => sum + words(quote).length, 0);
const quoteChecks = quoteGroups.map((quote, index) => ({
  quote: index + 1,
  words: words(quote).length,
  exact_contiguous_match: normalizedSource.includes(quote),
  content_match_ignoring_added_outer_quotes: normalizedSource.includes(
    /^([“"])[\s\S]*([”"])$/.test(quote) ? quote.slice(1, -1) : quote,
  ),
}));
const endMarkers = summary.match(/<end_of_book>/g)?.length || 0;
const ratio = sourceWords ? summaryWords / sourceWords : 0;

console.log(JSON.stringify({
  source_words: sourceWords,
  summary_words: summaryWords,
  compression_percent: Number((ratio * 100).toFixed(1)),
  compression_pass_25_to_33: ratio >= 0.25 && ratio <= 0.33,
  excerpt_words: excerptWords,
  excerpt_percent_of_summary: summaryWords
    ? Number(((excerptWords / summaryWords) * 100).toFixed(1))
    : 0,
  quote_groups: quoteGroups.length,
  exact_quote_groups: quoteChecks.filter(item => item.exact_contiguous_match).length,
  content_matched_quote_groups: quoteChecks.filter(
    item => item.content_match_ignoring_added_outer_quotes,
  ).length,
  end_markers: endMarkers,
  boundary_pass: endMarkers === 1 && summary.trim().endsWith('<end_of_book>'),
  quote_checks: quoteChecks,
}, null, 2));
