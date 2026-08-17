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
const verdictCol = header.findIndex((h) => ['verdict', 'verdict_vex', 'reach'].includes(h));
// The reason must be a real VEX justification — NEVER the advisory title/summary
// (that would write the vulnerability's description as if it were our rationale).
const reasonCol = header.findIndex((h) => ['basis', 'verdict_vex', 'reason', 'justification'].includes(h));
if (idCol < 0) { console.error('No advisory-id column (cve/advisory/id) found'); process.exit(1); }
// A verdict column is MANDATORY. Without it we cannot tell "not affected" from
// "requires action", and suppressing every row would blind the scanner. Refuse.
if (verdictCol < 0) {
  console.error('Refusing to run: the CSV has no verdict column (verdict/verdict_vex/reach).\n'
    + 'Without a per-row verdict, this would suppress the ENTIRE scan. Add a verdict column\n'
    + 'carrying the CISA VEX status (e.g. "not_affected", "mitigated", or "affected").');
  process.exit(1);
}

// Only these explicit statuses are suppressed. "affected"/"requires action" rows
// (and anything ambiguous) are kept VISIBLE so they keep alerting.
const isNotAffected = (v) => /\bnot[_ ]?affected\b|\bmitigat|\bnot[_ ]?applicable\b/i.test(v || '');
const seen = new Set();
let emitted = 0;

for (const r of rows) {
  const verdict = r[verdictCol] || '';
  if (!isNotAffected(verdict)) continue; // keep actionable / ambiguous ones visible
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
