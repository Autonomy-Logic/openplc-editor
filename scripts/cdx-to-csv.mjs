#!/usr/bin/env node
// cdx-to-csv.mjs — flatten a CycloneDX BOM into a human-readable components CSV.
//   node scripts/cdx-to-csv.mjs <cdx.json> <out.csv>
// (Extracted from an inline `node -e` block in generate-sbom.sh so it gets
// syntax highlighting, lint coverage, and is testable like the sibling scripts.)
import { readFileSync, writeFileSync } from 'node:fs';
// Shared with cdx-to-spdx and build-report so this CSV's row count, the SPDX
// package count and the report's "Components inventoried" are the same number —
// all three ship in the same folder and get compared against each other.
import { collectComponents, licenseIdsOf } from './lib/cdx.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: cdx-to-csv.mjs <cdx.json> <out.csv>'); process.exit(1); }

const bom = JSON.parse(readFileSync(src, 'utf8'));
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => { s = oneLine(s); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const rows = [['name', 'version', 'type', 'purl', 'license']];
for (const c of collectComponents(bom)) {
  rows.push([(c.group ? `${c.group}/` : '') + c.name, c.version || '', c.type || '', c.purl || '', licenseIdsOf(c).join(' / ')]);
}
// Trailing newline: POSIX text-file convention, and without it `wc -l` under-counts
// the file by one, which silently skews any consumer that sizes the inventory that way.
writeFileSync(out, rows.map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`Wrote ${out}: ${rows.length - 1} components`);
