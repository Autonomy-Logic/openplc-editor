#!/usr/bin/env node
// build-report.mjs — render the Security Report (Markdown + HTML) deterministically
// from structured data, so the monthly output is IDENTICAL in shape every run and
// never drifts from the SBOM.
//
//   node scripts/build-report.mjs \
//     --config security/report-config.json \
//     --cdx sbom/<name>.cdx.json \
//     --out security/<YYYY-MM> \
//     --date 2026-08
//
// Component count and license distribution are computed live from the CycloneDX
// SBOM; everything else (VEX triage, narrative) comes from the config, which is
// what Claude updates when a new advisory appears.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const cfg = JSON.parse(readFileSync(args.config, 'utf8'));
const cdx = JSON.parse(readFileSync(args.cdx, 'utf8'));
const date = args.date || 'unknown';
const outDir = args.out || '.';
mkdirSync(outDir, { recursive: true });

// --- live metrics from the SBOM ---
const comps = cdx.components || [];
const componentCount = comps.length;
const licAgg = {};
for (const c of comps) {
  for (const l of (c.licenses || [])) {
    const id = l.license?.id || l.expression || l.license?.name || 'Unlicensed';
    licAgg[id] = (licAgg[id] || 0) + 1;
  }
}
const topLicenses = Object.entries(licAgg).sort((a, b) => b[1] - a[1]).slice(0, 8);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (s) => String(s ?? ''); // config strings may contain <b>/<code> — keep as-is in HTML
const stripTags = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

// ========================= MARKDOWN =========================
const md = [];
md.push(`# ${cfg.title} — Software Supply Chain Security Report (SBOM & VEX)\n`);
md.push('| | |');
md.push('|---|---|');
md.push(`| **Product** | ${cfg.title} (\`${cfg.product}\`) — ${cfg.subtitle} · v${cfg.version} |`);
md.push(`| **Report type** | Software Bill of Materials (SBOM) & Vulnerability Exploitability eXchange (VEX) |`);
md.push(`| **Assessment date** | ${date} · Report version 1.0 |`);
md.push(`| **Prepared by** | Autonomy Logic — Engineering / Product Security |`);
md.push(`| **Classification** | Confidential |`);
md.push(`| **Security contact** | ${cfg.securityContact} |`);
md.push('\n---\n');
md.push('## Executive Summary\n');
md.push(`This report documents the third-party software composition and known-vulnerability posture of **${cfg.title}**. It is aligned with U.S. Executive Order 14028, the NTIA *Minimum Elements for an SBOM*, and the CISA Vulnerability Exploitability eXchange (VEX) guidance.\n`);
md.push(`> **Headline posture.** ${stripTags(cfg.headline)}\n`);
md.push('### Key metrics\n');
md.push('| Metric | Value |');
md.push('|---|---|');
md.push(`| Components inventoried (full transitive graph) | **${componentCount}** |`);
md.push(`| Raw advisories detected | ${cfg.advisories.total} (${cfg.advisories.critical} critical · ${cfg.advisories.high} high · ${cfg.advisories.moderate} moderate · ${cfg.advisories.low} low) |`);
md.push(`| **AFFECTED — action required** | **${cfg.counts.affected.n}** (${cfg.counts.affected.sev}) |`);
md.push(`| AFFECTED — mitigating controls in place | ${cfg.counts.mitigated.n} (${cfg.counts.mitigated.sev}) |`);
md.push(`| **NOT AFFECTED** | **${cfg.counts.notAffected.n}** (${cfg.counts.notAffected.pct}) |`);
md.push('\n## 1. Scope & System Description\n');
md.push(stripTags(cfg.scope) + '\n');
md.push(`> **Scope note.** ${stripTags(cfg.scopeNote)}\n`);
md.push('## 2. Methodology\n');
md.push(stripTags(cfg.methodologyNote) + ' For each relevant package, source code was analyzed to determine whether the vulnerable code path is invoked and whether its input is attacker-controlled.\n');
md.push('## 3. Software Bill of Materials Summary\n');
md.push('| License | Components |');
md.push('|---|---|');
for (const [l, n] of topLicenses) md.push(`| ${l} | ${n} |`);
md.push(`\n**License finding:** ${stripTags(cfg.licenseNote)}\n`);
md.push('## 4. Findings Requiring Remediation (Affected)\n');
if (cfg.affected.length) {
  md.push('| Priority | Component | Installed | Fixed in | Severity | Reachability rationale |');
  md.push('|---|---|---|---|---|---|');
  for (const f of cfg.affected) md.push(`| ${f.priority} | \`${f.component}\` | ${f.installed} | ${f.fixedIn} | ${f.severity} | ${stripTags(f.rationale)} |`);
} else md.push('**None.**');
md.push('\n## 5. Not Affected — VEX Justifications\n');
md.push('| VEX justification (CISA) | Count | Representative components | Basis |');
md.push('|---|---|---|---|');
for (const n of cfg.notAffected) md.push(`| \`${n.justification}\` | ${n.count} | ${stripTags(n.components)} | ${stripTags(n.basis)} |`);
if (cfg.criticalNote) md.push(`\n**On critical severity.** ${stripTags(cfg.criticalNote)}\n`);
md.push('\n## 6. Mitigated Findings\n');
md.push('| Component | Advisories | Existing control |');
md.push('|---|---|---|');
for (const m of cfg.mitigated) md.push(`| \`${m.component}\` | ${m.advisories} | ${stripTags(m.control)} |`);
md.push('\n## 7. Remediation Plan\n');
for (const r of cfg.remediation) md.push(`- ${stripTags(r)}`);
md.push('\n## 8. Secure Development & Supply-Chain Practices\n');
md.push('| Practice | Status |');
md.push('|---|---|');
for (const p of cfg.practices) md.push(`| ${p.practice} | ${p.status} |`);
md.push('\n## 9. Attached Artifacts\n');
md.push('| Artifact | Format | Purpose |');
md.push('|---|---|---|');
md.push(`| \`sbom/${cfg.sbomBasename}.cdx.json\` | CycloneDX 1.6 | Canonical machine-readable SBOM |`);
md.push(`| \`sbom/${cfg.sbomBasename}.spdx.json\` | SPDX 2.3 (ISO/IEC 5962) | Procurement / compliance SBOM |`);
md.push(`| \`sbom/${cfg.sbomBasename}.components.csv\` | CSV | Human-readable component inventory (${componentCount} rows) |`);
md.push(`| \`sbom/vulnerabilities.csv\` | CSV | Full annotated advisory register (${cfg.advisories.total} rows) |`);
md.push(`\n---\n\n*Prepared by Autonomy Logic Engineering. Assessment date ${date}. Regenerate per release.*\n`);
const mdOut = md.join('\n');

// ========================= HTML =========================
const sevBadge = (s) => s; // severity strings already human
const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const th = (cells) => `<tr>${cells.map((c) => `<th>${c}</th>`).join('')}</tr>`;
const badge = (txt, cls) => `<span class="badge ${cls}">${txt}</span>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(cfg.title)} — Security Report (SBOM & VEX)</title>
<style>
:root{--ink:#1a1f29;--muted:#5b6472;--line:#e3e7ee;--accent:#1f4b8e;--red:#c0392b;--amber:#b7791f;--green:#237a4b;--purple:#6b3fa0;--blue:#2b6cb0;}
*{box-sizing:border-box;}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);line-height:1.55;max-width:940px;margin:0 auto;padding:48px 32px;}
h1{font-size:1.9rem;border-bottom:3px solid var(--accent);padding-bottom:.3em;margin-top:1.8em;}h1:first-of-type{margin-top:.2em;}
h2{font-size:1.25rem;margin-top:1.6em;color:var(--accent);}p,li{font-size:.95rem;}
code{background:#f2f4f8;padding:1px 5px;border-radius:4px;font-size:.86em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.86rem;}th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top;}th{background:#f6f8fb;font-weight:600;}
.meta td:first-child{font-weight:600;width:190px;background:#fafbfd;}
.callout{border-left:4px solid var(--accent);background:#f4f8ff;padding:14px 18px;border-radius:0 8px 8px 0;margin:1.2em 0;}.callout.good{border-color:var(--green);background:#f1f9f4;}
.badge{display:inline-block;padding:1px 8px;border-radius:20px;font-size:.72rem;font-weight:700;color:#fff;}.b-red{background:var(--red);}.b-amber{background:var(--amber);}.b-green{background:var(--green);}
.muted{color:var(--muted);font-size:.85rem;}hr{border:0;border-top:1px solid var(--line);margin:2.5em 0;}
@media print{body{padding:0;max-width:none;}h1{page-break-after:avoid;}table{page-break-inside:avoid;}a{color:var(--ink);text-decoration:none;}}
</style></head><body>
<h1 style="border:0;margin-bottom:0;">${esc(cfg.title)}</h1>
<p class="muted" style="margin-top:0;">Software Supply Chain Security Report — SBOM &amp; VEX</p>
<table class="meta">
${row(['Product', `${esc(cfg.title)} (<code>${esc(cfg.product)}</code>) — ${esc(cfg.subtitle)} · v${esc(cfg.version)}`])}
${row(['Report type', 'Software Bill of Materials (SBOM) &amp; Vulnerability Exploitability eXchange (VEX)'])}
${row(['Assessment date', `${esc(date)} · Report version 1.0`])}
${row(['Prepared by', 'Autonomy Logic — Engineering / Product Security'])}
${row(['Classification', 'Confidential'])}
${row(['Security contact', esc(cfg.securityContact)])}
</table>
<h1>Executive Summary</h1>
<p>This report documents the third-party software composition and known-vulnerability posture of <strong>${esc(cfg.title)}</strong>. It is aligned with U.S. Executive Order 14028, the NTIA <em>Minimum Elements for an SBOM</em>, and the CISA VEX guidance.</p>
<div class="callout good"><strong>Headline posture.</strong> ${rich(cfg.headline)}</div>
<h2>Key metrics</h2>
<table>${th(['Metric', 'Value'])}
${row(['Components inventoried (full transitive graph)', `<strong>${componentCount}</strong>`])}
${row(['Raw advisories detected', `${cfg.advisories.total} (${cfg.advisories.critical} critical · ${cfg.advisories.high} high · ${cfg.advisories.moderate} moderate · ${cfg.advisories.low} low)`])}
${row([badge('AFFECTED — action required', 'b-red'), `<strong>${cfg.counts.affected.n}</strong> (${cfg.counts.affected.sev})`])}
${row([badge('AFFECTED — mitigated', 'b-amber'), `${cfg.counts.mitigated.n} (${cfg.counts.mitigated.sev})`])}
${row([badge('NOT AFFECTED', 'b-green'), `<strong>${cfg.counts.notAffected.n}</strong> (${cfg.counts.notAffected.pct})`])}
</table>
<h1>1. Scope &amp; System Description</h1><p>${rich(cfg.scope)}</p>
<div class="callout"><strong>Scope note.</strong> ${rich(cfg.scopeNote)}</div>
<h1>2. Methodology</h1><p>${rich(cfg.methodologyNote)} For each relevant package, source code was analyzed to determine whether the vulnerable code path is invoked and whether its input is attacker-controlled.</p>
<h1>3. Software Bill of Materials Summary</h1>
<table>${th(['License', 'Components'])}
${topLicenses.map(([l, n]) => row([esc(l), String(n)])).join('\n')}
</table>
<div class="callout"><strong>License finding:</strong> ${rich(cfg.licenseNote)}</div>
<h1>4. Findings Requiring Remediation (Affected)</h1>
${cfg.affected.length ? `<table>${th(['Priority', 'Component', 'Installed', 'Fixed in', 'Severity', 'Reachability rationale'])}
${cfg.affected.map((f) => row([f.priority, `<code>${esc(f.component)}</code>`, esc(f.installed), esc(f.fixedIn), f.severity, rich(f.rationale)])).join('\n')}
</table>` : '<div class="callout good"><strong>None.</strong></div>'}
<h1>5. Not Affected — VEX Justifications</h1>
<table>${th(['VEX justification (CISA)', 'Count', 'Representative components', 'Basis'])}
${cfg.notAffected.map((n) => row([`<code>${esc(n.justification)}</code>`, n.count, rich(n.components), rich(n.basis)])).join('\n')}
</table>
${cfg.criticalNote ? `<div class="callout"><strong>On critical severity.</strong> ${rich(cfg.criticalNote)}</div>` : ''}
<h1>6. Mitigated Findings</h1>
<table>${th(['Component', 'Advisories', 'Existing control'])}
${cfg.mitigated.map((m) => row([`<code>${esc(m.component)}</code>`, m.advisories, rich(m.control)])).join('\n')}
</table>
<h1>7. Remediation Plan</h1><ul>${cfg.remediation.map((r) => `<li>${rich(r)}</li>`).join('')}</ul>
<h1>8. Secure Development &amp; Supply-Chain Practices</h1>
<table>${th(['Practice', 'Status'])}
${cfg.practices.map((p) => row([esc(p.practice), p.status === 'In place' ? badge('In place', 'b-green') : badge('Recommended', 'b-amber')])).join('\n')}
</table>
<h1>9. Attached Artifacts</h1>
<table>${th(['Artifact', 'Format', 'Purpose'])}
${row([`<code>sbom/${cfg.sbomBasename}.cdx.json</code>`, 'CycloneDX 1.6', 'Canonical machine-readable SBOM'])}
${row([`<code>sbom/${cfg.sbomBasename}.spdx.json</code>`, 'SPDX 2.3 (ISO/IEC 5962)', 'Procurement / compliance SBOM'])}
${row([`<code>sbom/${cfg.sbomBasename}.components.csv</code>`, 'CSV', `Human-readable component inventory (${componentCount} rows)`])}
${row(['<code>sbom/vulnerabilities.csv</code>', 'CSV', `Full annotated advisory register (${cfg.advisories.total} rows)`])}
</table>
<hr/><p class="muted">Prepared by Autonomy Logic Engineering. Assessment date ${esc(date)}. Regenerate per release.</p>
</body></html>`;

const base = `${cfg.title.replace(/[^A-Za-z0-9]+/g, '-')}-Security-Report`;
writeFileSync(`${outDir}/${base}.md`, mdOut);
writeFileSync(`${outDir}/${base}.html`, html);
console.log(`Wrote ${outDir}/${base}.md and .html (${componentCount} components, ${topLicenses.length} license classes)`);
