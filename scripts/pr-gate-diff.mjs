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

const [baseP, headP, thresholdArg] = process.argv.slice(2);
const THRESHOLD = (thresholdArg || 'HIGH').toUpperCase();
const ORDER = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
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

// --- CVSS v3.x base-score computation ----------------------------------------
// Implements the official CVSS v3.1 Base score (FIRST.org spec §7.1 "Base
// equations"). The magic numbers are the spec's metric weights and the Impact /
// Exploitability / Roundup coefficients — verify against
// https://www.first.org/cvss/v3.1/specification-document (§7.1). We only reach
// this path when an advisory has no qualitative severity word; most OSV entries
// carry database_specific.severity, which is preferred above.
function cvss3Base(vector) {
  const m = {};
  for (const kv of vector.split('/')) { const [k, v] = kv.split(':'); if (k && v) m[k] = v; }
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const AC = { L: 0.77, H: 0.44 }[m.AC];
  const UI = { N: 0.85, R: 0.62 }[m.UI];
  const scopeChanged = m.S === 'C';
  const PR = (scopeChanged ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 })[m.PR];
  const imp = { N: 0, L: 0.22, H: 0.56 };
  const C = imp[m.C], I = imp[m.I], A = imp[m.A];
  if ([AV, AC, UI, PR, C, I, A].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - C) * (1 - I) * (1 - A);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  if (impact <= 0) return 0;
  const expl = 8.22 * AV * AC * PR * UI;
  const roundup = (x) => Math.ceil(x * 10) / 10;
  return roundup(Math.min((scopeChanged ? 1.08 : 1) * (impact + expl), 10));
}
const bucketFromScore = (s) => (s >= 9 ? 'CRITICAL' : s >= 7 ? 'HIGH' : s >= 4 ? 'MODERATE' : s > 0 ? 'LOW' : 'LOW');
const normWord = (w) => (w === 'MEDIUM' ? 'MODERATE' : w); // OSV/NVD use MEDIUM; we use MODERATE

// Returns { sev, approx }. approx=true means we could not compute an exact score
// (e.g. a CVSS 4.0-only vector with no qualitative severity) and fell back to a
// conservative HIGH, surfaced explicitly so it is never a *silent* default.
function severityOf(v) {
  // 1) explicit qualitative severity (present on most GHSA advisories)
  const word = normWord((v.database_specific?.severity || '').toUpperCase());
  if (ORDER.includes(word)) return { sev: word, approx: false };
  // 2) CVSS v3.x vector → exact base score
  let sawV4 = false;
  for (const s of (v.severity || [])) {
    const score = String(s.score || '');
    if (s.type === 'CVSS_V3' || score.startsWith('CVSS:3')) {
      const sc = cvss3Base(score);
      if (sc != null) return { sev: bucketFromScore(sc), approx: false };
    }
    if (s.type === 'CVSS_V4' || score.startsWith('CVSS:4')) sawV4 = true;
  }
  // 3) CVSS 4.0-only: we deliberately do NOT hand-roll the v4 macrovector table
  //    (error-prone in a merge-deciding script). Treat conservatively as HIGH and
  //    flag it so a reviewer verifies — never a silent pass, never a silent bucket.
  if (sawV4) return { sev: 'HIGH', approx: true };
  // 4) no severity at all → conservative + flagged
  return { sev: 'HIGH', approx: true };
}

function fixedOf(v) {
  const fixes = [...new Set((v.affected || []).flatMap((a) => (a.ranges || [])
    .flatMap((r) => (r.events || []).filter((e) => e.fixed).map((e) => e.fixed))))];
  return fixes.join(', ');
}

// Key by advisory id AND package: the same CVE landing on a *different* package
// in head must count as introduced; a version bump of an already-vulnerable
// package (same id+package) must NOT.
function index(data) {
  const m = new Map();
  for (const r of (data.results || [])) for (const p of (r.packages || [])) for (const v of (p.vulnerabilities || [])) {
    const pkg = p.package?.name || '?';
    const key = `${v.id}|${pkg}`;
    if (!v.id || m.has(key)) continue;
    const { sev, approx } = severityOf(v);
    m.set(key, { id: v.id, sev, approx, pkg, ver: p.package?.version || '', fixed: fixedOf(v), summary: (v.summary || '').slice(0, 120) });
  }
  return m;
}

const base = load(baseP, 'BASE');
const head = load(headP, 'HEAD');
const baseIdx = index(base);
const headIdx = index(head);
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
