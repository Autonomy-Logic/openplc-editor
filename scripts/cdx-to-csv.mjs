#!/usr/bin/env node
// cdx-to-csv.mjs — flatten a CycloneDX BOM into a human-readable components CSV.
//   node scripts/cdx-to-csv.mjs <cdx.json> <out.csv>
// (Extracted from an inline `node -e` block in generate-sbom.sh so it gets
// syntax highlighting, lint coverage, and is testable like the sibling scripts.)
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: cdx-to-csv.mjs <cdx.json> <out.csv>'); process.exit(1); }

const bom = JSON.parse(readFileSync(src, 'utf8'));
const esc = (s) => { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const rows = [['name', 'version', 'type', 'purl', 'license']];
for (const c of (bom.components || [])) {
  const lic = (c.licenses || []).map((l) => l.license?.id || l.expression || l.license?.name || '').join(' / ');
  rows.push([(c.group ? `${c.group}/` : '') + c.name, c.version || '', c.type || '', c.purl || '', lic]);
}
writeFileSync(out, rows.map((r) => r.map(esc).join(',')).join('\n'));
console.log(`Wrote ${out}: ${rows.length - 1} components`);
