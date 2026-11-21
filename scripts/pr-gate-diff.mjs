#!/usr/bin/env node
// PR security gate decision.
//   node scripts/pr-gate-diff.mjs <base-osv.json> <head-osv.json> [threshold]
// Inputs: osv-scanner JSON with the VEX baseline. Exit 1 = an advisory the PR
// introduces (in head, no alias in base) is at or above threshold.

// Exit 0 = pass, 2 = unusable input or threshold (fail closed). Writes the PR
// comment to $GATE_COMMENT_FILE and block|warn|clean to $GATE_STATUS_FILE.
// UNKNOWN severity never blocks; it is listed.

import { readFileSync, writeFileSync } from 'node:fs';
import { ORDER, UNKNOWN, rank, normWord, indexAdvisories, introducedAdvisories, bySeverity } from './lib/severity.mjs';

// Markdown table cell: a literal '|' or newline would split the row.
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const [baseP, headP, thresholdArg] = process.argv.slice(2);
const THRESHOLD = normWord((thresholdArg || 'HIGH').toUpperCase());
const COMMENT_FILE = process.env.GATE_COMMENT_FILE || '/tmp/gate-comment.md';
const STATUS_FILE = process.env.GATE_STATUS_FILE || '/tmp/gate-status';
const MARKER = '<!-- security-pr-gate -->';
if (!ORDER.includes(THRESHOLD)) {
  console.error(`SECURITY GATE ERROR: threshold "${THRESHOLD}" is not one of ${ORDER.join(', ')}.`);
  process.exit(2);
}

// --- fail-closed input loading ------------------------------------------------
// Missing / unparseable / shapeless input means the scan did NOT run correctly.
// We must NOT return an empty index (that would pass the gate blindly). Exit 2.
function load(p, label) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); }
  catch (e) { fatal(`${label} scan output "${p}" is missing — the scanner did not produce it (${e.code || e.message}).`); }
  let data;
  try { data = JSON.parse(raw); }
  catch { fatal(`${label} scan output "${p}" is not valid JSON — the scanner failed.`); }
  if (!data || !Array.isArray(data.results)) {
    fatal(`${label} scan output "${p}" has no "results" array — the scanner failed or did not scan.`);
  }
  return data;
}
function fatal(msg) {
  console.error(`\n🛑 SECURITY GATE ERROR: ${msg}\nThe gate fails closed (cannot verify the PR). Re-run the job; if it persists, the scanner is broken.`);
  process.exit(2);
}

const base = load(baseP, 'BASE');
const head = load(headP, 'HEAD');
const baseIdx = indexAdvisories(base);
const headIdx = indexAdvisories(head);
const min = rank(THRESHOLD);

const introduced = introducedAdvisories(baseIdx, headIdx).sort(bySeverity);
const blocking = introduced.filter((a) => rank(a.sev) >= min);
const hasUnknown = introduced.some((a) => a.sev === UNKNOWN);

// The policy sentence is built from THRESHOLD so it always states the rule applied.
const listWords = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
const blockingLevels = ORDER.slice(min).reverse();
const awarenessLevels = [...ORDER.slice(0, min).reverse(), UNKNOWN];
const policySentence = `Only ${listWords(blockingLevels)} advisories introduced by this PR block the merge; ${listWords(awarenessLevels)} are shown for awareness.`;
const unknownNote = 'UNKNOWN: neither the advisory nor any alias carries a parsable severity (e.g. CVSS 4.0 only); it does not block, verify it manually.';

// ---- stdout (the check log, full detail) ----
if (introduced.length) {
  console.log(`\nAdvisories introduced by this PR (${introduced.length}):`);
  for (const a of introduced) console.log(`  [${a.sev}] ${a.pkg}@${a.ver}  ${a.ids.join(', ')}  ${a.summary}`);
  if (hasUnknown) console.log(`  ${unknownNote}`);
} else {
  console.log('No new advisories introduced by this PR.');
}
console.log(policySentence);

// ---- PR comment body ----
const advLink = (id) => (id.startsWith('GHSA') ? `https://github.com/advisories/${id}` : `https://osv.dev/${id}`);
const rows = introduced.map((a) => `| ${a.sev} | \`${a.pkg}\` | ${cell(a.ver)} | [${a.id}](${advLink(a.id)}) | ${cell(a.fixed || '—')} |`).join('\n');
const table = introduced.length
  ? `| Severity | Package | Version | Advisory | Fixed in |\n|---|---|---|---|---|\n${rows}${hasUnknown ? `\n\n_${unknownNote}_` : ''}`
  : '';
let status, body;
if (blocking.length) {
  status = 'block';
  body = `${MARKER}\n## 🔴 Security gate — blocked\nThis PR introduces **${blocking.length}** new advisory(ies) at or above **${THRESHOLD}**, so the merge is blocked.\n\n${table}\n\n**How to unblock:**\n1. Upgrade the dependency to a fixed version (see *Fixed in*), or\n2. Remove the dependency, or\n3. If it is not exploitable in our usage, add a justified \`[[IgnoredVulns]]\` entry (CISA VEX reason) to \`osv-scanner.toml\`.\n\n_${policySentence} Full detail in the check log._`;
} else if (introduced.length) {
  status = 'warn';
  body = `${MARKER}\n## 🟡 Security gate — passed (with notes)\nThis PR introduces new advisories, but none at or above **${THRESHOLD}**, so it does **not** block. Consider addressing them as hygiene.\n\n${table}\n\n_${policySentence} Full detail in the check log._`;
} else {
  status = 'clean';
  body = `${MARKER}\n## ✅ Security gate — no new vulnerabilities\nThis PR does not introduce any new advisory versus the base branch.`;
}
writeFileSync(COMMENT_FILE, body);
writeFileSync(STATUS_FILE, status);

// ---- verdict ----
if (blocking.length) {
  console.error(`\n❌ BLOCKED: this PR introduces ${blocking.length} new ${THRESHOLD}+ advisory(ies). Fix or remove the dependency, or add a justified suppression to osv-scanner.toml.`);
  process.exit(1);
}
console.log(`\n✅ PASS: no new ${THRESHOLD}+ advisories introduced.`);
