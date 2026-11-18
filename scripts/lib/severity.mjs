// severity.mjs — the ONE severity verdict and the ONE advisory index.
//
// Why this exists: build-report and pr-gate-diff used to disagree. For an
// advisory with no qualitative severity, the report bucketed it MODERATE while
// the gate conservatively called it HIGH and blocked the merge — so the person
// reading the report and the person trying to merge got contradictory
// information about the same advisory. They also deduped differently (report by
// `id`, gate by `id|pkg`), so one CVE hitting three packages counted as 1 in the
// report and 3 in the gate. Both now import from here: the conservative HIGH is
// the verdict everywhere, and `id|pkg` (one row per affected package, matching
// vulnerabilities.csv and osv-scanner's own output) is the unit everywhere.

export const ORDER = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

// OSV/NVD say MEDIUM; our reports say MODERATE.
export const normWord = (w) => (w === 'MEDIUM' ? 'MODERATE' : w);

// --- CVSS v3.1 base score (FIRST.org spec §7.1 "Base equations") -------------
// The magic numbers are the spec's metric weights and the Impact /
// Exploitability coefficients — verify against
// https://www.first.org/cvss/v3.1/specification-document (§7.1).

// CVSS v3.1 Roundup, Appendix A. Deliberately NOT `Math.ceil(x*10)/10`: that is
// the v3.0 formulation and its float error rounds 8.6 up to 8.7, which can flip
// a merge decision at the 7.0 / 9.0 bucket boundaries. The spec defines Roundup
// over integers scaled by 100000 precisely to avoid this.
export function roundup(input) {
  const i = Math.round(input * 100000);
  if (i % 10000 === 0) return i / 100000;
  return (Math.floor(i / 10000) + 1) / 10;
}

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

// Returns { sev, approx }. approx=true means we could not compute an exact score
// and fell back to a conservative HIGH, surfaced explicitly so it is never a
// *silent* default — in the gate's comment and in the report's untriaged table.
export function severityOf(v) {
  // 1) explicit qualitative severity (present on most GHSA advisories)
  const word = normWord((v.database_specific?.severity || '').toUpperCase());
  if (ORDER.includes(word)) return { sev: word, approx: false };
  // 2) CVSS v3.x vector → exact base score
  let sawV4 = false;
  for (const s of (v.severity || [])) {
    const score = String(s.score || '');
    if (s.type === 'CVSS_V3' || score.startsWith('CVSS:3')) {
      const sc = cvss3Base(score);
      if (sc != null) return { sev: bucketFromScore(sc), approx: false };
    }
    if (s.type === 'CVSS_V4' || score.startsWith('CVSS:4')) sawV4 = true;
  }
  // 3) CVSS 4.0-only: we deliberately do NOT hand-roll the v4 macrovector table
  //    (error-prone in a merge-deciding script). 4) no severity at all.
  //    Either way: conservative HIGH, flagged — never a silent pass, never a
  //    silent bucket.
  void sawV4;
  return { sev: 'HIGH', approx: true };
}

export function fixedOf(v) {
  return [...new Set((v.affected || []).flatMap((a) => (a.ranges || [])
    .flatMap((r) => (r.events || []).filter((e) => e.fixed).map((e) => e.fixed))))].join(', ');
}

// Index an osv-scanner JSON result set, keyed `advisoryId|package`.
//
// Keying by id AND package is what makes the gate correct: the same CVE landing
// on a *different* package in head must count as introduced, while a version
// bump of an already-vulnerable package (same id+package) must not. It is also
// one row per affected package — the same unit as vulnerabilities.csv — so the
// report's advisory counts and the gate's counts are the same quantity.
export function indexAdvisories(data) {
  const m = new Map();
  for (const r of (data?.results || [])) for (const p of (r.packages || [])) for (const v of (p.vulnerabilities || [])) {
    if (!v.id) continue;
    const pkg = p.package?.name || '?';
    const key = `${v.id}|${pkg}`;
    if (m.has(key)) continue;
    const { sev, approx } = severityOf(v);
    m.set(key, {
      id: v.id, sev, approx, pkg,
      ver: p.package?.version || '',
      fixed: fixedOf(v),
      summary: (v.summary || '').slice(0, 140),
    });
  }
  return m;
}

export function tallyBySeverity(index) {
  const bySev = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
  for (const a of index.values()) bySev[a.sev]++;
  return { total: index.size, bySev };
}

export const sevStr = (b) => `${b.CRITICAL} critical · ${b.HIGH} high · ${b.MODERATE} moderate · ${b.LOW} low`;
