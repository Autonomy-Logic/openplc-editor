#!/usr/bin/env node
// Convert a CycloneDX 1.6 BOM into an SPDX 2.3 JSON document: name, version, purl,
// relationships, creators and timestamp. Supplier is filled when the component
// metadata names one, else NOASSERTION.
import { readFileSync, writeFileSync } from 'node:fs';
// Shared with cdx-to-csv and build-report so all three artifacts count the same
// set of components. See scripts/lib/cdx.mjs.
import { collectComponents, refOf } from './lib/cdx.mjs';

const SRC = process.argv[2] || 'sbom/bom.cdx.json';
const OUT = process.argv[3] || 'sbom/bom.spdx.json';

const cdx = JSON.parse(readFileSync(SRC, 'utf8'));
const created = cdx.metadata?.timestamp || new Date().toISOString();

// The actual SBOM generator(s), read from the CycloneDX metadata (cdxgen,
// cyclonedx-py, …) — never hardcoded.
const toolComps = cdx.metadata?.tools?.components
  || (Array.isArray(cdx.metadata?.tools) ? cdx.metadata.tools : []);
const toolCreators = toolComps
  .filter((t) => t && t.name)
  .map((t) => `Tool: ${t.name}${t.version ? '-' + t.version : ''}`);

// Root + nested components, deduped by ref so no two packages share an SPDXID.
const comps = collectComponents(cdx);

// Stable SPDXID per bom-ref/purl.
const idFor = new Map();
let n = 0;
const spdxId = (ref) => {
  if (idFor.has(ref)) return idFor.get(ref);
  const safe = String(ref).replace(/[^a-zA-Z0-9.-]/g, '-').replace(/-+/g, '-');
  const id = `SPDXRef-Pkg-${++n}-${safe}`.slice(0, 200);
  idFor.set(ref, id);
  return id;
};

const licenseExpr = (c) => {
  const ls = c.licenses || [];
  if (!ls.length) return 'NOASSERTION';
  const parts = ls
    .map((l) => l.license?.id || l.expression || null)
    .filter(Boolean);
  if (!parts.length) return 'NOASSERTION';
  // Several CycloneDX licence entries mean any of them applies: SPDX OR, with
  // compound expressions parenthesized.
  const expr = parts.length === 1 ? parts[0]
    : parts.map((p) => (/\s/.test(p) ? `(${p})` : p)).join(' OR ');
  // Non-SPDX placeholders -> NOASSERTION
  if (/SEE LICENSE|UNLICENSED|UNKNOWN/i.test(expr)) return 'NOASSERTION';
  return expr;
};

// SPDX supplier from CycloneDX supplier, manufacturer, publisher or author(s),
// in that order. A string supplier (hand-maintained component lists) is accepted.
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (x) => oneLine(typeof x === 'string' ? x : x?.name);
const personOf = (s) => s.replace(/\s*<([^>]*)>\s*$/, ' ($1)');
function supplierOf(c) {
  const org = [c.supplier, c.manufacturer, c.manufacture, c.publisher].map(nameOf).find(Boolean);
  if (org) return `Organization: ${org}`;
  const person = [...(c.authors || []), c.author].map(nameOf).find(Boolean);
  return person ? `Person: ${personOf(person)}` : 'NOASSERTION';
}

const packages = comps.map((c) => {
  const ref = refOf(c);
  const pkg = {
    name: (c.group ? `${c.group}/` : '') + c.name,
    SPDXID: spdxId(ref),
    versionInfo: c.version || 'NOASSERTION',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: licenseExpr(c),
    copyrightText: 'NOASSERTION',
    supplier: supplierOf(c),
  };
  if (c.purl) {
    pkg.externalRefs = [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: c.purl,
      },
    ];
  }
  return pkg;
});

// Relationships: document DESCRIBES root; root/deps DEPENDS_ON edges from cdx.dependencies.
const rootRef = cdx.metadata?.component?.['bom-ref'];
const relationships = [];
if (rootRef && idFor.has(rootRef)) {
  relationships.push({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: idFor.get(rootRef),
  });
}
for (const dep of cdx.dependencies || []) {
  const from = idFor.get(dep.ref);
  if (!from) continue;
  for (const to of dep.dependsOn || []) {
    const t = idFor.get(to);
    if (!t) continue;
    relationships.push({
      spdxElementId: from,
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: t,
    });
  }
}

// Derive the document name/namespace from THIS SBOM's root component — never
// hardcode a product name (that mislabels every other product's SPDX).
const rootName = (cdx.metadata?.component?.name || 'unknown-project').replace(/[^a-zA-Z0-9._-]/g, '-');
const serial = (cdx.serialNumber || `urn:uuid:${rootName}`).replace('urn:uuid:', '');
const doc = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${rootName}-SBOM`,
  documentNamespace: `https://autonomylogic.com/spdx/${rootName}/${serial}`,
  creationInfo: {
    created,
    // Derive the generator tool(s) from the source CycloneDX metadata instead of
    // hardcoding (which would mis-attribute e.g. cyclonedx-py SBOMs to cdxgen).
    creators: [
      'Organization: Autonomy Logic',
      ...toolCreators,
      'Tool: cdx-to-spdx',
    ],
  },
  packages,
  relationships,
};

writeFileSync(OUT, JSON.stringify(doc, null, 2));
console.log(`Wrote ${OUT}: ${packages.length} packages, ${relationships.length} relationships`);
