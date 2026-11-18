#!/usr/bin/env node
// build-report.mjs — render the Security Report (Markdown + HTML) deterministically
// from structured data, so the monthly output is IDENTICAL in shape every run and
// never drifts from the SBOM.
//
//   node scripts/build-report.mjs \
//     --config security/report-config.json \
//     --cdx sbom/<name>.cdx.json \
//     --osv-raw /tmp/osv-raw.json --osv-delta /tmp/osv.json \
//     --out security/<YYYY-MM> \
//     --date 2026-08
//
// Component count, license distribution and every advisory NUMBER are computed
// live — from the CycloneDX SBOM and from this run's scans. The narrative (VEX
// rationale, remediation plan, posture statement) comes from the config, which is
// what triage updates when a new advisory appears.
//
// The config's narrative can go stale between assessments, and a stale narrative
// in a document classified Confidential is the failure mode that matters here. So
// the renderer cross-checks it: any advisory in this run's post-suppression delta
// whose id is not claimed by an entry in affected[] / mitigated[] / notAffected[]
// is reported in its own "Untriaged in this scan" section, and the posture
// statement is explicitly dated rather than presented as current. The document can
// be incomplete; it must not be quietly contradictory.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { collectComponents, licenseIdsOf } from './lib/cdx.mjs';
import { ORDER, indexAdvisories, tallyBySeverity, sevStr } from './lib/severity.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const cfg = JSON.parse(readFileSync(args.config, 'utf8'));
// Without --cdx the report is vulnerability-only: no SBOM sections, named <title>-Vulnerability-Report.
const hasSbom = Boolean(args.cdx);
const cdx = hasSbom ? JSON.parse(readFileSync(args.cdx, 'utf8')) : { components: [] };
const date = args.date || 'unknown';
const outDir = args.out || '.';
mkdirSync(outDir, { recursive: true });

// --- live metrics from the SBOM ---
// collectComponents() is shared with cdx-to-spdx and cdx-to-csv so this number,
// the SPDX package count and the CSV row count are the same quantity. An auditor
// comparing the three artifacts in this folder will find them consistent.
const comps = hasSbom ? collectComponents(cdx) : [];
const componentCount = comps.length;
const licAgg = {};
for (const c of comps) {
  for (const id of licenseIdsOf(c)) licAgg[id] = (licAgg[id] || 0) + 1;
  if (!licenseIdsOf(c).length) licAgg.Unlicensed = (licAgg.Unlicensed || 0) + 1;
}
const topLicenses = Object.entries(licAgg).sort((a, b) => b[1] - a[1]).slice(0, 8);

// The product version belongs to the code, not to this config: rendering a
// hardcoded "v0.1.0" forever is worse than rendering nothing. Prefer the version
// cdxgen read from package.json, fall back to the config, omit if neither knows.
const productVersion = cdx.metadata?.component?.version || cfg.version || '';

// --- live advisory metrics from the actual scan(s), when provided -----------
// --osv-raw = unfiltered scan; --osv-delta = scan WITH the osv-scanner.toml VEX
// baseline applied. Falls back to the config numbers if no scan is passed (an
// ad-hoc local render), in which case the document says so.
const loadScan = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const rawScan = args['osv-raw'] ? loadScan(args['osv-raw']) : null;
const deltaScan = args['osv-delta'] ? loadScan(args['osv-delta']) : null;
const live = Boolean(rawScan && deltaScan);

const deltaIdx = deltaScan ? indexAdvisories(deltaScan) : new Map();
const raw = rawScan ? tallyBySeverity(indexAdvisories(rawScan)) : null;
const delta = deltaScan ? tallyBySeverity(deltaIdx) : null;

let advisoryRows;
if (live) {
  const suppressed = Math.max(0, raw.total - delta.total);
  const pct = raw.total ? Math.round(100 * suppressed / raw.total) : 0;
  advisoryRows = [
    { label: `Raw advisories detected (this scan · ${date})`, value: `${raw.total} (${sevStr(raw.bySev)})` },
    { label: 'Not applicable — suppressed by the VEX baseline', value: `${suppressed} (${pct}%)`, badge: 'b-green' },
    { label: 'Surfacing after suppression — review', value: `${delta.total} (${sevStr(delta.bySev)})`, badge: delta.total ? 'b-red' : 'b-green' },
  ];
} else {
  advisoryRows = [
    { label: 'Raw advisories detected', value: `${cfg.advisories.total} (${cfg.advisories.critical} critical · ${cfg.advisories.high} high · ${cfg.advisories.moderate} moderate · ${cfg.advisories.low} low)` },
    { label: 'AFFECTED — action required', value: `${cfg.counts.affected.n} (${cfg.counts.affected.sev})`, badge: 'b-red' },
    { label: 'AFFECTED — mitigating controls in place', value: `${cfg.counts.mitigated.n} (${cfg.counts.mitigated.sev})`, badge: 'b-amber' },
    { label: 'NOT AFFECTED', value: `${cfg.counts.notAffected.n} (${cfg.counts.notAffected.pct})`, badge: 'b-green' },
  ];
}
// The advisory register on disk (vulnerabilities.csv) is written from the delta
// scan, so its row count is the delta's — never the config's static total, which
// would print a second, contradictory number for the same quantity.
const registerRows = live ? delta.total : cfg.advisories.total;

// --- has the narrative kept up with the scan? -------------------------------
// Every triage entry declares the advisory ids it accounts for. Anything in the
// delta that no entry claims has not been assessed, and the sections below are
// silent about it — so we say so, with the ids, rather than let the posture
// statement imply otherwise. (Advisories suppressed in osv-scanner.toml are
// already absent from the delta by construction: they were triaged.)
const claimedIds = new Set();
for (const group of [cfg.affected, cfg.mitigated, cfg.notAffected]) {
  for (const e of (group || [])) for (const id of (e.ids || [])) claimedIds.add(id.toUpperCase());
}
const untriaged = [...deltaIdx.values()]
  .filter((a) => !claimedIds.has(a.id.toUpperCase()))
  .sort((a, b) => ORDER.indexOf(b.sev) - ORDER.indexOf(a.sev) || a.pkg.localeCompare(b.pkg));
const untriagedCritical = untriaged.filter((a) => a.sev === 'CRITICAL' || a.sev === 'HIGH');
const assessedAt = cfg.assessedAt || null;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// report-config.json is written by the AI triage step, so its strings are
// UNTRUSTED. Escape everything, then re-enable only a small set of attribute-less
// formatting tags. This blocks <script>, <img onerror=…>, <b onmouseover=…>, etc.
// from reaching the headless Chrome that renders the PDF (which also runs with
// JavaScript disabled — see the workflow). EVERY interpolation of config data
// below goes through esc() or rich(); there are no exceptions, including short
// fields like counts and severity words.
const RICH_TAGS = /&lt;(\/?(?:b|strong|code|em|i|br))&gt;/gi;
const rich = (s) => esc(s).replace(RICH_TAGS, '<$1>');
const stripTags = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

const untriagedNote = untriaged.length
  ? `**${untriaged.length} advisory(ies) surfaced in this scan have not been assessed** and are listed in section 4a. `
    + `The posture statement below reflects the last full assessment${assessedAt ? ` (${assessedAt})` : ''} and does not account for them.`
  : null;

// ========================= MARKDOWN =========================
const md = [];
const reportName = hasSbom ? 'Software Supply Chain Security Report (SBOM & VEX)' : 'Vulnerability Report (VEX)';
const reportType = hasSbom ? 'Software Bill of Materials (SBOM) & Vulnerability Exploitability eXchange (VEX)' : 'Vulnerability Exploitability eXchange (VEX)';
const noSbomNote = 'The SBOM is generated separately, once per release, and archived with that release.';
md.push(`# ${cfg.title} — ${reportName}\n`);
md.push('| | |');
md.push('|---|---|');
md.push(`| **Product** | ${cfg.title} (\`${cfg.product}\`) — ${cfg.subtitle}${productVersion ? ` · v${productVersion}` : ''} |`);
md.push(`| **Report type** | ${reportType} |`);
md.push(`| **Assessment date** | ${date} · Report version 1.0 |`);
md.push(`| **Prepared by** | Autonomy Logic — Engineering / Product Security |`);
md.push(`| **Classification** | Confidential |`);
md.push(`| **Security contact** | ${cfg.securityContact} |`);
md.push('\n---\n');
md.push('## Executive Summary\n');
md.push(`This report documents the third-party software composition and known-vulnerability posture of **${cfg.title}**. It is aligned with U.S. Executive Order 14028, the NTIA *Minimum Elements for an SBOM*, and the CISA Vulnerability Exploitability eXchange (VEX) guidance.\n`);
if (untriagedNote) md.push(`> ⚠️ **Assessment incomplete.** ${stripTags(untriagedNote)}\n`);
md.push(`> **Headline posture${assessedAt ? ` (as assessed ${assessedAt})` : ''}.** ${stripTags(cfg.headline)}\n`);
if (!live) md.push('> **Note.** Rendered without a live scan; the advisory counts below come from the stored assessment, not from a scan performed for this report.\n');
md.push('### Key metrics\n');
md.push('| Metric | Value |');
md.push('|---|---|');
if (hasSbom) md.push(`| Components inventoried (root + full transitive graph) | **${componentCount}** |`);
for (const r of advisoryRows) md.push(`| ${r.label} | ${r.value} |`);
if (live) md.push(`| Surfacing advisories not yet assessed | ${untriaged.length ? `**${untriaged.length}**` : '0'} |`);
md.push('\n## 1. Scope & System Description\n');
md.push(stripTags(cfg.scope) + '\n');
md.push(`> **Scope note.** ${stripTags(cfg.scopeNote)}\n`);
md.push('## 2. Methodology\n');
md.push(stripTags(cfg.methodologyNote) + ' For each relevant package, source code was analyzed to determine whether the vulnerable code path is invoked and whether its input is attacker-controlled.\n');
md.push('## 3. Software Bill of Materials Summary\n');
if (hasSbom) {
  md.push('| License | Components |');
  md.push('|---|---|');
  for (const [l, n] of topLicenses) md.push(`| ${l} | ${n} |`);
  md.push(`\n**License finding:** ${stripTags(cfg.licenseNote)}\n`);
} else md.push(`${noSbomNote}\n`);
md.push('## 4. Findings Requiring Remediation (Affected)\n');
if (cfg.affected.length) {
  md.push('| Priority | Component | Installed | Fixed in | Severity | Reachability rationale |');
  md.push('|---|---|---|---|---|---|');
  for (const f of cfg.affected) md.push(`| ${f.priority} | \`${f.component}\` | ${f.installed} | ${f.fixedIn} | ${f.severity} | ${stripTags(f.rationale)} |`);
} else md.push('**None.**');
if (untriaged.length) {
  md.push('\n## 4a. Untriaged in This Scan (no VEX determination yet)\n');
  md.push('These advisories surfaced after the VEX baseline was applied and are not accounted for by any entry in sections 4, 5 or 6. **No reachability determination has been made.** They must be triaged — upgraded, or documented as not-affected in `osv-scanner.toml` — before this report can be treated as a complete assessment.\n');
  md.push('| Severity | Component | Installed | Advisory | Fixed in | Summary |');
  md.push('|---|---|---|---|---|---|');
  for (const a of untriaged) md.push(`| ${a.sev}${a.approx ? ' *' : ''} | \`${a.pkg}\` | ${a.ver} | [${a.id}](https://osv.dev/${a.id}) | ${a.fixed || '—'} | ${stripTags(a.summary)} |`);
  if (untriaged.some((a) => a.approx)) md.push('\n_\\* the advisory carries no qualitative severity and no CVSS v3.x vector; treated conservatively as HIGH pending manual scoring._\n');
}
md.push('\n## 5. Not Affected — VEX Justifications\n');
md.push('| VEX justification (CISA) | Count | Representative components | Basis |');
md.push('|---|---|---|---|');
for (const n of cfg.notAffected) md.push(`| \`${n.justification}\` | ${n.count} | ${stripTags(n.components)} | ${stripTags(n.basis)} |`);
if (cfg.criticalNote) {
  md.push(`\n**On critical severity.** ${stripTags(cfg.criticalNote)}`);
  if (untriagedCritical.length) md.push(`\n> This statement covers assessed advisories only. ${untriagedCritical.length} high/critical advisory(ies) in section 4a are still unassessed.`);
  md.push('');
}
md.push('\n## 6. Mitigated Findings\n');
md.push('| Component | Advisories | Existing control |');
md.push('|---|---|---|');
for (const m of cfg.mitigated) md.push(`| \`${m.component}\` | ${m.advisories} | ${stripTags(m.control)} |`);
md.push('\n## 7. Remediation Plan\n');
for (const r of cfg.remediation) md.push(`- ${stripTags(r)}`);
if (untriaged.length) md.push(`- **Triage the ${untriaged.length} advisory(ies) in section 4a** and record a CISA VEX determination for each.`);
md.push('\n## 8. Secure Development & Supply-Chain Practices\n');
md.push('| Practice | Status |');
md.push('|---|---|');
for (const p of cfg.practices) md.push(`| ${p.practice} | ${p.status} |`);
md.push('\n## 9. Attached Artifacts\n');
md.push('| Artifact | Format | Purpose |');
md.push('|---|---|---|');
if (hasSbom) {
  md.push(`| \`sbom/${cfg.sbomBasename}.cdx.json\` | CycloneDX 1.6 | Canonical machine-readable SBOM |`);
  md.push(`| \`sbom/${cfg.sbomBasename}.spdx.json\` | SPDX 2.3 (ISO/IEC 5962) | Procurement / compliance SBOM |`);
  md.push(`| \`sbom/${cfg.sbomBasename}.components.csv\` | CSV | Human-readable component inventory (${componentCount} rows) |`);
}
md.push(`| \`${hasSbom ? 'sbom/' : ''}vulnerabilities.csv\` | CSV | Post-suppression advisory register (${registerRows} rows) |`);
md.push(`\n---\n\n*Prepared by Autonomy Logic Engineering. Assessment date ${date}. Regenerate per release.*\n`);
const mdOut = md.join('\n');

// ========================= HTML =========================
const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const th = (cells) => `<tr>${cells.map((c) => `<th>${c}</th>`).join('')}</tr>`;
const badge = (txt, cls) => `<span class="badge ${cls}">${esc(txt)}</span>`;

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
.callout{border-left:4px solid var(--accent);background:#f4f8ff;padding:14px 18px;border-radius:0 8px 8px 0;margin:1.2em 0;}.callout.good{border-color:var(--green);background:#f1f9f4;}.callout.warn{border-color:var(--red);background:#fdf3f2;}
.badge{display:inline-block;padding:1px 8px;border-radius:20px;font-size:.72rem;font-weight:700;color:#fff;}.b-red{background:var(--red);}.b-amber{background:var(--amber);}.b-green{background:var(--green);}
.muted{color:var(--muted);font-size:.85rem;}hr{border:0;border-top:1px solid var(--line);margin:2.5em 0;}
@media print{body{padding:0;max-width:none;}h1{page-break-after:avoid;}table{page-break-inside:avoid;}a{color:var(--ink);text-decoration:none;}}
</style></head><body>
<h1 style="border:0;margin-bottom:0;">${esc(cfg.title)}</h1>
<p class="muted" style="margin-top:0;">${esc(reportName)}</p>
<table class="meta">
${row(['Product', `${esc(cfg.title)} (<code>${esc(cfg.product)}</code>) — ${esc(cfg.subtitle)}${productVersion ? ` · v${esc(productVersion)}` : ''}`])}
${row(['Report type', esc(reportType)])}
${row(['Assessment date', `${esc(date)} · Report version 1.0`])}
${row(['Prepared by', 'Autonomy Logic — Engineering / Product Security'])}
${row(['Classification', 'Confidential'])}
${row(['Security contact', esc(cfg.securityContact)])}
</table>
<h1>Executive Summary</h1>
<p>This report documents the third-party software composition and known-vulnerability posture of <strong>${esc(cfg.title)}</strong>. It is aligned with U.S. Executive Order 14028, the NTIA <em>Minimum Elements for an SBOM</em>, and the CISA VEX guidance.</p>
${untriagedNote ? `<div class="callout warn"><strong>⚠️ Assessment incomplete.</strong> ${rich(untriagedNote)}</div>` : ''}
<div class="callout good"><strong>Headline posture${assessedAt ? ` (as assessed ${esc(assessedAt)})` : ''}.</strong> ${rich(cfg.headline)}</div>
${live ? '' : '<div class="callout"><strong>Note.</strong> Rendered without a live scan; the advisory counts below come from the stored assessment, not from a scan performed for this report.</div>'}
<h2>Key metrics</h2>
<table>${th(['Metric', 'Value'])}
${hasSbom ? row(['Components inventoried (root + full transitive graph)', `<strong>${componentCount}</strong>`]) : ''}
${advisoryRows.map((r) => row([r.badge ? badge(r.label, r.badge) : esc(r.label), esc(r.value)])).join('\n')}
${live ? row(['Surfacing advisories not yet assessed', untriaged.length ? `<strong>${untriaged.length}</strong>` : '0']) : ''}
</table>
<h1>1. Scope &amp; System Description</h1><p>${rich(cfg.scope)}</p>
<div class="callout"><strong>Scope note.</strong> ${rich(cfg.scopeNote)}</div>
<h1>2. Methodology</h1><p>${rich(cfg.methodologyNote)} For each relevant package, source code was analyzed to determine whether the vulnerable code path is invoked and whether its input is attacker-controlled.</p>
<h1>3. Software Bill of Materials Summary</h1>
${hasSbom ? `<table>${th(['License', 'Components'])}
${topLicenses.map(([l, n]) => row([esc(l), String(n)])).join('\n')}
</table>
<div class="callout"><strong>License finding:</strong> ${rich(cfg.licenseNote)}</div>` : `<p>${esc(noSbomNote)}</p>`}
<h1>4. Findings Requiring Remediation (Affected)</h1>
${cfg.affected.length ? `<table>${th(['Priority', 'Component', 'Installed', 'Fixed in', 'Severity', 'Reachability rationale'])}
${cfg.affected.map((f) => row([esc(f.priority), `<code>${esc(f.component)}</code>`, esc(f.installed), esc(f.fixedIn), esc(f.severity), rich(f.rationale)])).join('\n')}
</table>` : '<div class="callout good"><strong>None.</strong></div>'}
${untriaged.length ? `<h1>4a. Untriaged in This Scan (no VEX determination yet)</h1>
<div class="callout warn">These advisories surfaced after the VEX baseline was applied and are not accounted for by any entry in sections 4, 5 or 6. <strong>No reachability determination has been made.</strong> They must be triaged — upgraded, or documented as not-affected in <code>osv-scanner.toml</code> — before this report can be treated as a complete assessment.</div>
<table>${th(['Severity', 'Component', 'Installed', 'Advisory', 'Fixed in', 'Summary'])}
${untriaged.map((a) => row([`${esc(a.sev)}${a.approx ? ' *' : ''}`, `<code>${esc(a.pkg)}</code>`, esc(a.ver), `<a href="https://osv.dev/${esc(a.id)}">${esc(a.id)}</a>`, esc(a.fixed || '—'), esc(a.summary)])).join('\n')}
</table>
${untriaged.some((a) => a.approx) ? '<p class="muted">* the advisory carries no qualitative severity and no CVSS v3.x vector; treated conservatively as HIGH pending manual scoring.</p>' : ''}` : ''}
<h1>5. Not Affected — VEX Justifications</h1>
<table>${th(['VEX justification (CISA)', 'Count', 'Representative components', 'Basis'])}
${cfg.notAffected.map((n) => row([`<code>${esc(n.justification)}</code>`, esc(n.count), rich(n.components), rich(n.basis)])).join('\n')}
</table>
${cfg.criticalNote ? `<div class="callout"><strong>On critical severity.</strong> ${rich(cfg.criticalNote)}${untriagedCritical.length ? ` <em>This statement covers assessed advisories only; ${untriagedCritical.length} high/critical advisory(ies) in section 4a are still unassessed.</em>` : ''}</div>` : ''}
<h1>6. Mitigated Findings</h1>
<table>${th(['Component', 'Advisories', 'Existing control'])}
${cfg.mitigated.map((m) => row([`<code>${esc(m.component)}</code>`, esc(m.advisories), rich(m.control)])).join('\n')}
</table>
<h1>7. Remediation Plan</h1><ul>${cfg.remediation.map((r) => `<li>${rich(r)}</li>`).join('')}${untriaged.length ? `<li><strong>Triage the ${untriaged.length} advisory(ies) in section 4a</strong> and record a CISA VEX determination for each.</li>` : ''}</ul>
<h1>8. Secure Development &amp; Supply-Chain Practices</h1>
<table>${th(['Practice', 'Status'])}
${cfg.practices.map((p) => row([esc(p.practice), p.status === 'In place' ? badge('In place', 'b-green') : badge(p.status, 'b-amber')])).join('\n')}
</table>
<h1>9. Attached Artifacts</h1>
<table>${th(['Artifact', 'Format', 'Purpose'])}
${hasSbom ? [
  row([`<code>sbom/${esc(cfg.sbomBasename)}.cdx.json</code>`, 'CycloneDX 1.6', 'Canonical machine-readable SBOM']),
  row([`<code>sbom/${esc(cfg.sbomBasename)}.spdx.json</code>`, 'SPDX 2.3 (ISO/IEC 5962)', 'Procurement / compliance SBOM']),
  row([`<code>sbom/${esc(cfg.sbomBasename)}.components.csv</code>`, 'CSV', `Human-readable component inventory (${componentCount} rows)`]),
].join('\n') : ''}
${row([`<code>${hasSbom ? 'sbom/' : ''}vulnerabilities.csv</code>`, 'CSV', `Post-suppression advisory register (${registerRows} rows)`])}
</table>
<hr/><p class="muted">Prepared by Autonomy Logic Engineering. Assessment date ${esc(date)}. Regenerate per release.</p>
</body></html>`;

const base = `${cfg.title.replace(/[^A-Za-z0-9]+/g, '-')}-${hasSbom ? 'Security' : 'Vulnerability'}-Report`;
writeFileSync(`${outDir}/${base}.md`, mdOut);
writeFileSync(`${outDir}/${base}.html`, html);
// Publish the paths so the workflow does not have to re-derive them by globbing
// the output directory (which breaks the moment a second .html lands there).
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `basename=${base}\nhtml=${outDir}/${base}.html\nmd=${outDir}/${base}.md\nuntriaged=${untriaged.length}\n`);
}
console.log(`Wrote ${outDir}/${base}.md and .html (${hasSbom ? `${componentCount} components, ${topLicenses.length} license classes` : 'vulnerability-only, no SBOM'}`
  + `${live ? `, ${delta.total} surfacing advisories, ${untriaged.length} untriaged` : ', no live scan'})`);
