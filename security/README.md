# Security — SBOM & Vulnerability reports (automated, monthly)

This folder holds this repository's supply-chain security deliverable: a **dated
snapshot per month** with the SBOM (CycloneDX + SPDX), the component inventory,
the annotated vulnerability register (VEX), and the human-readable report.

```
security/
├── 2026-07/                         ← a monthly snapshot (immutable once merged)
│   ├── 00-READ-ME-FIRST.md
│   ├── OpenPLC-Editor-Desktop-Security-Report.md / .html / .pdf
│   └── sbom/  → *.cdx.json · *.spdx.json · *.components.csv · vulnerabilities.csv
├── latest → 2026-07                 ← pointer to the current month
└── report-config.json               ← report DATA (VEX triage + narrative)
```

## How it runs

`.github/workflows/security-monthly.yml` runs on the **1st of each month** (and on
the manual **Run workflow** button). Per run it: regenerates the SBOM, scans
dependencies with **osv-scanner** (OSV = the same advisory source as Dependabot,
honoring the suppression baseline in `../osv-scanner.toml`), has **Claude triage
any new advisory** and update the report data, renders the report from
`report-config.json`, writes `security/<YYYY-MM>/`, and **opens a PR** for review.

The report is **generated from data** (`report-config.json` + the live SBOM), so
it never drifts from the actual dependency graph.


## Reviewing the monthly PR

- **No new advisory:** confirm the summary, approve, merge (the snapshot is archived).
- **New advisory, not exploitable:** check Claude's justification in the
  `osv-scanner.toml` diff, then merge.
- **New advisory, exploitable:** bump the dependency (separate PR) and merge the
  report that documents it.
