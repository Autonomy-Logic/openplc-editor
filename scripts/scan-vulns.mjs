#!/usr/bin/env node
// Flatten osv-scanner JSON into vulnerabilities.csv, one row per advisory index
// entry (lib/severity.mjs), so the row count equals the report's register count.
//   node scripts/scan-vulns.mjs <osv-results.json> <out.csv>

import { readFileSync, writeFileSync } from 'node:fs';
import { indexAdvisories, bySeverity } from './lib/severity.mjs';

const [src, out = 'sbom/vulnerabilities.csv'] = process.argv.slice(2);
// Fail closed: a missing or shapeless scan must never become an empty register.
let data;
try {
  data = JSON.parse(readFileSync(src, 'utf8'));
} catch (e) {
  console.error(`scan-vulns: cannot read/parse "${src}" — the scanner failed (${e.code || e.message}). Refusing to write an empty register.`);
  process.exit(1);
}
if (!data || !Array.isArray(data.results)) {
  console.error(`scan-vulns: "${src}" has no "results" array — the scanner failed. Refusing to write an empty register.`);
  process.exit(1);
}

// Third-party text: collapse whitespace so one row is always one physical line.
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => { s = oneLine(s); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// advisory: the group's OSV record ids, representative first, ' | ' separated.
const rows = [['severity', 'package', 'version', 'advisory', 'fixed_in', 'summary', 'url', 'aliases']];
for (const a of [...indexAdvisories(data).values()].sort(bySeverity)) {
  const ids = [a.id, ...a.ids.filter((x) => x !== a.id)];
  rows.push([a.sev, a.pkg, a.ver, ids.join(' | '), a.fixedVersions.join(' | '),
    a.summary, `https://osv.dev/${a.id}`, a.aliases.filter((x) => !a.ids.includes(x)).join(' | ')]);
}
writeFileSync(out, rows.map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`Wrote ${out}: ${rows.length - 1} advisories (post-suppression delta).`);
