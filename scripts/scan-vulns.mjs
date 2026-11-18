#!/usr/bin/env node
// scan-vulns.mjs — flatten osv-scanner JSON into the annotated vulnerabilities.csv.
//   node scripts/scan-vulns.mjs <osv-results.json> <out.csv>
// osv-scanner already honored osv-scanner.toml, so anything here that is NOT in the
// suppression baseline is, by definition, part of the monthly "delta".

import { readFileSync, writeFileSync } from 'node:fs';
const [src, out = 'sbom/vulnerabilities.csv'] = process.argv.slice(2);
// FAIL CLOSED: a missing / unreadable / shapeless scan output means the scanner
// did not run correctly. We must NOT write an empty register (that would look
// like "no vulnerabilities"). Exit non-zero so the workflow step fails.
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

// `summary` is third-party text from OSV/GHSA and is frequently multi-line.
// Collapse ALL whitespace to single spaces before quoting: an embedded newline is
// legal RFC-4180 inside quotes, but it makes the file unreadable to any consumer
// that splits on '\n' before parsing quotes — which is exactly how a multi-line
// advisory title used to shift gen-osv-ignores' columns and suppress the wrong
// advisory. Invariant: one CSV row = one physical line, always.
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => { s = oneLine(s); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const sevOf = (v) => (v.database_specific?.severity)
  || (Array.isArray(v.severity) && v.severity[0]?.score) || '';
const rows = [['severity', 'package', 'version', 'advisory', 'fixed_in', 'summary', 'url']];
for (const res of (data.results || [])) {
  for (const p of (res.packages || [])) {
    for (const v of (p.vulnerabilities || [])) {
      const fixed = [...new Set((v.affected || []).flatMap((a) => (a.ranges || [])
        .flatMap((r) => (r.events || []).filter((e) => e.fixed).map((e) => e.fixed))))].join(' | ');
      rows.push([sevOf(v), p.package?.name || '', p.package?.version || '', v.id || '',
        fixed, oneLine(v.summary).slice(0, 140), `https://osv.dev/${v.id}`]);
    }
  }
}
// Trailing newline — see cdx-to-csv.mjs.
writeFileSync(out, rows.map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`Wrote ${out}: ${rows.length - 1} advisories (post-suppression delta).`);
