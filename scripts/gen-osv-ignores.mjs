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
//     arg2 = review-by date (YYYY-MM-DD) — the EARLIEST expiry; see staggering below
//
// The CSV must contain an advisory-id column (named cve / advisory / id) whose
// cells hold OSV ids (GHSA-*, CVE-*, PYSEC-*, possibly pipe-separated). A verdict
// column (verdict / verdict_vex / reach) is MANDATORY — without a per-row verdict
// we cannot tell "not affected" from "requires action".
//
// Expiry staggering: suppressions all expiring on the same day means one monthly
// run where the delta jumps from a handful of advisories to the entire baseline —
// and the review becomes untractable in exactly the month it matters. Expiries are
// spread by VEX justification, soonest for the justifications that rest on the
// weakest evidence (see JUSTIFICATION_OFFSET_MONTHS).

import { readFileSync } from 'node:fs';
import { parseCsv } from './lib/csv.mjs';

const [csvPath, reviewDate = '1970-01-01'] = process.argv.slice(2);
if (!csvPath) { console.error('usage: gen-osv-ignores.mjs <vulnerabilities.csv> <YYYY-MM-DD>'); process.exit(1); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
  console.error(`Refusing to run: "${reviewDate}" is not a YYYY-MM-DD review date.`);
  process.exit(1);
}

// Months added to the review date, per VEX justification. A claim that the
// component simply is not shipped is stable and cheap to re-check, so it can wait
// the longest; a claim about which code paths run, or about an attacker's control
// over an input, is the kind of judgment that decays as the code changes — those
// come back first. `mitigated` is a compensating control, not an absence of
// vulnerability: it expires first of all.
export const JUSTIFICATION_OFFSET_MONTHS = [
  [/\bmitigat/i, 0],
  [/cannot_be_controlled_by_adversary/i, 0],
  [/not_in_execute_path|code_not_present/i, 1],
  [/component_not_present|not[_ ]?applicable/i, 2],
];
const DEFAULT_OFFSET_MONTHS = 0; // unrecognized justification → review soonest

// Severity then shifts that offset. CRITICAL is pulled all the way forward
// regardless of how sound the reasoning looks; LOW and MODERATE are pushed back so
// the review load spreads instead of arriving as one 100-entry month. MAX_OFFSET
// keeps every suppression inside the quarterly re-review policy.
export const SEVERITY_SHIFT_MONTHS = { CRITICAL: -99, HIGH: 0, MODERATE: 1, LOW: 2 };
export const MAX_OFFSET_MONTHS = 3;

export function offsetMonthsFor(reason, severity = '') {
  const base = (JUSTIFICATION_OFFSET_MONTHS.find(([re]) => re.test(reason)) || [null, DEFAULT_OFFSET_MONTHS])[1];
  const shift = SEVERITY_SHIFT_MONTHS[String(severity).toUpperCase().trim()] ?? 0;
  return Math.max(0, Math.min(MAX_OFFSET_MONTHS, base + shift));
}

export function expiryFrom(reviewDate, reason, severity) {
  const [y, m, d] = reviewDate.split('-').map(Number);
  // Same day of (month + offset), clamped to that month's last day so the expiry
  // never rolls into the next month. UTC keeps it independent of the runner's timezone.
  const mo = m - 1 + offsetMonthsFor(reason, severity);
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(y, mo, Math.min(d, last)));
  return `${dt.toISOString().slice(0, 10)}T00:00:00Z`;
}

const rows = parseCsv(readFileSync(csvPath, 'utf8').trim());
const header = (rows.shift() || []).map((h) => h.trim().toLowerCase());
const idCol = header.findIndex((h) => ['cve', 'advisory', 'id', 'advisory_id'].includes(h));
const verdictCol = header.findIndex((h) => ['verdict', 'verdict_vex', 'reach'].includes(h));
// The reason must be a real VEX justification — NEVER the advisory title/summary
// (that would write the vulnerability's description as if it were our rationale).
const reasonCol = header.findIndex((h) => ['basis', 'verdict_vex', 'reason', 'justification'].includes(h));
const sevCol = header.findIndex((h) => ['severity', 'sev'].includes(h));
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
const SUPPRESSIBLE = new Set(['not_affected', 'mitigated', 'not_applicable']);
const isNotAffected = (v) => SUPPRESSIBLE.has(String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_'));
// An advisory triaged `affected` ANYWHERE must never be suppressed, even if
// another row (another package, or a duplicate) marks the same id not-affected.
// The unsafe direction is suppressing something actionable, so `affected` wins.
const actionableIds = new Set();
const ids = (r) => String(r[idCol] || '').split('|').map((s) => s.trim()).filter((s) => /^(GHSA|CVE|PYSEC)-/i.test(s));
for (const r of rows) {
  if (isNotAffected(r[verdictCol] || '')) continue;
  for (const id of ids(r)) actionableIds.add(id);
}

const seen = new Set();
let emitted = 0, held = 0;

for (const r of rows) {
  const verdict = r[verdictCol] || '';
  if (!isNotAffected(verdict)) continue; // keep actionable / ambiguous ones visible
  const reason = (reasonCol >= 0 ? r[reasonCol] : verdict) || 'triaged not-affected';
  for (const id of ids(r)) {
    if (seen.has(id)) continue;
    if (actionableIds.has(id)) { held++; console.error(`Held back ${id}: another row triages it as requiring action.`); continue; }
    seen.add(id);
    const cleanReason = reason.replace(/\s+/g, ' ').trim().slice(0, 160);
    console.log(`\n[[IgnoredVulns]]`);
    console.log(`id = ${JSON.stringify(id)}`);
    console.log(`ignoreUntil = ${JSON.stringify(expiryFrom(reviewDate, reason, sevCol >= 0 ? r[sevCol] : ''))}`);
    console.log(`reason = ${JSON.stringify('VEX not_affected: ' + cleanReason)}`);
    emitted++;
  }
}
console.error(`Emitted ${emitted} ignore entries from ${rows.length} rows`
  + (held ? `; held back ${held} id(s) triaged as requiring action.` : '.'));
