// Unit tests for the merge-deciding / compliance scripts. Zero-dependency
// (node:test), run with: node --test scripts/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv } from '../lib/csv.mjs';
import { indexAdvisories as indexAdv, tallyBySeverity as tally } from '../lib/severity.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sec-test-'));
const w = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
const wText = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
const adv = (id, sev, extra = {}) => ({ id, ...(sev ? { database_specific: { severity: sev } } : {}), ...extra });
const scan = (...pkgs) => ({ results: [{ packages: pkgs.map(([name, vulns]) => ({ package: { name, version: '1' }, vulnerabilities: vulns })) }] });
const run = (script, args, env = {}) => spawnSync('node', [join(SCRIPTS, script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
// One advisory on one package installed at two versions: the index joins them as '4.17.15 | 4.17.20'.
const multiVersion = () => ({ results: [{ packages: ['4.17.20', '4.17.15'].map((version) => ({
  package: { name: 'lodash', version, ecosystem: 'npm' }, vulnerabilities: [adv('GHSA-mv-crit', 'CRITICAL', { summary: 'a | b' })] })) }] });
// Cells of a markdown table row, splitting only on unescaped '|'.
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

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
test('gate: the comment states the threshold actually applied (HIGH and CRITICAL)', () => {
  const head = w('h-crit.json', scan(['c', [adv('GHSA-CRIT', 'CRITICAL')]]));
  const base = w('b-empty.json', { results: [] });
  assert.equal(gate(base, head, 'HIGH').status, 1);
  const high = readFileSync(join(dir, 'c.md'), 'utf8');
  assert.match(high, /Only CRITICAL and HIGH advisories introduced by this PR block the merge; MODERATE, LOW and UNKNOWN are shown for awareness\./);
  assert.equal(gate(base, head, 'CRITICAL').status, 1);
  const crit = readFileSync(join(dir, 'c.md'), 'utf8');
  assert.match(crit, /Only CRITICAL advisories introduced by this PR block the merge; HIGH, MODERATE, LOW and UNKNOWN are shown for awareness\./);
  assert.doesNotMatch(crit, /High\/Critical/);
  const headHigh = w('h-high.json', scan(['h', [adv('GHSA-HIGH', 'HIGH')]]));
  assert.equal(gate(base, headHigh, 'CRITICAL').status, 0, 'a new HIGH does not block at CRITICAL');
  assert.match(readFileSync(join(dir, 'c.md'), 'utf8'), /Only CRITICAL advisories/);
});
test('gate: an UNKNOWN-severity advisory never blocks, even at LOW, and is listed', () => {
  const r = gate(w('b.json', { results: [] }), w('h-unk.json', scan(['u', [adv('GHSA-UNK', null)]])), 'LOW');
  assert.equal(r.status, 0, r.stderr);
  const c = readFileSync(join(dir, 'c.md'), 'utf8');
  assert.match(c, /\| UNKNOWN \| `u` \|/);
  assert.match(c, /UNKNOWN: neither the advisory nor any alias/);
});
test('gate: an unknown threshold fails closed', () => {
  assert.equal(gate(w('b.json', { results: [] }), w('h.json', { results: [] }), 'SEVERE').status, 2);
});
test('gate: a new alias record of an advisory already in base is not introduced', () => {
  const base = w('b-alias.json', scan(['p', [adv('GHSA-1', 'HIGH', { aliases: ['CVE-1'] })]]));
  const head = w('h-alias.json', scan(['p', [adv('GHSA-1', 'HIGH', { aliases: ['CVE-1'] }), adv('PYSEC-1', null, { aliases: ['CVE-1'] })]]));
  assert.equal(gate(base, head).status, 0);
});
test('gate: a multi-version advisory is ONE comment row with the versions escaped', () => {
  const r = gate(w('b.json', { results: [] }), w('h-mv.json', multiVersion()), 'CRITICAL');
  assert.equal(r.status, 1, r.stderr);
  const rows = readFileSync(join(dir, 'c.md'), 'utf8').split('\n').filter((l) => l.includes('GHSA-mv-crit'));
  assert.equal(rows.length, 1);
  const cells = cellsOf(rows[0]);
  assert.equal(cells.length, 5, rows[0]);
  assert.equal(cells[2], '4.17.15 \\| 4.17.20');
});
test('gate: CVSS 3.1 vector (9.8) scored as blocking', () => {
  const head = w('h.json', scan(['c', [adv('CVE-CVSS', null, { severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })]]));
  assert.equal(gate(w('b.json', { results: [] }), head).status, 1);
});

// ===================== severity (shared by gate and report) =====================

const { cvss3Base, roundup, severityOf, indexAdvisories, tallyBySeverity, sevStr } = await import(pathToFileURL(join(SCRIPTS, 'lib/severity.mjs')).href);

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
test('severity: an advisory with no parsable severity anywhere is UNKNOWN, never a guessed bucket', () => {
  assert.equal(severityOf({ id: 'X' }), 'UNKNOWN');
  assert.equal(severityOf({ id: 'X', severity: [{ type: 'CVSS_V4', score: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N' }] }), 'UNKNOWN');
  const t = tallyBySeverity(indexAdvisories(scan(['p', [adv('GHSA-NOSEV', null)]])));
  assert.equal(t.bySev.UNKNOWN, 1);
  assert.equal(t.bySev.HIGH, 0);
  assert.equal(sevStr(t.bySev), '0 critical · 0 high · 0 moderate · 0 low · 1 unknown');
});
test('severity: alias group (GHSA + PYSEC, max_severity 5.3, vector on the GHSA only) is ONE MODERATE advisory', () => {
  // Earlier variants returned MODERATE+HIGH*/2, MODERATE+MODERATE/2 and MODERATE/1 for this fixture.
  const data = { results: [{ packages: [{
    package: { name: 'requests', version: '2.0.0', ecosystem: 'PyPI' },
    groups: [{ ids: ['GHSA-aaaa-bbbb-cccc', 'PYSEC-2026-1'], aliases: ['CVE-2026-1', 'GHSA-aaaa-bbbb-cccc', 'PYSEC-2026-1'], max_severity: '5.3' }],
    vulnerabilities: [
      { id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-1'], severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N' }] },
      { id: 'PYSEC-2026-1', aliases: ['CVE-2026-1'] },
    ],
  }] }] };
  const idx = indexAdvisories(data);
  assert.equal(idx.size, 1);
  const [a] = idx.values();
  assert.equal(a.id, 'GHSA-aaaa-bbbb-cccc');
  assert.equal(a.sev, 'MODERATE');
  assert.deepEqual(a.ids, ['GHSA-aaaa-bbbb-cccc', 'PYSEC-2026-1']);
  assert.ok(a.aliases.includes('CVE-2026-1'));
  assert.deepEqual(tallyBySeverity(idx).bySev, { CRITICAL: 0, HIGH: 0, MODERATE: 1, LOW: 0, UNKNOWN: 0 });
});
test('severity: without osv groups, records sharing an alias still form one group and take the highest member severity', () => {
  const idx = indexAdvisories(scan(['p', [adv('PYSEC-1', null, { aliases: ['CVE-1'] }), adv('GHSA-1', 'HIGH', { aliases: ['CVE-1'] })]]));
  assert.equal(idx.size, 1);
  assert.equal([...idx.values()][0].sev, 'HIGH');
});
test('severity: group max_severity scores an advisory whose records carry no severity', () => {
  const data = { results: [{ packages: [{ package: { name: 'p', version: '1' }, groups: [{ ids: ['PYSEC-9'], aliases: ['PYSEC-9'], max_severity: '9.1' }], vulnerabilities: [{ id: 'PYSEC-9' }] }] }] };
  assert.equal([...indexAdvisories(data).values()][0].sev, 'CRITICAL');
});
test('severity: fixed_in lists only the fix versions of the same package (and ecosystem)', () => {
  const ev = (fixed) => [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed }] }];
  const multi = adv('GHSA-multi', 'HIGH', { affected: [
    { package: { name: 'a', ecosystem: 'npm' }, ranges: ev('1.2.0') },
    { package: { name: 'a', ecosystem: 'npm' }, ranges: ev('2.0.1') },
    { package: { name: 'b', ecosystem: 'npm' }, ranges: ev('9.9.9') },
    { package: { name: 'a', ecosystem: 'PyPI' }, ranges: ev('7.7.7') },
  ] });
  const idx = indexAdvisories({ results: [{ packages: [
    { package: { name: 'a', version: '1.0.0', ecosystem: 'npm' }, vulnerabilities: [multi] },
    { package: { name: 'b', version: '9.0.0', ecosystem: 'npm' }, vulnerabilities: [multi] },
  ] }] });
  assert.equal(idx.get('GHSA-multi|a').fixed, '1.2.0, 2.0.1');
  assert.equal(idx.get('GHSA-multi|b').fixed, '9.9.9');
  const py = adv('PYSEC-x', 'LOW', { affected: [{ package: { name: 'Foo_Bar', ecosystem: 'PyPI' }, ranges: ev('3.0') }, { package: { name: 'other', ecosystem: 'PyPI' }, ranges: ev('4.0') }] });
  assert.equal(indexAdvisories(scan(['foo-bar', [py]])).get('PYSEC-x|foo-bar').fixed, '3.0', 'PyPI names compare normalized');
  const none = adv('GHSA-none', 'LOW', { affected: [{ package: { name: 'zzz' }, ranges: ev('5.0') }] });
  assert.equal(indexAdvisories(scan(['q', [none]])).get('GHSA-none|q').fixed, '5.0', 'no entry names the package: all fixes kept');
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
test('cdx-to-spdx: supplier comes from supplier, manufacturer, publisher or authors, else NOASSERTION', () => {
  const doc = spdx({ components: [
    { 'bom-ref': 's@1', name: 's', version: '1', supplier: { name: 'Supplier Org' }, publisher: 'ignored' },
    { 'bom-ref': 'str@1', name: 'str', version: '1', supplier: 'Vendored Upstream' },
    { 'bom-ref': 'm@1', name: 'm', version: '1', manufacturer: { name: 'Maker' } },
    { 'bom-ref': 'p@1', name: 'p', version: '1', publisher: 'Publisher Co' },
    { 'bom-ref': 'a@1', name: 'a', version: '1', authors: [{ name: 'Jane Doe <jane@example.com>' }] },
    { 'bom-ref': 'n@1', name: 'n', version: '1' },
  ] });
  const sup = Object.fromEntries(doc.packages.map((p) => [p.name, p.supplier]));
  assert.deepEqual(sup, {
    s: 'Organization: Supplier Org', str: 'Organization: Vendored Upstream', m: 'Organization: Maker',
    p: 'Organization: Publisher Co', a: 'Person: Jane Doe (jane@example.com)', n: 'NOASSERTION',
  });
  assert.doesNotMatch(readFileSync(join(SCRIPTS, 'cdx-to-spdx.mjs'), 'utf8'), /NTIA/, 'no conformance claim in the converter');
});
test('cdx-to-spdx: registry author strings with stray quotes or nested brackets give a clean Person', () => {
  const doc = spdx({ components: [
    { 'bom-ref': 'q@1', name: 'q', version: '1', authors: [{ name: '"Guido van Rossum' }] },
    { 'bom-ref': 'n@1', name: 'n', version: '1', authors: [{ name: 'Bob Halley <Bob Halley <halley@dnspython.org>>' }] },
    { 'bom-ref': 'd@1', name: 'd', version: '1', author: '"Jane Doe" <jane@example.com>' },
    { 'bom-ref': 'p@1', name: 'p', version: '1', author: 'Ann (ann@example.com)' },
    { 'bom-ref': 'e@1', name: 'e', version: '1', author: '<only@example.com>' },
    { 'bom-ref': 'g@1', name: 'g', version: '1', author: '"<>"' },
  ] });
  const sup = Object.fromEntries(doc.packages.map((x) => [x.name, x.supplier]));
  assert.deepEqual(sup, {
    q: 'Person: Guido van Rossum', n: 'Person: Bob Halley (halley@dnspython.org)', d: 'Person: Jane Doe (jane@example.com)',
    p: 'Person: Ann (ann@example.com)', e: 'Person: only@example.com', g: 'NOASSERTION',
  });
});
test('cdx-to-spdx: created is UTC with second precision (SPDX 2.3), with or without a CycloneDX timestamp', () => {
  assert.equal(spdx({ metadata: { timestamp: '2026-11-20T10:11:12.345Z' }, components: [] }).creationInfo.created, '2026-11-20T10:11:12Z');
  assert.match(spdx({ components: [] }).creationInfo.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
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
test('assert-sbom: an empty or non-numeric floor is refused, not treated as 0 or NaN', () => {
  const one = w('one.cdx.json', { metadata: { component: { 'bom-ref': 'r', name: 'p' } }, components: [{ 'bom-ref': 'c', name: 'c' }] });
  for (const floor of ['', 'fifty', '0', '-3', '2.5']) {
    const r = run('assert-sbom.mjs', [one, floor]);
    assert.equal(r.status, 1, `floor "${floor}" must fail closed`);
    assert.match(r.stderr, /not a positive integer/);
  }
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
test('gen-osv-ignores: only exact suppressible verdicts suppress ("not mitigated" stays visible)', () => {
  const r = ignores(CSV_HEADER
    + 'HIGH,a,1,GHSA-aaaa-aaaa-aaaa,2.0,not mitigated,no control in place\n'
    + 'HIGH,b,1,GHSA-bbbb-bbbb-bbbb,2.0,mitigation pending,ticket open\n'
    + 'HIGH,c,1,GHSA-cccc-cccc-cccc,2.0,Not Affected,component_not_present\n'
    + 'HIGH,d,1,GHSA-dddd-dddd-dddd,2.0,not-applicable,component_not_present\n');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(parseIgnores(r.stdout).map((g) => g.id).sort(), ['GHSA-cccc-cccc-cccc', 'GHSA-dddd-dddd-dddd']);
});
test('gen-osv-ignores: an end-of-month review date is clamped, never rolled into the next month', () => {
  const r = ignores(CSV_HEADER + 'LOW,a,1,GHSA-aaaa-aaaa-aaaa,2.0,not_affected,component_not_present\n', '2026-11-30');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(parseIgnores(r.stdout)[0].until.slice(0, 10), '2027-02-28', '3 months after Nov 30 is Feb 28, not Mar 2');
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
  assert.match(md, /Posture at the last full assessment \(2026-08\); it does not cover the 1 unassessed advisory\(ies\) above/);
  assert.doesNotMatch(md, /Headline posture/, 'an incomplete assessment must not be headlined as the posture');
  assert.doesNotMatch(html, /callout good"><strong>Posture/);
  assert.match(html, /callout warn/);
  assert.doesNotMatch(html, /\*\*/, 'markdown emphasis must not leak into the HTML');
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
test('build-report: a config whose groups cover the whole scan yields no incomplete callout and a consistent headline', () => {
  const data = scan(['a', [adv('GHSA-A1', 'HIGH')]], ['b', [adv('GHSA-B1', 'MODERATE'), adv('PYSEC-B2', null, { aliases: ['CVE-B'] })]], ['c', [adv('GHSA-C1', 'LOW')]]);
  data.results[0].packages[1].vulnerabilities[0].aliases = ['CVE-B'];
  const raw = w('raw-cover.json', data);
  const { md, html } = report(minimalConfig({
    affected: [{ priority: 'P1', component: 'a', installed: '1', fixedIn: '2', severity: 'High', ids: ['GHSA-A1'], rationale: 'r' }],
    mitigated: [{ component: 'b', advisories: '1', ids: ['CVE-B'], control: 'claimed through an alias' }],
    notAffected: [{ justification: 'component_not_present', count: '1', components: 'c', basis: 'b', ids: ['GHSA-C1'] }],
  }), ['--osv-raw', raw, '--osv-delta', raw]);
  assert.doesNotMatch(md, /Assessment incomplete|Untriaged in This Scan|does not cover/);
  assert.match(md, /Headline posture \(as assessed 2026-08\)/);
  assert.match(md, /Surfacing advisories not yet assessed \| 0 \|/);
  assert.doesNotMatch(html, /callout warn/);
  assert.match(html, /callout good"><strong>Headline posture/);
});
test('build-report: the register row count equals the vulnerabilities.csv rows for a duplicated advisory', () => {
  // The same tar advisory reported under two scanned sources.
  const tar = () => ({ package: { name: 'tar', version: '6.2.0', ecosystem: 'npm' }, vulnerabilities: [adv('GHSA-dup-tar', 'HIGH')] });
  const dup = w('dup.json', { results: [{ source: { path: 'a/package-lock.json' }, packages: [tar()] }, { source: { path: 'b/package-lock.json' }, packages: [tar()] }] });
  const csv = join(dir, 'dup.csv');
  assert.equal(run('scan-vulns.mjs', [dup, csv]).status, 0);
  const csvRows = readFileSync(csv, 'utf8').trim().split('\n').length - 1;
  assert.equal(csvRows, 1);
  assert.equal(tally(indexAdv(JSON.parse(readFileSync(dup, 'utf8')))).total, csvRows);
  const { md } = report(minimalConfig({ affected: [{ priority: 'P1', component: 'tar', installed: '6.2.0', fixedIn: '7', severity: 'High', ids: ['GHSA-dup-tar'], rationale: 'r' }] }), ['--osv-raw', dup, '--osv-delta', dup]);
  assert.match(md, new RegExp(`advisory register \\(${csvRows} rows\\)`));
});
test('build-report: a multi-version advisory and a piped config value each stay ONE table row', () => {
  const mv = w('mv.json', multiVersion());
  const { md } = report(minimalConfig({ affected: [{ priority: 'P1', component: 'x', installed: '1.0 | 2.0', fixedIn: '3.0', severity: 'High', ids: ['GHSA-other'], rationale: 'a|b\nc' }] }), ['--osv-raw', mv, '--osv-delta', mv]);
  const untriaged = md.split('\n').filter((l) => l.includes('GHSA-mv-crit'));
  assert.equal(untriaged.length, 1);
  assert.equal(cellsOf(untriaged[0]).length, 6, untriaged[0]);
  assert.equal(cellsOf(untriaged[0])[2], '4.17.15 \\| 4.17.20');
  const affected = md.split('\n').filter((l) => l.startsWith('| P1 |'));
  assert.equal(affected.length, 1, 'a newline in a cell must not split the row');
  assert.equal(cellsOf(affected[0]).length, 6, affected[0]);
});
test('scan-vulns: an alias group is one row, listing every record id and the other aliases', () => {
  const src = w('alias-csv.json', scan(['p', [adv('PYSEC-1', null, { aliases: ['CVE-1'] }), adv('GHSA-1', 'HIGH', { aliases: ['CVE-1'] })]]));
  const out = join(dir, 'alias.csv');
  assert.equal(run('scan-vulns.mjs', [src, out]).status, 0);
  const rows = parseCsv(readFileSync(out, 'utf8'));
  assert.equal(rows.length, 2);
  const r = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i]]));
  assert.equal(r.severity, 'HIGH');
  assert.equal(r.advisory, 'GHSA-1 | PYSEC-1');
  assert.equal(r.aliases, 'CVE-1');
});
test('build-report: esc() escapes quotes, so an id cannot break out of the href attribute', () => {
  const evil = 'GHSA-x" onmouseover="alert(1)';
  const raw = w('raw-quote.json', scan(['q', [adv(evil, 'HIGH', { summary: "it's" })]]));
  const { html } = report(minimalConfig(), ['--osv-raw', raw, '--osv-delta', raw]);
  assert.ok(!html.includes('" onmouseover="'), 'a quote must not terminate the attribute');
  assert.match(html, /href="https:\/\/osv\.dev\/GHSA-x&quot; onmouseover=&quot;alert\(1\)"/);
  assert.match(html, /it&#39;s/);
});
test('build-report: no NTIA conformance claim; supplier coverage is stated as it is', () => {
  const { md, html } = report(minimalConfig());
  assert.doesNotMatch(md + html, /NTIA/);
  assert.match(md, /supplier is given where the package metadata names one and is NOASSERTION otherwise/);
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


test('parseCsv: quoted newlines, escaped quotes, CRLF and a trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\n1,"two\nlines"\n'), [['a', 'b'], ['1', 'two\nlines']]);
  assert.deepEqual(parseCsv('a\r\nb\r\n'), [['a'], ['b']]);
  assert.deepEqual(parseCsv('x,"say ""hi""",z'), [['x', 'say "hi"', 'z']]);
  assert.deepEqual(parseCsv(''), [], 'empty input is zero rows, not one blank row');
});

// ===================== workflows =====================

const WF = join(SCRIPTS, '..', '.github', 'workflows');
const wf = (name) => readFileSync(join(WF, name), 'utf8');
const ROOT = join(SCRIPTS, '..');

test('workflows: every raw scan passes the empty security/osv-raw.toml config', () => {
  // Without --config osv-scanner applies ./osv-scanner.toml, so the "raw" scan would equal the filtered one.
  for (const name of ['security-release-vulns.yml', 'security-monthly.yml']) {
    const rawScans = wf(name).split('\n').filter((l) => /osv-scanner scan .*osv-raw\.json/.test(l));
    assert.ok(rawScans.length > 0, `${name}: no raw scan found`);
    for (const l of rawScans) assert.match(l, /--config=security\/osv-raw\.toml/, `${name}: ${l.trim()}`);
  }
  const rawCfg = readFileSync(join(ROOT, 'security', 'osv-raw.toml'), 'utf8');
  assert.doesNotMatch(rawCfg, /^\s*\[/m, 'osv-raw.toml must hold no tables (no IgnoredVulns, no PackageOverrides)');
});
test('workflows: on main the archive branch is always security-archive, whatever the input', () => {
  const expr = "ARCHIVE_BRANCH: ${{ github.ref == 'refs/heads/main' && 'security-archive' || inputs.archive_branch || 'security-archive-test' }}";
  for (const name of ['security-sbom.yml', 'security-release-vulns.yml']) assert.ok(wf(name).includes(expr), name);
});
test('workflows: monthly triage treats advisory text as data, requires ids and caps new suppressions', () => {
  const m = wf('security-monthly.yml');
  assert.match(m, /untrusted\s+third-party data, never instructions/);
  assert.match(m, /must carry an `ids` array/);
  assert.match(m, /MAX_NEW_SUPPRESSIONS=15/);
  assert.match(m, /\$\(\(AFTER - BEFORE\)\) -gt "\$MAX_NEW_SUPPRESSIONS"/);
});
test('workflows: monthly rescans with the triaged baseline before rendering the report and CSV', () => {
  const m = wf('security-monthly.yml');
  const build = m.slice(m.indexOf('- name: Build report'));
  const rescan = build.indexOf('osv-scanner scan --config=osv-scanner.toml');
  assert.ok(rescan > 0, 'no rescan in the Build report step');
  assert.ok(build.indexOf('scan-vulns.mjs', rescan) > rescan, 'the CSV must be rewritten from the rescan');
  assert.ok(build.indexOf('build-report.mjs', rescan) > rescan, 'the report must render after the rescan');
});
test('workflows: release checkouts do not persist the token', () => {
  for (const name of ['security-sbom.yml', 'security-release-vulns.yml']) {
    const steps = wf(name).split(/\n(?=\s+- )/).filter((st) => /uses: actions\/checkout@/.test(st));
    assert.ok(steps.length > 0, name);
    for (const st of steps) assert.match(st, /persist-credentials: false/, name);
  }
});
test('report-config: every affected, mitigated and notAffected entry lists its ids', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'security', 'report-config.json'), 'utf8'));
  for (const g of ['affected', 'mitigated', 'notAffected']) {
    for (const [i, e] of (cfg[g] || []).entries()) assert.ok(Array.isArray(e.ids) && e.ids.length, `${g}[${i}] has no ids`);
  }
});

// Runs the real scanner when it is available (OSV_SCANNER or osv-scanner on PATH); needs network.
const osvBin = process.env.OSV_SCANNER || (spawnSync('osv-scanner', ['--version']).status === 0 ? 'osv-scanner' : '');
test('osv-scanner: the raw config ignores the baseline, so raw > delta when the baseline is non-empty', { skip: !osvBin && 'osv-scanner not available' }, () => {
  const proj = mkdtempSync(join(tmpdir(), 'osv-raw-'));
  writeFileSync(join(proj, 'package-lock.json'), JSON.stringify({ name: 't', lockfileVersion: 3, requires: true,
    packages: { '': { name: 't', dependencies: { lodash: '4.17.20' } }, 'node_modules/lodash': { version: '4.17.20' } } }));
  writeFileSync(join(proj, 'osv-scanner.toml'), '[[IgnoredVulns]]\nid = "GHSA-35jh-r3h4-6jhm"\nreason = "test"\n');
  const scanWith = (cfgArgs, out) => {
    const r = spawnSync(osvBin, ['scan', ...cfgArgs, '--recursive', '--format=json', `--output=${out}`, proj], { encoding: 'utf8' });
    assert.ok(r.status === 0 || r.status === 1, r.stderr);
    return indexAdv(JSON.parse(readFileSync(out, 'utf8')));
  };
  const has = (idx) => [...idx.values()].some((a) => a.aliases.includes('GHSA-35jh-r3h4-6jhm'));
  const delta = scanWith([`--config=${join(proj, 'osv-scanner.toml')}`], join(proj, 'delta.json'));
  const raw = scanWith([`--config=${join(ROOT, 'security', 'osv-raw.toml')}`], join(proj, 'raw.json'));
  const implicit = scanWith([], join(proj, 'implicit.json'));
  assert.ok(has(raw), 'the raw scan must report the suppressed advisory');
  assert.ok(!has(delta), 'the filtered scan must not');
  assert.ok(!has(implicit), 'without --config the directory osv-scanner.toml is applied (why osv-raw.toml exists)');
  assert.ok(tally(raw).total > tally(delta).total);
});

// ===================== generate-sbom pin =====================

test('generate-sbom: every npx package spec is an exact name@x.y.z pin', () => {
  const sh = readFileSync(join(SCRIPTS, 'generate-sbom.sh'), 'utf8');
  const vars = Object.fromEntries([...sh.matchAll(/^\s*([A-Z_][A-Z0-9_]*)="([^"$]*)"/gm)].map((m) => [m[1], m[2]]));
  const specs = [...sh.matchAll(/npx\s+--yes\s+("[^"]+"|\S+)/g)]
    .map((m) => m[1].replace(/^"|"$/g, '').replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, v) => vars[v] ?? `<unset ${v}>`));
  assert.ok(specs.length > 0, 'no npx call found in generate-sbom.sh');
  for (const spec of specs) assert.match(spec, /^(@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+$/, `invalid package spec: ${spec}`);
});

// ===================== security-archive =====================

const ARCHIVE = join(SCRIPTS, 'security-archive.sh');
const archiveRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'archive-'));
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'Merge pull request #7 from x');
  writeFileSync(join(root, 'f.txt'), 'x');
  spawnSync('git', ['init', '-q', '--bare', join(root, 'r.git')]);
  return root;
};

test('security-archive: refuses the real branch outside refs/heads/main', () => {
  const root = archiveRepo();
  const env = { ...process.env, ARCHIVE_BRANCH: 'security-archive', GITHUB_REF: 'refs/heads/feature/x', GH_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' };
  delete env.ARCHIVE_REMOTE_URL;
  const r = spawnSync('bash', [ARCHIVE, 'publish', 'pr-7', 'f.txt'], { cwd: root, env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /written only from refs\/heads\/main/);
});

test('security-archive: publishes and leaves no work directory behind', () => {
  const root = archiveRepo();
  const tmp = mkdtempSync(join(tmpdir(), 'archive-tmp-'));
  const env = { ...process.env, TMPDIR: tmp, ARCHIVE_BRANCH: 'security-archive-test', ARCHIVE_REMOTE_URL: join(root, 'r.git'), ARCHIVE_PROVENANCE: 'PROVENANCE-sbom.txt' };
  const r = spawnSync('bash', [ARCHIVE, 'publish', 'pr-7', 'f.txt'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const ls = spawnSync('git', ['--git-dir', join(root, 'r.git'), 'ls-tree', '-r', '--name-only', 'security-archive-test'], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.deepEqual(ls.sort(), ['pr-7/PROVENANCE-sbom.txt', 'pr-7/f.txt']);
  assert.deepEqual(spawnSync('ls', ['-A', tmp], { encoding: 'utf8' }).stdout.trim(), '');
});
test('workflows: the gate scans the merge commit first parent as base, never the stale event base sha', () => {
  const gate = wf('security-pr-gate.yml');
  assert.doesNotMatch(gate, /pull_request\.base\.sha/);
  assert.match(gate, /git rev-parse HEAD\^1/);
  const depth = gate.match(/uses: actions\/checkout@[^\n]*\n(?:\s+[^\n]*\n)*?\s+fetch-depth: (\d+)/);
  assert.ok(depth && (depth[1] === '0' || Number(depth[1]) >= 2), 'gate checkout needs fetch-depth 0 or >= 2');
});
