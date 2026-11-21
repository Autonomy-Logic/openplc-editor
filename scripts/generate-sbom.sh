#!/usr/bin/env bash
#
# generate-sbom.sh — Reproducible Software Bill of Materials for this project.
#
# Portable: derives the project name and package-manager from the repo itself
# (no hardcoded product name). Produces three artifacts under ./sbom/:
#   - <name>.cdx.json        CycloneDX 1.6  (canonical, security/VEX-oriented — OWASP)
#   - <name>.spdx.json       SPDX 2.3       (ISO/IEC 5962 — procurement/compliance)
#   - <name>.components.csv  flattened component list (human-readable)
#
# Supplier is filled only where the package metadata names one (NOASSERTION otherwise).
# Source of truth: the committed lockfile (fully-resolved dependency graph).
#
# Usage:  ./scripts/generate-sbom.sh
# CI:     run on every release tag; commit/attach the artifacts to the release.

set -euo pipefail
cd "$(dirname "$0")/.."

NAME="$(node -p "require('./package.json').name" 2>/dev/null || basename "$PWD")"
VERSION="$(node -p "require('./package.json').version || ''" 2>/dev/null || echo "")"

# Auto-detect the package manager / cdxgen project type from the lockfile.
if [ -f pnpm-lock.yaml ]; then TYPE=pnpm
elif [ -f package-lock.json ]; then TYPE=npm
elif [ -f yarn.lock ]; then TYPE=yarn
else TYPE=js; fi

OUT="sbom"
mkdir -p "$OUT"

# Pinned so the SBOM is reproducible. Keep the version in ONE place and never
# paste it through a rendered web page: a previous edit turned the `cdxgen@…`
# reference into Cloudflare's email-obfuscation placeholder
# ("@cyclonedx/[email protected]"), which made this script abort on
# every run — invisibly, because the diagnostic was being sent to /dev/null.
CDXGEN_VERSION="11.11.0"

echo "==> Generating CycloneDX 1.6 SBOM (cdxgen ${CDXGEN_VERSION}, -t $TYPE) for ${NAME}@${VERSION:-unversioned}"
# cdxgen can exceed Node's default ~2 GB heap on a large pnpm monorepo (SIGABRT /
# exit 134 in CI). Raise the old-space limit; harmless on machines with less RAM.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=6144"
# stderr is kept (it used to be discarded): cdxgen is noisy, but swallowing it
# means a failure here leaves no trace of WHY the whole pipeline produced nothing.
FETCH_LICENSE=true npx --yes "@cyclonedx/cdxgen@${CDXGEN_VERSION}" \
  -t "$TYPE" \
  --spec-version 1.6 \
  -o "$OUT/$NAME.cdx.json" \
  --project-name "$NAME" \
  ${VERSION:+--project-version "$VERSION"} \
  .

# CONTENT gate, not just a shape check — see scripts/assert-sbom.mjs. Nothing
# downstream can tell an empty BOM from a clean one, so the run stops here.
echo "==> Validating the SBOM has real content"
node scripts/assert-sbom.mjs "$OUT/$NAME.cdx.json" "${MIN_COMPONENTS:-50}"

echo "==> Converting to SPDX 2.3"
node scripts/cdx-to-spdx.mjs "$OUT/$NAME.cdx.json" "$OUT/$NAME.spdx.json"

echo "==> Emitting flattened CSV"
node scripts/cdx-to-csv.mjs "$OUT/$NAME.cdx.json" "$OUT/$NAME.components.csv"

echo "==> Done. Artifacts in ./$OUT/"
ls -la "$OUT"
