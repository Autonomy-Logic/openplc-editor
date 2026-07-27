#!/usr/bin/env node
// Generate osv-scanner.toml [[IgnoredVulns]] entries from a triaged
// vulnerabilities.csv. Rows classified "not affected" / "mitigated" (our VEX
// baseline) become suppressions so the monthly scan only surfaces NEW findings.
// Rows that require action (APLICA / affected) are intentionally NOT suppressed
// — they keep alerting until the dependency is bumped.
//
// Usage:
//   node scripts/gen-osv-ignores.mjs sbom/vulnerabilities.csv 2026-10-01 >> osv-scanner.toml
//     arg1 = CSV path
//     arg2 = review-by date (YYYY-MM-DD) written as ignoreUntil
//
// The CSV must contain an advisory-id column (named cve / advisory / id) whose
// cells hold OSV ids (GHSA-*, CVE-*, PYSEC-*, possibly pipe-separated). If a
// verdict column is present (verdict / verdict_vex / reach), only not-affected
// rows are suppressed; otherwise every listed id is suppressed (review!).

import { readFileSync } from 'node:fs';

const [csvPath, reviewDate = '1970-01-01'] = process.argv.slice(2);
if (!csvPath) { console.error('usage: gen-osv-ignores.mjs <vulnerabilities.csv> <YYYY-MM-DD>'); process.exit(1); }

const rows = readFileSync(csvPath, 'utf8').trim().split('\n').map(parseCsvLine);
const header = rows.shift().map((h) => h.toLowerCase());
const idCol = header.findIndex((h) => ['cve', 'advisory', 'id', 'advisory_id'].includes(h));
const verdictCol = header.findIndex((h) => ['verdict', 'verdict_vex'].includes(h));
const reasonCol = header.findIndex((h) => ['description', 'title', 'basis', 'verdict_vex', 'verdict'].includes(h));
if (idCol < 0) { console.error('No advisory-id column (cve/advisory/id) found'); process.exit(1); }

const isNotAffected = (v) => /not[_ ]?affected|mitig|\bn\/?a\b/i.test(v || '');
const seen = new Set();
let emitted = 0;

for (const r of rows) {
  const verdict = verdictCol >= 0 ? r[verdictCol] : '';
  if (verdictCol >= 0 && !isNotAffected(verdict)) continue; // keep actionable ones visible
  const ids = String(r[idCol] || '').split('|').map((s) => s.trim()).filter((s) => /^(GHSA|CVE|PYSEC)-/i.test(s));
  const reason = (reasonCol >= 0 ? r[reasonCol] : verdict) || 'triaged not-affected';
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    console.log(`\n[[IgnoredVulns]]`);
    console.log(`id = "${id}"`);
    console.log(`ignoreUntil = "${reviewDate}T00:00:00Z"`);
    console.log(`reason = ${JSON.stringify('VEX not_affected: ' + reason.replace(/\s+/g, ' ').slice(0, 160))}`);
    emitted++;
  }
}
console.error(`Emitted ${emitted} ignore entries from ${rows.length} rows.`);

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur); return out;
}
