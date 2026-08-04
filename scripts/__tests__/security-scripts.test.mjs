// Unit tests for the merge-deciding / compliance scripts. Zero-dependency
// (node:test), run with: node --test scripts/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sec-test-'));
const w = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
const adv = (id, sev, extra = {}) => ({ id, ...(sev ? { database_specific: { severity: sev } } : {}), ...extra });
const scan = (...pkgs) => ({ results: [{ packages: pkgs.map(([name, vulns]) => ({ package: { name, version: '1' }, vulnerabilities: vulns })) }] });

function gate(base, head, threshold = 'HIGH') {
  const env = { ...process.env, GATE_COMMENT_FILE: join(dir, 'c.md'), GATE_STATUS_FILE: join(dir, 's') };
  return spawnSync('node', [join(SCRIPTS, 'pr-gate-diff.mjs'), base, head, threshold], { env, encoding: 'utf8' });
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

function spdx(cdx) {
  const out = join(dir, 'o.spdx.json');
  const r = spawnSync('node', [join(SCRIPTS, 'cdx-to-spdx.mjs'), w('in.cdx.json', cdx), out], { encoding: 'utf8' });
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
