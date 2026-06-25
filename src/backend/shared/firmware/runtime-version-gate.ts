/**
 * Runtime compatibility gate.
 *
 * The v4.1.x OpenPLC runtime ships the STruC++ compile pipeline.
 * The v4.0.x runtimes shipped MatIEC, which is not wire-compatible
 * with the strucpp-emitted firmware artefacts (different generated
 * file set, different debug protocol).  This module owns the
 * version parser + gate the editor calls before pushing a build to
 * a remote runtime device.
 *
 * The runtime exposes its version via:
 *   - `GET /api/version` (unauthenticated) → {"version": "v4.1.0-rc.3"}
 *   - `X-OpenPLC-Runtime-Version` response header on every response
 *
 * The string is the GitHub release tag baked in at image build time
 * (see openplc-runtime/.github/workflows/docker.yml).  Older
 * runtimes that pre-date this work return a hardcoded "v4" string;
 * that's intentionally unparseable here so the gate blocks them.
 *
 * Shared by both openplc-editor (which uploads to remote runtimes)
 * and openplc-web (which gates push-to-device through the
 * orchestrator-agent the same way).
 */

/** Minimum runtime version that speaks the STruC++ wire format. */
export const MIN_STRUCPP_RUNTIME_VERSION = '4.1.0'

export interface ParsedRuntimeVersion {
  major: number
  minor: number
  patch: number
  /** Pre-release identifier (e.g. `rc.3`) if present, otherwise undefined. */
  prerelease?: string
}

/**
 * Parses a runtime version string.  Returns null when the string
 * doesn't carry enough information to compare against
 * `MIN_STRUCPP_RUNTIME_VERSION` — e.g. the legacy `"v4"` or `"dev"`
 * builds.  Callers treat null as "incompatible".
 */
export function parseRuntimeVersion(raw: string | null | undefined): ParsedRuntimeVersion | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  // Require all three numeric components — `v4` alone is the legacy
  // hardcoded header and must be rejected.
  const match = trimmed.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  }
}

/**
 * Returns true iff the runtime version string represents a runtime
 * that speaks the STruC++ wire format (i.e. ≥ 4.1.0, including
 * pre-release tags like `v4.1.0-rc.3`).
 *
 * Note: by strict semver, `4.1.0-rc.3 < 4.1.0`.  We deliberately
 * deviate here because the rc tags on the v4.1.0 line ARE the
 * builds shipping STruC++ — there is no "older 4.1.0" the rc lineage
 * would be a pre-release of.
 */
export function isStrucppCompatibleRuntime(raw: string | null | undefined): boolean {
  const v = parseRuntimeVersion(raw)
  if (!v) return false
  if (v.major > 4) return true
  if (v.major < 4) return false
  // major === 4: minor must be ≥ 1 (i.e. v4.1.x is the strucpp line).
  // patch + prerelease don't matter past that.
  return v.minor >= 1
}

/**
 * Human-readable explanation suitable for surfacing as an error
 * when the gate rejects a runtime.  The reported version (or
 * "unknown") is included so the user can match it to the device.
 */
export function describeIncompatibleRuntime(raw: string | null | undefined): string {
  const reported = raw && raw.trim().length > 0 ? raw.trim() : 'unknown'
  return (
    `Runtime version ${reported} is not compatible with this editor.  ` +
    `Upload requires OpenPLC Runtime v${MIN_STRUCPP_RUNTIME_VERSION} or newer (STruC++ pipeline).  ` +
    `Please upgrade the runtime on the target device before pushing this build.`
  )
}
