#!/usr/bin/env node
// Validator + compiler for the CISSP question bank.
// Reads content/domain-N.json, validates every item, writes data/domain-N.json
// and data/manifest.json. On any hard error: print all errors, exit 1, emit nothing.
// Uses node: builtins only — zero dependencies is a project requirement.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Single source of truth. ISC2 CISSP exam outline effective 15 April 2024.
// Domain 8 is 10% — 11% is the pre-2024 figure and makes the weights sum to 101.
const DOMAINS = [
  { n: 1, name: 'Security and Risk Management',            weight: 16, target: 800 },
  { n: 2, name: 'Asset Security',                          weight: 10, target: 500 },
  { n: 3, name: 'Security Architecture and Engineering',   weight: 13, target: 650 },
  { n: 4, name: 'Communication and Network Security',      weight: 13, target: 650 },
  { n: 5, name: 'Identity and Access Management',          weight: 13, target: 650 },
  { n: 6, name: 'Security Assessment and Testing',         weight: 12, target: 600 },
  { n: 7, name: 'Security Operations',                     weight: 13, target: 650 },
  { n: 8, name: 'Software Development Security',           weight: 10, target: 500 },
];

const weightSum = DOMAINS.reduce((s, d) => s + d.weight, 0);
const targetSum = DOMAINS.reduce((s, d) => s + d.target, 0);
if (weightSum !== 100) {
  console.error(`FATAL: domain weights sum to ${weightSum}, expected 100.`);
  process.exit(1);
}
if (targetSum !== 5000) {
  console.error(`FATAL: domain targets sum to ${targetSum}, expected 5000.`);
  process.exit(1);
}

const ID_RE = /^D([1-8])-(\d{4})$/;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const BANNED_OPTION_RE = /^(all|none) of the above/i;
const ALLOWED_KEYS = new Set([
  'id', 'domain', 'objective', 'difficulty', 'stem',
  'options', 'answer', 'explanations', 'reference',
]);

const errors = [];
const warnings = [];
const seenIds = new Map(); // id -> file it first appeared in
const answerSpread = [0, 0, 0, 0]; // authored answer positions, info only
const compiled = new Map(); // domain n -> runtime items

for (const dom of DOMAINS) {
  const file = `content/domain-${dom.n}.json`;
  const path = join(ROOT, file);

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    errors.push(`${file}: missing or unreadable.`);
    continue;
  }

  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`);
    continue;
  }
  if (!Array.isArray(items)) {
    errors.push(`${file}: root must be a JSON array.`);
    continue;
  }

  const out = [];
  items.forEach((q, i) => {
    const where = `${file}[${i}]${q && typeof q.id === 'string' ? ` (${q.id})` : ''}`;
    const err = (msg) => errors.push(`${where}: ${msg}`);

    if (q === null || typeof q !== 'object' || Array.isArray(q)) {
      err('item must be an object.');
      return;
    }

    for (const key of Object.keys(q)) {
      if (!ALLOWED_KEYS.has(key)) err(`unknown key "${key}".`);
    }

    // id + domain
    const m = typeof q.id === 'string' ? q.id.match(ID_RE) : null;
    if (!m) {
      err(`id ${JSON.stringify(q.id)} does not match ^D[1-8]-\\d{4}$.`);
    } else {
      if (Number(m[1]) !== q.domain) err(`id digit ${m[1]} does not equal domain ${q.domain}.`);
      if (seenIds.has(q.id)) err(`duplicate id — first seen in ${seenIds.get(q.id)}.`);
      else seenIds.set(q.id, file);
    }
    if (!Number.isInteger(q.domain) || q.domain !== dom.n) {
      err(`domain ${JSON.stringify(q.domain)} does not match file domain ${dom.n}.`);
    }

    // objective
    if (typeof q.objective !== 'string' || !/^[1-8](\.\d+)?$/.test(q.objective)) {
      err(`objective ${JSON.stringify(q.objective)} is not a valid objective string.`);
    } else if (Number(q.objective.split('.')[0]) !== dom.n) {
      err(`objective ${q.objective} does not start with domain number ${dom.n}.`);
    }

    if (!DIFFICULTIES.has(q.difficulty)) {
      err(`difficulty ${JSON.stringify(q.difficulty)} is not easy|medium|hard.`);
    }

    // stem
    if (typeof q.stem !== 'string' || q.stem.trim().length < 30) {
      err('stem must be a string of at least 30 characters.');
    }

    // options
    if (!Array.isArray(q.options) || q.options.length !== 4
        || !q.options.every((o) => typeof o === 'string' && o.trim().length > 0)) {
      err('options must be exactly four non-empty strings.');
    } else {
      const norm = q.options.map((o) => o.trim().toLowerCase());
      if (new Set(norm).size !== 4) err('options are not distinct.');
      q.options.forEach((o, oi) => {
        if (BANNED_OPTION_RE.test(o.trim())) {
          err(`option ${oi} is an "all/none of the above" option.`);
        }
      });
    }

    // answer
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) {
      err(`answer ${JSON.stringify(q.answer)} is outside 0-3.`);
    }

    // explanations
    if (!Array.isArray(q.explanations) || q.explanations.length !== 4
        || !q.explanations.every((e) => typeof e === 'string')) {
      err('explanations must be exactly four strings.');
    } else {
      q.explanations.forEach((e, ei) => {
        if (e.trim().length < 20) err(`explanation ${ei} is under 20 characters.`);
      });
    }

    // reference
    if (q.reference !== undefined
        && (typeof q.reference !== 'string' || q.reference.trim().length === 0)) {
      err('reference, when present, must be a non-empty string.');
    }

    if (errors.length > 0 && errors[errors.length - 1].startsWith(where)) return;

    // Warnings + info (valid items only)
    const correct = q.options[q.answer];
    const longestDistractor = Math.max(
      ...q.options.filter((_, oi) => oi !== q.answer).map((o) => o.length),
    );
    if (correct.length > 1.6 * longestDistractor) {
      warnings.push(`${where}: correct option is ${(correct.length / longestDistractor).toFixed(2)}x the longest distractor (length tell).`);
    }
    answerSpread[q.answer] += 1;

    // Runtime form. The answer key travels sealed in a base64 blob — friction,
    // not security; the runtime only decodes it at grade/reveal time.
    const explanations = q.explanations.map((e, ei) => (
      ei === q.answer ? e.replace(/^Correct\.\s*/, '') : e
    ));
    out.push({
      id: q.id,
      d: q.domain,
      o: q.objective,
      x: q.difficulty,
      q: q.stem,
      c: q.options,
      k: Buffer.from(JSON.stringify({
        a: q.answer,
        e: explanations,
        r: q.reference ?? null,
      }), 'utf8').toString('base64'),
    });
  });

  compiled.set(dom.n, out);
}

if (errors.length > 0) {
  console.error(`BUILD FAILED — ${errors.length} error(s), nothing emitted:\n`);
  for (const e of errors) console.error(`  ERROR ${e}`);
  process.exit(1);
}

for (const w of warnings) console.warn(`  WARN ${w}`);

const dataDir = join(ROOT, 'data');
mkdirSync(dataDir, { recursive: true });

let total = 0;
const manifestDomains = DOMAINS.map((dom) => {
  const items = compiled.get(dom.n);
  total += items.length;
  const file = `domain-${dom.n}.json`;
  writeFileSync(join(dataDir, file), JSON.stringify(items) + '\n');
  return { n: dom.n, name: dom.name, weight: dom.weight, target: dom.target, count: items.length, file };
});

writeFileSync(join(dataDir, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  total,
  domains: manifestDomains,
}, null, 2) + '\n');

const spreadTotal = answerSpread.reduce((s, n) => s + n, 0) || 1;
const spread = answerSpread
  .map((n, i) => `${'ABCD'[i]}=${n} (${Math.round((100 * n) / spreadTotal)}%)`)
  .join('  ');
console.log(`Authored answer-position spread (info only; runtime shuffles): ${spread}`);
console.log(`BUILD OK — ${total} question(s) across ${DOMAINS.length} domains, ${warnings.length} warning(s).`);
for (const d of manifestDomains) {
  console.log(`  D${d.n} ${String(d.count).padStart(4)} / ${d.target}  ${d.name}`);
}
