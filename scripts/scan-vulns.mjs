#!/usr/bin/env node
// scan-vulns.mjs — flatten osv-scanner JSON into the annotated vulnerabilities.csv.
//   node scripts/scan-vulns.mjs <osv-results.json> <out.csv>
// osv-scanner already honored osv-scanner.toml, so anything here that is NOT in the
// suppression baseline is, by definition, part of the monthly "delta".

import { readFileSync, writeFileSync } from 'node:fs';
const [src, out = 'sbom/vulnerabilities.csv'] = process.argv.slice(2);
let data = {};
try { data = JSON.parse(readFileSync(src, 'utf8')); } catch { data = {}; }

const esc = (s) => { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const sevOf = (v) => (v.database_specific?.severity)
  || (Array.isArray(v.severity) && v.severity[0]?.score) || '';
const rows = [['severity', 'package', 'version', 'advisory', 'fixed_in', 'summary', 'url']];
for (const res of (data.results || [])) {
  for (const p of (res.packages || [])) {
    for (const v of (p.vulnerabilities || [])) {
      const fixed = [...new Set((v.affected || []).flatMap((a) => (a.ranges || [])
        .flatMap((r) => (r.events || []).filter((e) => e.fixed).map((e) => e.fixed))))].join(' | ');
      rows.push([sevOf(v), p.package?.name || '', p.package?.version || '', v.id || '',
        fixed, (v.summary || '').slice(0, 140), `https://osv.dev/${v.id}`]);
    }
  }
}
writeFileSync(out, rows.map((r) => r.map(esc).join(',')).join('\n'));
console.log(`Wrote ${out}: ${rows.length - 1} advisories (post-suppression delta).`);
