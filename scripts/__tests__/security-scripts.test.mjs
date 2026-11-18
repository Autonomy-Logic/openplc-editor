// Unit tests for the merge-deciding / compliance scripts. Zero-dependency
// (node:test), run with: node --test scripts/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sec-test-'));
const w = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
const wText = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
const adv = (id, sev, extra = {}) => ({ id, ...(sev ? { database_specific: { severity: sev } } : {}), ...extra });
const scan = (...pkgs) => ({ results: [{ packages: pkgs.map(([name, vulns]) => ({ package: { name, version: '1' }, vulnerabilities: vulns })) }] });
const run = (script, args, env = {}) => spawnSync('node', [join(SCRIPTS, script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

// ===================== pr-gate-diff =====================

function gate(base, head, threshold = 'HIGH') {
  return run('pr-gate-diff.mjs', [base, head, threshold], { GATE_COMMENT_FILE: join(dir, 'c.md'), GATE_STATUS_FILE: join(dir, 's') });
}

test('gate: MEDIUM does not block (normalized to MODERATE)', () => {
  const r = gate(w('b.json', { results: [] }), w('h.json', scan(['m', [adv('CVE-MED', 'MEDIUM')]])));
  assert.equal(r.status, 0, r.stderr);
});
test('gate: HIGH blocks', () => {
  const r = gate(w('b.json', { results: [] }), w('h.json', scan(['h', [adv('CVE-HI', 'HIGH')]])));
  assert.equal(r.status, 1);
});
test('gate: same CVE on a NEW package is introduced (blocks); on the same package it is not', () => {
  const base = w('b.json', scan(['shared', [adv('CVE-X', 'HIGH')]]));
  const headNew = w('hn.json', scan(['shared', [adv('CVE-X', 'HIGH')]], ['newpkg', [adv('CVE-X', 'HIGH')]]));
  assert.equal(gate(base, headNew).status, 1, 'new package must block');
  const headSame = w('hs.json', scan(['shared', [adv('CVE-X', 'HIGH')]]));
  assert.equal(gate(base, headSame).status, 0, 'pre-existing must not block');
});
test('gate: fails CLOSED (exit 2) on missing or shapeless scan input', () => {
  assert.equal(gate(join(dir, 'nope.json'), w('h.json', { results: [] })).status, 2, 'missing base');
  assert.equal(gate(w('bad.json', { garbage: true }), w('h.json', { results: [] })).status, 2, 'no results array');
});
test('gate: CVSS 3.1 vector (9.8) scored as blocking', () => {
  const head = w('h.json', scan(['c', [adv('CVE-CVSS', null, { severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })]]));
  assert.equal(gate(w('b.json', { results: [] }), head).status, 1);
});

// ===================== severity (shared by gate and report) =====================

const { cvss3Base, roundup, severityOf, indexAdvisories, tallyBySeverity } = await import(join(SCRIPTS, 'lib/severity.mjs'));

test('severity: CVSS 3.1 Roundup is the integer form, not ceil(x*10)/10', () => {
  // The counter-example from the v3.1 spec's Appendix A rationale: the naive form
  // rounds a value that is *representationally* just above a tenth up to the next
  // tenth. The spec defines Roundup over integers scaled by 100000 to avoid it,
  // because at the 7.0 / 9.0 boundaries that difference flips a merge decision.
  assert.equal(roundup(0.1 + 0.2), 0.3);
  assert.equal(Math.ceil((0.1 + 0.2) * 10) / 10, 0.4, 'sanity: the v3.0 formulation really is wrong here');
  assert.equal(roundup(8.6), 8.6);
  assert.equal(roundup(0.0), 0.0);
  assert.equal(roundup(4.02), 4.1);
});
test('severity: known CVSS 3.1 vectors score correctly', () => {
  assert.equal(cvss3Base('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'), 9.8);
  // The two @fastify/static advisories triaged in this repo's VEX baseline,
  // whose published base scores are 7.5 (GHSA-83w8-p2f5-377r) and 5.3
  // (GHSA-8pvw-jcv7-9cmj).
  assert.equal(cvss3Base('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N'), 7.5);
  assert.equal(cvss3Base('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N'), 5.3);
  assert.equal(cvss3Base('CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:H'), 8.3, 'scope-changed branch');
  assert.equal(cvss3Base('nonsense'), null, 'an unparseable vector must not yield a score');
});
test('severity: an advisory with no severity and no vector is conservatively HIGH and flagged', () => {
  const { sev, approx } = severityOf({ id: 'X' });
  assert.equal(sev, 'HIGH');
  assert.equal(approx, true, 'must be flagged, never a silent bucket');
});
test('severity: report and gate agree — no-severity advisory is HIGH in the tally too', () => {
  // This is the regression the shared module exists for: the report used to
  // bucket this MODERATE while the gate blocked it as HIGH.
  const t = tallyBySeverity(indexAdvisories(scan(['p', [adv('GHSA-NOSEV', null)]])));
  assert.equal(t.bySev.HIGH, 1);
  assert.equal(t.bySev.MODERATE, 0);
});
test('severity: index counts one row per (advisory, package) in both directions', () => {
  const idx = indexAdvisories(scan(['a', [adv('CVE-SAME', 'HIGH')]], ['b', [adv('CVE-SAME', 'HIGH')]]));
  assert.equal(idx.size, 2, 'one CVE across two packages is two rows, matching vulnerabilities.csv');
  assert.equal(tallyBySeverity(idx).total, 2);
});

// ===================== cdx shared collection =====================

function spdx(cdx) {
  const out = join(dir, 'o.spdx.json');
  const r = run('cdx-to-spdx.mjs', [w('in.cdx.json', cdx), out]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(readFileSync(out, 'utf8'));
}
test('cdx-to-spdx: no duplicate SPDXID when a component appears twice', () => {
  const doc = spdx({
    metadata: { component: { 'bom-ref': 'root@1', name: 'root', components: [{ 'bom-ref': 'dup@1', name: 'dup', version: '1' }] } },
    components: [{ 'bom-ref': 'dup@1', name: 'dup', version: '1' }, { 'bom-ref': 'solo@2', name: 'solo', version: '2' }],
  });
  const ids = doc.packages.map((p) => p.SPDXID);
  assert.equal(new Set(ids).size, ids.length, 'SPDXIDs must be unique');
});
test('cdx-to-spdx: multiple licenses join with OR (dual-licensed), not AND', () => {
  const doc = spdx({ components: [{ 'bom-ref': 'x@1', name: 'x', version: '1', licenses: [{ license: { id: 'MIT' } }, { license: { id: 'GPL-3.0-only' } }] }] });
  const x = doc.packages.find((p) => p.name === 'x');
  assert.equal(x.licenseDeclared, 'MIT OR GPL-3.0-only');
});
test('the three artifacts count the same components (SPDX vs CSV vs report)', () => {
  // A BOM with a NESTED workspace component: cdx-to-spdx used to walk it while
  // cdx-to-csv and build-report read only the flat list, so the SPDX declared
  // more packages than the CSV listed — for artifacts that ship side by side.
  const bom = {
    metadata: { component: { 'bom-ref': 'root@1', name: 'root', version: '1', components: [{ 'bom-ref': 'ws@1', name: 'workspace-a', version: '1' }] } },
    components: [{ 'bom-ref': 'dep@1', name: 'dep', version: '1' }, { 'bom-ref': 'dep2@1', name: 'dep2', version: '2' }],
  };
  const cdxPath = w('three.cdx.json', bom);

  const spdxOut = join(dir, 'three.spdx.json');
  assert.equal(run('cdx-to-spdx.mjs', [cdxPath, spdxOut]).status, 0);
  const spdxCount = JSON.parse(readFileSync(spdxOut, 'utf8')).packages.length;

  const csvOut = join(dir, 'three.csv');
  assert.equal(run('cdx-to-csv.mjs', [cdxPath, csvOut]).status, 0);
  const csvText = readFileSync(csvOut, 'utf8');
  assert.ok(csvText.endsWith('\n'), 'the CSV must end in a newline so `wc -l` does not under-count it');
  const csvCount = csvText.trim().split('\n').length - 1;

  const reportDir = join(dir, 'three-report');
  const cfgPath = w('three-cfg.json', minimalConfig());
  const r = run('build-report.mjs', ['--config', cfgPath, '--cdx', cdxPath, '--out', reportDir, '--date', '2026-09']);
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(join(reportDir, 'T-Security-Report.md'), 'utf8');
  const reportCount = Number(md.match(/Components inventoried[^|]*\|\s*\*\*(\d+)\*\*/)[1]);

  assert.equal(spdxCount, 4, 'root + nested workspace + 2 deps');
  assert.equal(csvCount, spdxCount);
  assert.equal(reportCount, spdxCount);
});

// ===================== assert-sbom (the content floor) =====================

test('assert-sbom: rejects an empty BOM, accepts a populated one', () => {
  const empty = w('empty.cdx.json', { bomFormat: 'CycloneDX', metadata: { component: { name: 'p' } }, components: [] });
  const r = run('assert-sbom.mjs', [empty, '50']);
  assert.equal(r.status, 1, 'an empty SBOM must fail the run, not travel the chain');
  assert.match(r.stderr, /only 1 component|below the floor/);

  const full = w('full.cdx.json', {
    bomFormat: 'CycloneDX',
    metadata: { component: { 'bom-ref': 'r', name: 'p', version: '1' } },
    components: Array.from({ length: 60 }, (_, i) => ({ 'bom-ref': `c${i}`, name: `c${i}`, version: '1' })),
  });
  assert.equal(run('assert-sbom.mjs', [full, '50']).status, 0);
});
test('assert-sbom: rejects a BOM with no root component', () => {
  const headless = w('headless.cdx.json', { components: Array.from({ length: 60 }, (_, i) => ({ name: `c${i}` })) });
  assert.equal(run('assert-sbom.mjs', [headless, '50']).status, 1);
});

// ===================== scan-vulns =====================

test('scan-vulns: fails closed rather than writing an empty register', () => {
  assert.equal(run('scan-vulns.mjs', [join(dir, 'nope.json'), join(dir, 'v.csv')]).status, 1);
  assert.equal(run('scan-vulns.mjs', [w('shapeless.json', { x: 1 }), join(dir, 'v.csv')]).status, 1);
});
test('scan-vulns: a multi-line advisory summary stays on ONE physical CSV line', () => {
  // OSV/GHSA summaries are third-party text and are routinely multi-line. An
  // embedded newline here is what used to shift gen-osv-ignores' columns.
  const src = w('multiline.json', scan(['pkg', [{ id: 'GHSA-multi', summary: 'line one\nline two\r\nline three', database_specific: { severity: 'HIGH' } }]]));
  const out = join(dir, 'multiline.csv');
  assert.equal(run('scan-vulns.mjs', [src, out]).status, 0);
  const text = readFileSync(out, 'utf8');
  assert.equal(text.trim().split('\n').length, 2, 'header + exactly one data line');
  assert.match(text, /line one line two line three/);
});

// ===================== gen-osv-ignores =====================

const CSV_HEADER = 'severity,package,version,advisory,fixed_in,verdict,basis\n';
function ignores(csv, date = '2026-10-01') {
  const p = wText(`ign-${Math.abs(hash(csv))}.csv`, csv);
  return run('gen-osv-ignores.mjs', [p, date]);
}
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
const parseIgnores = (stdout) => [...stdout.matchAll(/\[\[IgnoredVulns\]\]\nid = "([^"]+)"\nignoreUntil = "([^"]+)"\nreason = "([^"]*)"/g)]
  .map(([, id, until, reason]) => ({ id, until, reason }));

test('gen-osv-ignores: refuses to run without a verdict column', () => {
  const p = wText('noverdict.csv', 'severity,package,advisory\nHIGH,p,GHSA-aaaa-aaaa-aaaa\n');
  const r = run('gen-osv-ignores.mjs', [p, '2026-10-01']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no verdict column/);
});
test('gen-osv-ignores: suppresses not_affected, leaves affected visible', () => {
  const r = ignores(CSV_HEADER
    + 'MODERATE,a,1,GHSA-aaaa-aaaa-aaaa,2.0,not_affected,component_not_present\n'
    + 'HIGH,b,1,GHSA-bbbb-bbbb-bbbb,3.0,affected,reachable from an authenticated endpoint\n');
  assert.equal(r.status, 0, r.stderr);
  const got = parseIgnores(r.stdout);
  assert.deepEqual(got.map((g) => g.id), ['GHSA-aaaa-aaaa-aaaa']);
});
test('gen-osv-ignores: a multi-line quoted summary does NOT shift columns', () => {
  // Regression: with a `split("\n")` parser this emitted 0 entries (and reported
  // "3 rows" for 2 advisories) because the quoted newline tore the row in half.
  const csv = CSV_HEADER
    + 'MODERATE,a,1,GHSA-aaaa-aaaa-aaaa,2.0,not_affected,"first line\nsecond line"\n'
    + 'HIGH,b,1,GHSA-bbbb-bbbb-bbbb,3.0,affected,reachable\n';
  const r = ignores(csv);
  assert.equal(r.status, 0, r.stderr);
  const got = parseIgnores(r.stdout);
  assert.deepEqual(got.map((g) => g.id), ['GHSA-aaaa-aaaa-aaaa'], 'the not_affected row must still be found');
  assert.match(r.stderr, /from 2 rows/, 'the torn row must not be counted twice');
});
test('gen-osv-ignores: an id triaged affected anywhere is never suppressed', () => {
  // The adversarial shape: a forged newline inside a benign advisory's basis text
  // used to smuggle an `affected` id into a suppression entry.
  const csv = CSV_HEADER
    + 'MODERATE,a,1,GHSA-aaaa-aaaa-aaaa,2.0,not_affected,component_not_present\n'
    + 'CRITICAL,b,1,GHSA-cccc-cccc-cccc,3.0,affected,remote code execution\n'
    + 'LOW,c,1,GHSA-cccc-cccc-cccc,3.0,not_affected,looks harmless from this angle\n';
  const r = ignores(csv);
  const got = parseIgnores(r.stdout);
  assert.ok(!got.some((g) => g.id === 'GHSA-cccc-cccc-cccc'), 'an advisory triaged affected must stay visible');
  assert.deepEqual(got.map((g) => g.id), ['GHSA-aaaa-aaaa-aaaa']);
  assert.match(r.stderr, /Held back GHSA-cccc-cccc-cccc/);
});
test('gen-osv-ignores: expiries are staggered, and a suppressed CRITICAL expires first', () => {
  const r = ignores(CSV_HEADER
    + 'CRITICAL,a,1,GHSA-aaaa-aaaa-aaaa,2.0,not_affected,vulnerable_code_not_in_execute_path\n'
    + 'MODERATE,b,1,GHSA-bbbb-bbbb-bbbb,2.0,not_affected,component_not_present\n'
    + 'HIGH,c,1,GHSA-cccc-cccc-cccc,2.0,mitigated,port not published in production\n');
  const by = Object.fromEntries(parseIgnores(r.stdout).map((g) => [g.id, g.until.slice(0, 10)]));
  assert.equal(by['GHSA-aaaa-aaaa-aaaa'], '2026-10-01', 'CRITICAL pulled to the first review');
  assert.equal(by['GHSA-cccc-cccc-cccc'], '2026-10-01', 'mitigated HIGH also first');
  assert.equal(by['GHSA-bbbb-bbbb-bbbb'], '2027-01-01', 'MODERATE + component_not_present pushed back a full quarter');
  assert.equal(new Set(Object.values(by)).size, 2, 'not all on one day');
});
test('gen-osv-ignores: rejects a malformed review date', () => {
  assert.equal(ignores(CSV_HEADER + 'HIGH,a,1,GHSA-aaaa-aaaa-aaaa,2,not_affected,x\n', 'october').status, 1);
});

// ===================== build-report =====================

function minimalConfig(over = {}) {
  return {
    product: 'p', title: 'T', subtitle: 's', version: '0.0.1', sbomBasename: 'p',
    securityContact: 'sec@example.com', assessedAt: '2026-08',
    advisories: { total: 120, critical: 1, high: 48, moderate: 65, low: 6 },
    counts: { affected: { n: 1, sev: '1 high' }, mitigated: { n: 5, sev: '2 high' }, notAffected: { n: 114, pct: '95%' } },
    headline: 'Zero critical vulnerabilities are exploitable in production.',
    scope: 'scope', scopeNote: 'note', methodologyNote: 'method', licenseNote: 'lic',
    affected: [], mitigated: [], notAffected: [], criticalNote: 'the only critical is test-only',
    remediation: ['do the thing'], practices: [{ practice: 'x', status: 'In place' }],
    ...over,
  };
}
function report(cfg, extraArgs = []) {
  const out = join(dir, `rep-${Math.abs(hash(JSON.stringify(cfg) + extraArgs.join()))}`);
  mkdirSync(out, { recursive: true });
  const cdxPath = w('rep.cdx.json', {
    metadata: { component: { 'bom-ref': 'r', name: 'p', version: '9.9.9' } },
    components: [{ 'bom-ref': 'a', name: 'a', version: '1', licenses: [{ license: { id: 'MIT' } }] }],
  });
  const r = run('build-report.mjs', ['--config', w(`cfg-${Math.abs(hash(JSON.stringify(cfg)))}.json`, cfg), '--cdx', cdxPath, '--out', out, '--date', '2026-09', ...extraArgs]);
  assert.equal(r.status, 0, r.stderr);
  return { md: readFileSync(join(out, 'T-Security-Report.md'), 'utf8'), html: readFileSync(join(out, 'T-Security-Report.html'), 'utf8') };
}

test('build-report: with --cdx renders the SBOM sections', () => {
  const { md } = report(minimalConfig());
  assert.match(md, /Security Report \(SBOM & VEX\)/);
  assert.match(md, /Components inventoried \(root \+ full transitive graph\) \| \*\*2\*\*/);
  assert.match(md, /\| MIT \| 1 \|/);
});
test('build-report: without --cdx renders a vulnerability-only report', () => {
  const out = join(dir, 'rep-no-sbom');
  mkdirSync(out, { recursive: true });
  const one = w('raw-nosbom.json', scan(['a', [adv('GHSA-9', 'HIGH')]]));
  const r = run('build-report.mjs', ['--config', w('cfg-nosbom.json', minimalConfig()), '--out', out, '--date', '2026-09', '--osv-raw', one, '--osv-delta', one]);
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(join(out, 'T-Vulnerability-Report.md'), 'utf8');
  assert.match(md, /— Vulnerability Report \(VEX\)/);
  assert.match(md, /SBOM is generated separately/);
  assert.doesNotMatch(md, /Components inventoried|cdx\.json|spdx\.json/);
  assert.match(md, /`vulnerabilities\.csv` \| CSV \| Post-suppression advisory register \(1 rows\)/);
});
test('build-report: the register row count comes from the live scan, not the config', () => {
  const raw = w('raw.json', scan(['a', [adv('GHSA-1', 'HIGH')]], ['b', [adv('GHSA-2', 'MODERATE')]], ['c', [adv('GHSA-3', 'LOW')]]));
  const delta = w('delta.json', scan(['a', [adv('GHSA-1', 'HIGH')]]));
  const { md } = report(minimalConfig({ affected: [{ priority: 'P1', component: 'a', installed: '1', fixedIn: '2', severity: 'High', ids: ['GHSA-1'], rationale: 'r' }] }),
    ['--osv-raw', raw, '--osv-delta', delta]);
  assert.match(md, /Raw advisories detected \(this scan · 2026-09\) \| 3 /);
  assert.match(md, /advisory register \(1 rows\)/, 'the register must report the delta count');
  assert.doesNotMatch(md, /120 rows/, 'the static config total must not survive into live mode');
});
test('build-report: an advisory no triage entry claims is reported as untriaged', () => {
  const raw = w('raw2.json', scan(['x', [adv('GHSA-NEW', 'CRITICAL')]]));
  const delta = w('delta2.json', scan(['x', [adv('GHSA-NEW', 'CRITICAL')]]));
  const { md, html } = report(minimalConfig(), ['--osv-raw', raw, '--osv-delta', delta]);
  assert.match(md, /4a\. Untriaged in This Scan/);
  assert.match(md, /GHSA-NEW/);
  assert.match(md, /Assessment incomplete/, 'the executive summary must say the assessment is incomplete');
  assert.match(md, /Headline posture \(as assessed 2026-08\)/, 'the stale posture must be dated, not presented as current');
  assert.match(html, /callout warn/);
  assert.match(md, /covers assessed advisories only/, 'criticalNote must be qualified when a critical is unassessed');
});
test('build-report: a claimed advisory is NOT reported as untriaged', () => {
  const raw = w('raw3.json', scan(['x', [adv('GHSA-KNOWN', 'HIGH')]]));
  const delta = w('delta3.json', scan(['x', [adv('GHSA-KNOWN', 'HIGH')]]));
  const { md } = report(minimalConfig({
    mitigated: [{ component: 'x', advisories: '1 high', ids: ['GHSA-KNOWN'], control: 'port not exposed' }],
  }), ['--osv-raw', raw, '--osv-delta', delta]);
  assert.doesNotMatch(md, /Untriaged in This Scan/);
  assert.doesNotMatch(md, /Assessment incomplete/);
});
test('build-report: config strings cannot inject HTML anywhere, including short fields', () => {
  const xss = '<img src=x onerror=alert(1)>';
  const { html } = report(minimalConfig({
    affected: [{ priority: xss, component: 'c', installed: '1', fixedIn: '2', severity: xss, ids: [], rationale: 'r' }],
    notAffected: [{ justification: 'component_not_present', count: xss, components: 'c', basis: 'b' }],
    mitigated: [{ component: 'm', advisories: xss, ids: [], control: 'c' }],
    practices: [{ practice: 'p', status: xss }],
  }));
  assert.ok(!html.includes('<img src=x'), 'no unescaped tag may reach the PDF renderer');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
test('build-report: <b> and <code> in narrative fields still render', () => {
  const { html } = report(minimalConfig({ headline: 'a <b>bold</b> claim' }));
  assert.match(html, /a <b>bold<\/b> claim/);
});
test('build-report: the product version comes from the SBOM, not the config', () => {
  const { md } = report(minimalConfig({ version: '0.0.1' }));
  assert.match(md, /v9\.9\.9/, 'the version cdxgen read from package.json wins');
  assert.doesNotMatch(md, /v0\.0\.1/);
});
test('build-report: without a live scan the document says the numbers are stored, not scanned', () => {
  const { md } = report(minimalConfig());
  assert.match(md, /Rendered without a live scan/);
});

// ===================== csv parser =====================

const { parseCsv } = await import(join(SCRIPTS, 'lib/csv.mjs'));

test('parseCsv: quoted newlines, escaped quotes, CRLF and a trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\n1,"two\nlines"\n'), [['a', 'b'], ['1', 'two\nlines']]);
  assert.deepEqual(parseCsv('a\r\nb\r\n'), [['a'], ['b']]);
  assert.deepEqual(parseCsv('x,"say ""hi""",z'), [['x', 'say "hi"', 'z']]);
  assert.deepEqual(parseCsv(''), [], 'empty input is zero rows, not one blank row');
});

// ===================== generate-sbom (tool pin) =====================

test('generate-sbom: cdxgen is pinned to an exact name@x.y.z and invoked through that pin', () => {
  const sh = readFileSync(join(SCRIPTS, 'generate-sbom.sh'), 'utf8');
  const pin = sh.match(/^CDXGEN_VERSION="(\d+\.\d+\.\d+)"$/m);
  assert.ok(pin, 'CDXGEN_VERSION must be an exact x.y.z version');
  assert.equal(pin[1], '11.11.0');
  assert.match(sh, /npx --yes "@cyclonedx\/cdxgen@\$\{CDXGEN_VERSION\}"/);
  const calls = sh.split('\n').filter((l) => !l.trimStart().startsWith('#') && l.includes('cdxgen@'));
  assert.equal(calls.length, 1, 'exactly one cdxgen invocation');
  assert.doesNotMatch(calls[0], /email|protected/i, 'no web-obfuscated placeholder in place of the pin');
});
