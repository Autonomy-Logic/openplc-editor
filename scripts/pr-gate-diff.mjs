#!/usr/bin/env node
// pr-gate-diff.mjs — the PR security gate's decision.
//   node scripts/pr-gate-diff.mjs <base-osv.json> <head-osv.json> [threshold]
// Both inputs are osv-scanner JSON outputs produced WITH --config=osv-scanner.toml
// (so the VEX baseline is already applied). We block ONLY on advisories that the
// PR INTRODUCES — present in head, absent in base — at or above <threshold>
// (default HIGH). Pre-existing advisories never block. Exit 1 = block, 0 = pass.
//
// Side effect: writes a Markdown body to $GATE_COMMENT_FILE (default
// /tmp/gate-comment.md) and a one-word status (block|warn|clean) to
// $GATE_STATUS_FILE (default /tmp/gate-status), so the workflow can post a PR
// comment. The full detail is also printed to stdout (the check log).

import { readFileSync, writeFileSync } from 'node:fs';

const [baseP, headP, thresholdArg] = process.argv.slice(2);
const THRESHOLD = (thresholdArg || 'HIGH').toUpperCase();
const ORDER = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const COMMENT_FILE = process.env.GATE_COMMENT_FILE || '/tmp/gate-comment.md';
const STATUS_FILE = process.env.GATE_STATUS_FILE || '/tmp/gate-status';
const MARKER = '<!-- security-pr-gate -->';

const load = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };

// --- CVSS v3.x base-score computation (for entries that carry only a vector) ---
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

function severityOf(v) {
  const word = (v.database_specific?.severity || '').toUpperCase();
  if (ORDER.includes(word)) return word === 'MEDIUM' ? 'MODERATE' : word;
  for (const s of (v.severity || [])) {
    if (typeof s.score === 'string' && s.score.startsWith('CVSS:3')) {
      const sc = cvss3Base(s.score);
      if (sc != null) return bucketFromScore(sc);
    }
  }
  return 'HIGH'; // conservative: an unscored NEW advisory should surface, not slip through
}

function fixedOf(v) {
  const fixes = [...new Set((v.affected || []).flatMap((a) => (a.ranges || [])
    .flatMap((r) => (r.events || []).filter((e) => e.fixed).map((e) => e.fixed))))];
  return fixes.join(', ');
}

function index(data) {
  const m = new Map();
  for (const r of (data.results || [])) for (const p of (r.packages || [])) for (const v of (p.vulnerabilities || [])) {
    if (!v.id || m.has(v.id)) continue;
    m.set(v.id, { sev: severityOf(v), pkg: p.package?.name || '?', ver: p.package?.version || '', fixed: fixedOf(v), summary: (v.summary || '').slice(0, 120) });
  }
  return m;
}

const base = index(load(baseP));
const head = index(load(headP));
const min = ORDER.indexOf(THRESHOLD);

const introduced = [...head.entries()].filter(([id]) => !base.has(id))
  .map(([id, d]) => ({ id, ...d }))
  .sort((a, b) => ORDER.indexOf(b.sev) - ORDER.indexOf(a.sev));
const blocking = introduced.filter((a) => ORDER.indexOf(a.sev) >= min);

// ---- stdout (the check log — full detail) ----
if (introduced.length) {
  console.log(`\nAdvisories introduced by this PR (${introduced.length}):`);
  for (const a of introduced) console.log(`  [${a.sev}] ${a.pkg}@${a.ver}  ${a.id}  ${a.summary}`);
} else {
  console.log('No new advisories introduced by this PR.');
}

// ---- PR comment body ----
const advLink = (id) => (id.startsWith('GHSA') ? `https://github.com/advisories/${id}` : `https://osv.dev/${id}`);
const rows = introduced.map((a) => `| ${a.sev} | \`${a.pkg}\` | ${a.ver} | [${a.id}](${advLink(a.id)}) | ${a.fixed || '—'} |`).join('\n');
const table = introduced.length
  ? `| Severity | Package | Version | Advisory | Fixed in |\n|---|---|---|---|---|\n${rows}`
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
