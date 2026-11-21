#!/usr/bin/env node
// assert-sbom.mjs — CONTENT gate on a freshly generated CycloneDX SBOM.
//   node scripts/assert-sbom.mjs <cdx.json> [minComponents]
//
// Why this exists: every other stage in the pipeline validates only the SHAPE of
// its input. Feed the chain a `{"components":[]}` BOM and cdx-to-csv, cdx-to-spdx,
// scan-vulns, build-report and pr-gate-diff all succeed — the result being a
// document classified Confidential, prepared with reference to EO 14028 / CISA VEX, that
// attests a clean security posture over zero inventoried components. A generator
// that silently produced nothing must fail the run, not pass it.
//
// Exit 0 = usable SBOM. Exit 1 = the generator did not resolve the graph.

import { readFileSync } from 'node:fs';
import { collectComponents } from './lib/cdx.mjs';

const [src, minArg] = process.argv.slice(2);
const MIN = Number(minArg ?? process.env.MIN_COMPONENTS ?? 50);
if (!src) { console.error('usage: assert-sbom.mjs <cdx.json> [minComponents]'); process.exit(1); }
// An empty or non-numeric floor would make the check pass everything: refuse it.
if (!Number.isInteger(MIN) || MIN < 1) {
  console.error(`ASSERT-SBOM ERROR: minComponents "${minArg ?? process.env.MIN_COMPONENTS}" is not a positive integer.`);
  process.exit(1);
}

const fail = (msg) => { console.error(`::error::SBOM validation failed: ${msg}`); process.exit(1); };

let cdx;
try { cdx = JSON.parse(readFileSync(src, 'utf8')); }
catch (e) { fail(`cannot read/parse "${src}" (${e.code || e.message}) — the generator did not produce a BOM.`); }

if (cdx.bomFormat && cdx.bomFormat !== 'CycloneDX') fail(`"${src}" is not a CycloneDX document (bomFormat=${cdx.bomFormat}).`);
if (!cdx.metadata?.component?.name) fail(`"${src}" has no metadata.component — the generator did not identify the project.`);

const count = collectComponents(cdx).length;
if (count < MIN) {
  fail(`"${src}" declares only ${count} component(s), below the floor of ${MIN}. `
    + 'cdxgen did not walk the lockfile (a partial/aborted run). Refusing to let an '
    + 'empty inventory become a clean bill of health.');
}

console.log(`SBOM OK: ${count} components (floor ${MIN}), root "${cdx.metadata.component.name}".`);
