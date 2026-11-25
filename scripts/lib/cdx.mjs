// cdx.mjs — the ONE way to walk a CycloneDX BOM's component list.
//
// Why this exists: the three artifacts that ship in the same monthly folder
// (SPDX, components.csv, and the report's "Components inventoried" metric) used
// to count components differently — cdx-to-spdx walked nested workspace
// components recursively while cdx-to-csv and build-report read the flat
// `bom.components` only. In a pnpm monorepo that makes the SPDX declare more
// packages than the CSV lists, and a procurement auditor compares exactly those
// numbers. All three now import collectComponents() so the counts agree by
// construction.

// Stable identity for a component (bom-ref → purl → group/name@version).
export const refOf = (c) => c['bom-ref'] || c.purl || `${c.group || ''}/${c.name}@${c.version || ''}`;

// Flatten the root component + `components` and every nested `components` array
// into one list, DEDUPED by ref: a component can legitimately appear both under
// metadata.component.components and in cdx.components.
//
// includeRoot: the root component (metadata.component, i.e. the product itself)
// is a package in SPDX terms and is counted in every artifact so the three
// numbers match. Pass false only for a strictly third-party-only view.
export function collectComponents(cdx, { includeRoot = true } = {}) {
  const out = [];
  const seen = new Set();
  const collect = (c) => {
    if (!c) return;
    const r = refOf(c);
    if (!seen.has(r)) { seen.add(r); out.push(c); }
    (c.components || []).forEach(collect);
  };
  if (includeRoot) collect(cdx.metadata?.component);
  else (cdx.metadata?.component?.components || []).forEach(collect);
  (cdx.components || []).forEach(collect);
  return out;
}

// The license id/expression list for a component, as authored in the BOM.
export const licenseIdsOf = (c) => (c.licenses || [])
  .map((l) => l.license?.id || l.expression || l.license?.name || '')
  .filter(Boolean);
