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
# Standards satisfied: NTIA "Minimum Elements for an SBOM" and EO 14028.
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

echo "==> Generating CycloneDX 1.6 SBOM (cdxgen, -t $TYPE) for ${NAME}@${VERSION:-unversioned}"
# cdxgen can exceed Node's default ~2 GB heap on a large pnpm monorepo (SIGABRT /
# exit 134 in CI). Raise the old-space limit; harmless on machines with less RAM.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=6144"
FETCH_LICENSE=true npx --yes @cyclonedx/cdxgen@11 \
  -t "$TYPE" \
  --spec-version 1.6 \
  -o "$OUT/$NAME.cdx.json" \
  --project-name "$NAME" \
  ${VERSION:+--project-version "$VERSION"} \
  . 2>/dev/null

echo "==> Converting to SPDX 2.3"
node scripts/cdx-to-spdx.mjs "$OUT/$NAME.cdx.json" "$OUT/$NAME.spdx.json"

echo "==> Emitting flattened CSV"
NAME="$NAME" OUT="$OUT" node -e '
const fs=require("fs");
const name=process.env.NAME, out=process.env.OUT;
const b=require(`./${out}/${name}.cdx.json`);
const esc=s=>{s=String(s==null?"":s);return /[",\n]/.test(s)?"\""+s.replace(/"/g,"\"\"")+"\"":s;};
const rows=[["name","version","type","purl","license"]];
for(const c of (b.components||[])){
  const lic=(c.licenses||[]).map(l=>l.license?.id||l.expression||l.license?.name||"").join(" / ");
  rows.push([(c.group?c.group+"/":"")+c.name,c.version||"",c.type||"",c.purl||"",lic]);
}
fs.writeFileSync(`${out}/${name}.components.csv`,rows.map(r=>r.map(esc).join(",")).join("\n"));
console.log(`Wrote ${out}/${name}.components.csv:`,rows.length-1,"components");
'

echo "==> Done. Artifacts in ./$OUT/"
ls -la "$OUT"
