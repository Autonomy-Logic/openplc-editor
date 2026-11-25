#!/usr/bin/env node
// Compares the [[IgnoredVulns]] ids of two osv-scanner.toml files. Fails when an
// id was removed or when more than <max> ids were added.
// Usage: check-suppressions.mjs <before.toml> <after.toml> <max>
import { readFileSync, existsSync } from 'node:fs';

export function ignoredIds(toml) {
  const ids = [];
  let inBlock = false;
  for (const raw of String(toml).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (/^\[\[\s*IgnoredVulns\s*\]\]$/.test(line)) { inBlock = true; continue; }
    if (/^\[/.test(line)) { inBlock = false; continue; }
    const m = inBlock && line.match(/^id\s*=\s*["']([^"']+)["']$/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

export function compare(beforeIds, afterIds, max) {
  const before = new Set(beforeIds), after = new Set(afterIds);
  const removed = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));
  const errors = [];
  if (removed.length) errors.push(`the triage step REMOVED ${removed.length} suppression(s): ${removed.join(', ')}`);
  if (added.length > max) errors.push(`the triage step added ${added.length} suppressions (max ${max} per run)`);
  return { removed, added, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [beforeP, afterP, maxArg] = process.argv.slice(2);
  const max = Number(maxArg);
  if (!afterP || !Number.isInteger(max) || max < 0) { console.error('usage: check-suppressions.mjs <before.toml> <after.toml> <max>'); process.exit(2); }
  const read = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8') : '');
  const r = compare(ignoredIds(read(beforeP)), ignoredIds(read(afterP)), max);
  console.log(`Suppressions: ${r.added.length} added, ${r.removed.length} removed`);
  for (const e of r.errors) console.log(`::error::${e}`);
  process.exit(r.errors.length ? 1 : 0);
}
