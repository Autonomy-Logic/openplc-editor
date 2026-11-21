// Severity verdict and advisory index shared by pr-gate-diff, build-report and
// scan-vulns. Repository-agnostic: copied byte-identical across repositories.

// Unit: one OSV alias group per package name. Severity is the highest parsable
// severity of any member or of the group's max_severity, else UNKNOWN.

export const ORDER = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
export const UNKNOWN = 'UNKNOWN';
// Display order, most severe first; UNKNOWN last.
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', UNKNOWN];
// -1 for UNKNOWN, so it never reaches any threshold.
export const rank = (sev) => ORDER.indexOf(sev);

// OSV/NVD say MEDIUM; the reports say MODERATE.
export const normWord = (w) => (w === 'MEDIUM' ? 'MODERATE' : w);

// CVSS v3.1 Roundup (spec Appendix A), over integers scaled by 100000 so float
// error cannot push a score across the 7.0 / 9.0 boundaries.
export function roundup(input) {
  const i = Math.round(input * 100000);
  if (i % 10000 === 0) return i / 100000;
  return (Math.floor(i / 10000) + 1) / 10;
}

// CVSS v3.x base score (FIRST.org v3.1 spec, section 7.1). null if unparsable.
export function cvss3Base(vector) {
  const m = {};
  for (const kv of String(vector).split('/')) { const [k, v] = kv.split(':'); if (k && v) m[k] = v; }
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const AC = { L: 0.77, H: 0.44 }[m.AC];
  const UI = { N: 0.85, R: 0.62 }[m.UI];
  const scopeChanged = m.S === 'C';
  const PR = (scopeChanged ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 })[m.PR];
  const imp = { N: 0, L: 0.22, H: 0.56 };
  const C = imp[m.C], I = imp[m.I], A = imp[m.A];
  if ([AV, AC, UI, PR, C, I, A].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - C) * (1 - I) * (1 - A);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  if (impact <= 0) return 0;
  const expl = 8.22 * AV * AC * PR * UI;
  return roundup(Math.min((scopeChanged ? 1.08 : 1) * (impact + expl), 10));
}

export const bucketFromScore = (s) => (s >= 9 ? 'CRITICAL' : s >= 7 ? 'HIGH' : s >= 4 ? 'MODERATE' : 'LOW');

const maxSev = (list) => list.reduce((best, s) => (rank(s) > rank(best) ? s : best), UNKNOWN);

// Severity of ONE OSV record: its qualitative word, else the highest CVSS v3.x
// vector it carries. CVSS 4.0 vectors are not scored here. UNKNOWN if neither.
export function severityOf(v) {
  const word = normWord(String(v?.database_specific?.severity || '').toUpperCase());
  if (ORDER.includes(word)) return word;
  const scored = [];
  for (const s of (v?.severity || [])) {
    const score = String(s.score || '');
    if (s.type === 'CVSS_V3' || score.startsWith('CVSS:3')) {
      const sc = cvss3Base(score);
      if (sc != null) scored.push(bucketFromScore(sc));
    }
  }
  return maxSev(scored);
}

// osv-scanner's group max_severity is a numeric score as a string; '' or 0 means none.
function groupScoreSeverity(group) {
  const raw = group?.max_severity;
  const sc = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(sc) && sc > 0 ? bucketFromScore(sc) : UNKNOWN;
}

// Severity of an alias group: the highest of every member's own severity and of
// each osv-scanner group max_severity covering it.
export function severityOfGroup(vulns, groups = []) {
  return maxSev([...vulns.map(severityOf), ...groups.map(groupScoreSeverity)]);
}

// Package names compare case-insensitively, PyPI-style separators folded; the
// ecosystem compares on its base name (`Debian:12` -> `debian`).
const normPkg = (n) => String(n ?? '').toLowerCase().replace(/[-_.]+/g, '-');
const normEco = (e) => String(e ?? '').split(':')[0].toLowerCase();

// Fix versions of an OSV record. With `pkg`, only from the affected[] entries of
// that package (and ecosystem, when both sides name one); one record can cover
// several packages. If no entry names the package, every entry is used.
export function fixedOf(v, pkg, ecosystem) {
  const all = v?.affected || [];
  const mine = pkg === undefined ? all : all.filter((a) => normPkg(a.package?.name) === normPkg(pkg)
    && (!ecosystem || !a.package?.ecosystem || normEco(a.package.ecosystem) === normEco(ecosystem)));
  return [...new Set((mine.length ? mine : all).flatMap((a) => (a.ranges || [])
    .flatMap((r) => (r.events || []).filter((e) => e.fixed).map((e) => e.fixed))))];
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// One entry per (alias group, package name) across all scanned sources. Records
// join a group when they share an id or alias, or an osv-scanner `groups` entry.
// Key `${id}|${pkg}`; id is the first GHSA id, else the first id.

// Entry fields: ids = OSV record ids in the group, aliases = every name the group
// is known by, versions / fixedVersions = installed / fixed versions. Compare scans with
// introducedAdvisories(), which matches on any alias.
export function indexAdvisories(data) {
  const perPkg = new Map();
  for (const r of (data?.results || [])) for (const p of (r.packages || [])) {
    const pkg = p.package?.name || '?';
    if (!perPkg.has(pkg)) perPkg.set(pkg, { occ: [], groups: [], eco: p.package?.ecosystem || '' });
    const slot = perPkg.get(pkg);
    for (const v of (p.vulnerabilities || [])) if (v?.id) slot.occ.push({ v, ver: p.package?.version || '' });
    for (const g of (p.groups || [])) slot.groups.push(g);
  }

  const m = new Map();
  for (const [pkg, { occ, groups, eco }] of perPkg) {
    const parent = new Map();
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x);
      while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
      return x;
    };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const { v } of occ) { find(v.id); for (const a of (v.aliases || [])) if (a) union(v.id, a); }
    for (const g of groups) {
      const names = [...(g.ids || []), ...(g.aliases || [])].filter(Boolean);
      for (const n of names.slice(1)) union(names[0], n);
    }

    const comps = new Map();
    for (const o of occ) {
      const root = find(o.v.id);
      if (!comps.has(root)) comps.set(root, []);
      comps.get(root).push(o);
    }
    const namesOf = new Map();
    for (const n of parent.keys()) {
      const root = find(n);
      if (!namesOf.has(root)) namesOf.set(root, new Set());
      namesOf.get(root).add(n);
    }

    for (const [root, members] of comps) {
      const byId = new Map();
      for (const { v } of members) if (!byId.has(v.id)) byId.set(v.id, v);
      const ids = [...byId.keys()].sort();
      const id = ids.find((x) => /^GHSA-/i.test(x)) || ids[0];
      const aliases = [...namesOf.get(root)].sort();
      const vulns = [...byId.values()];
      const myGroups = groups.filter((g) => [...(g.ids || []), ...(g.aliases || [])].some((n) => namesOf.get(root).has(n)));
      const rep = byId.get(id);
      const fixedVersions = [...new Set([rep, ...vulns].flatMap((v) => fixedOf(v, pkg, eco)))];
      const versions = [...new Set(members.map((o) => o.ver).filter(Boolean))].sort();
      m.set(`${id}|${pkg}`, {
        key: `${id}|${pkg}`, id, ids, aliases, pkg,
        sev: severityOfGroup(vulns, myGroups),
        versions, ver: versions.join(' | '),
        fixedVersions, fixed: fixedVersions.join(', '),
        summary: oneLine(rep.summary || vulns.find((v) => v.summary)?.summary || '').slice(0, 140),
      });
    }
  }
  return m;
}

// Entries of headIdx with no alias in common with any baseIdx entry of the same
// package: the advisories a change introduces.
export function introducedAdvisories(baseIdx, headIdx) {
  const known = new Set();
  for (const a of baseIdx.values()) for (const n of a.aliases) known.add(`${n.toUpperCase()}|${a.pkg}`);
  return [...headIdx.values()].filter((a) => !a.aliases.some((n) => known.has(`${n.toUpperCase()}|${a.pkg}`)));
}

// True when any name of the entry is in the claimed set (upper-cased ids).
export const isClaimed = (entry, claimed) => entry.aliases.some((n) => claimed.has(n.toUpperCase()));

export const bySeverity = (a, b) => rank(b.sev) - rank(a.sev) || a.pkg.localeCompare(b.pkg) || a.id.localeCompare(b.id);

export function tallyBySeverity(index) {
  const bySev = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const a of index.values()) bySev[a.sev]++;
  return { total: index.size, bySev };
}

export const sevStr = (b) => `${b.CRITICAL} critical · ${b.HIGH} high · ${b.MODERATE} moderate · ${b.LOW} low`
  + (b.UNKNOWN ? ` · ${b.UNKNOWN} unknown` : '');
