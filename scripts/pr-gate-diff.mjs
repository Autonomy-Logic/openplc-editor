#!/usr/bin/env node
// pr-gate-diff.mjs — the PR security gate's decision.
//   node scripts/pr-gate-diff.mjs <base-osv.json> <head-osv.json> [threshold]
// Both inputs are osv-scanner JSON outputs produced WITH --config=osv-scanner.toml
// (so the VEX baseline is already applied). We block ONLY on advisories that the
// PR INTRODUCES — present in head, absent in base — at or above <threshold>
// (default HIGH). Pre-existing advisories never block. Exit 1 = block, 0 = pass,
// 2 = the inputs are unusable (the scanner failed) → the caller must treat this
// as a hard failure, never as a pass.
//
// FAIL-CLOSED: the workflow validates the scanner's exit code and guarantees a
// valid (possibly empty) JSON for each side. Here we still validate the shape and
// EXIT 2 if an input is missing/garbage — we never silently treat a broken scan
// as "no advisories".
//
// Side effect: writes a Markdown body to $GATE_COMMENT_FILE (default
// /tmp/gate-comment.md) and a one-word status (block|warn|clean) to
// $GATE_STATUS_FILE (default /tmp/gate-status), for the PR comment.

import { readFileSync, writeFileSync } from 'node:fs';
// Severity bucketing and advisory indexing are shared with build-report.mjs so
// the gate's verdict and the report's numbers can never disagree about the same
// advisory. See scripts/lib/severity.mjs.
import { ORDER, indexAdvisories } from './lib/severity.mjs';

const [baseP, headP, thresholdArg] = process.argv.slice(2);
const THRESHOLD = (thresholdArg || 'HIGH').toUpperCase();
const COMMENT_FILE = process.env.GATE_COMMENT_FILE || '/tmp/gate-comment.md';
const STATUS_FILE = process.env.GATE_STATUS_FILE || '/tmp/gate-status';
const MARKER = '<!-- security-pr-gate -->';

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
const min = ORDER.indexOf(THRESHOLD);

const introduced = [...headIdx.entries()].filter(([key]) => !baseIdx.has(key)).map(([, d]) => d)
  .sort((a, b) => ORDER.indexOf(b.sev) - ORDER.indexOf(a.sev));
const blocking = introduced.filter((a) => ORDER.indexOf(a.sev) >= min);

// ---- stdout (the check log — full detail) ----
if (introduced.length) {
  console.log(`\nAdvisories introduced by this PR (${introduced.length}):`);
  for (const a of introduced) console.log(`  [${a.sev}${a.approx ? '*' : ''}] ${a.pkg}@${a.ver}  ${a.id}  ${a.summary}`);
  if (introduced.some((a) => a.approx)) console.log('  (* severity could not be computed exactly — treated conservatively as HIGH; verify manually)');
} else {
  console.log('No new advisories introduced by this PR.');
}

// ---- PR comment body ----
const advLink = (id) => (id.startsWith('GHSA') ? `https://github.com/advisories/${id}` : `https://osv.dev/${id}`);
const rows = introduced.map((a) => `| ${a.sev}${a.approx ? ' \\*' : ''} | \`${a.pkg}\` | ${a.ver} | [${a.id}](${advLink(a.id)}) | ${a.fixed || '—'} |`).join('\n');
const table = introduced.length
  ? `| Severity | Package | Version | Advisory | Fixed in |\n|---|---|---|---|---|\n${rows}${introduced.some((a) => a.approx) ? '\n\n_\\* severity could not be computed exactly (e.g. CVSS 4.0-only) — treated conservatively as HIGH; please verify._' : ''}`
  : '';
let status, body;
if (blocking.length) {
  status = 'block';
  body = `${MARKER}\n## 🔴 Security gate — blocked\nThis PR introduces **${blocking.length}** new advisory(ies) at or above **${THRESHOLD}**, so the merge is blocked.\n\n${table}\n\n**How to unblock:**\n1. Upgrade the dependency to a fixed version (see *Fixed in*), or\n2. Remove the dependency, or\n3. If it is not exploitable in our usage, add a justified \`[[IgnoredVulns]]\` entry (CISA VEX reason) to \`osv-scanner.toml\`.\n\n_Only High/Critical block; Moderate/Low are shown for awareness. Full detail in the check log._`;
} else if (introduced.length) {
  status = 'warn';
  body = `${MARKER}\n## 🟡 Security gate — passed (with notes)\nThis PR introduces new advisories, but none at or above **${THRESHOLD}**, so it does **not** block. Consider addressing them as hygiene.\n\n${table}\n\n_Full detail in the check log._`;
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
