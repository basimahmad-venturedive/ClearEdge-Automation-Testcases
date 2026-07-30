#!/usr/bin/env node
/**
 * Tag frontend (Playwright) specs for Regression / Smoke selection.
 *
 * Rules (mirrors api-ts/scripts/tag-suites.mjs):
 *   - Every RUNNING test (`test(…)`)              -> ` @regression`
 *   - The first ~20% running tests per spec       -> ` @smoke @regression`
 *   - `test.skip` / `test.fixme` (blocked/not-built) are left untouched (no tag).
 *
 * Playwright `--grep @regression|@smoke` matches the test TITLE and DESELECTS
 * non-matching tests (they are NOT reported as skipped) — so no drop-helper is
 * needed the way the vitest suite requires. Reporters strip ` @\S+` tokens before
 * reading the TC-id (reporters/cqmReporter.js), so title tags are safe.
 *
 * Handles both the single-line form  test('title', async …)  and the multi-line
 * form  test(\n  'title',\n  async …).  The tag is inserted at the end of the
 * title string. Smoke = first ceil(20%) running tests per spec (specs list the
 * core/happy-path first). Idempotent: strips existing tags first, then re-adds.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || ".";
const TESTS_DIR = path.join(ROOT, "tests");
const RATIO = 0.2;

// Start of a RUNNING test. `test(` (immediately, so test.skip(/test.fixme(/
// test.describe( are excluded — they have a `.`). Quote may be on this line or a later one.
const RUN_START = /^\s*test\(/;
const QUOTE = /["'`]/;

function stripTags(title) {
  return title.replace(/\s+@(?:smoke|regression)\b/g, "").replace(/\s+$/, "");
}

/** Locate the title string for a test() starting at line `start`: {line, quotePos, quote}. */
function findTitle(lines, start) {
  const afterHead = lines[start].replace(/^\s*test\(/, "");
  const headLen = lines[start].length - afterHead.length;
  const trimmed = afterHead.replace(/^\s*/, "");
  if (QUOTE.test(trimmed[0])) {
    const quotePos = headLen + (afterHead.length - trimmed.length);
    return { line: start, quotePos, quote: trimmed[0] };
  }
  // Multi-line: first following line whose first non-space char is a quote.
  for (let k = start + 1; k < Math.min(lines.length, start + 5); k++) {
    const t = lines[k].replace(/^\s*/, "");
    if (t.length === 0) continue;
    if (QUOTE.test(t[0])) return { line: k, quotePos: lines[k].length - t.length, quote: t[0] };
    return null; // first arg isn't a string literal — bail defensively
  }
  return null;
}

const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".spec.ts")).sort();
const summary = [];

for (const rel of files) {
  const abs = path.join(TESTS_DIR, rel);
  const src = readFileSync(abs, "utf-8");
  const lines = src.split(/\r?\n/);

  const starts = [];
  for (let i = 0; i < lines.length; i++) if (RUN_START.test(lines[i])) starts.push(i);
  const smokeCount = starts.length ? Math.max(1, Math.ceil(starts.length * RATIO)) : 0;
  const smokeStarts = new Set(starts.slice(0, smokeCount));

  let smoke = 0;
  for (const s of starts) {
    const loc = findTitle(lines, s);
    if (!loc) continue;
    const line = lines[loc.line];
    const open = loc.quotePos;
    let end = -1;
    for (let j = open + 1; j < line.length; j++) {
      const c = line[j];
      if (c === "\\") { j++; continue; }
      if (c === loc.quote) { end = j; break; }
    }
    if (end === -1) continue;
    let title = stripTags(line.slice(open + 1, end));
    if (smokeStarts.has(s)) { title += " @smoke @regression"; smoke++; } else { title += " @regression"; }
    lines[loc.line] = line.slice(0, open + 1) + title + line.slice(end);
  }

  const out = lines.join("\n");
  if (out !== src) writeFileSync(abs, out);
  summary.push({ spec: rel, running: starts.length, regression: starts.length, smoke });
}

console.table(summary);
const tot = summary.reduce((a, s) => ({ r: a.r + s.regression, s: a.s + s.smoke }), { r: 0, s: 0 });
console.log(`TOTAL running(@regression): ${tot.r}  smoke: ${tot.s}  (${tot.r ? ((tot.s / tot.r) * 100).toFixed(1) : 0}%)`);
