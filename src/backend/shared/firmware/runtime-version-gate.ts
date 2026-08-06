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

// Relative import on purpose: `npm run validate:arch` only inspects relative
// specifiers, so this path is actually checked against the layer rules —
// `backend-shared -> utils` is allowed, and using `@root/` here would have
// skipped the check rather than passed it.
import type { ParsedVersion } from '../../../frontend/utils/semver'
import { parseVersionStrict } from '../../../frontend/utils/semver'

/**
 * Oldest runtime this editor will upload to — the editor's own
 * `minRuntimeVersion` declaration (DOPE-448).  4.1.0 is the floor
 * because that is where the STruC++ pipeline landed.
 *
 * `MIN_STRUCPP_RUNTIME_VERSION` is kept as an alias so existing call
 * sites and their tests keep working; new code should use the plain
 * name, which says what the constant is rather than why it was
 * introduced.
 */
export const MIN_RUNTIME_VERSION = '4.1.0'

/** @deprecated Use `MIN_RUNTIME_VERSION`. */
export const MIN_STRUCPP_RUNTIME_VERSION = MIN_RUNTIME_VERSION

/** @deprecated Use `ParsedVersion` from `shared/utils/version-compare`. */
export type ParsedRuntimeVersion = ParsedVersion

/**
 * Parses a runtime version string.  Returns null when the string
 * doesn't carry enough information to compare — e.g. the legacy `"v4"`
 * or `"dev"` builds.  Callers treat null as "incompatible".
 *
 * Delegates to the shared strict parser so the VPP surface and the
 * runtime gates can never drift apart on what `"v4"` or `"4.1"` means.
 */
export function parseRuntimeVersion(raw: string | null | undefined): ParsedRuntimeVersion | null {
  return parseVersionStrict(raw)
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

/** Minimum runtime version that ships the user-management API
 *  (roles, whoami, unified update-user, delete/last-admin guards). */
export const MIN_USER_MANAGEMENT_RUNTIME_VERSION = '4.1.9'

/**
 * Returns true iff the runtime version string represents a runtime
 * that ships the user-management API (≥ 4.1.9). Older runtimes lack
 * `whoami` / `update-user` and the RBAC guards, so the editor hides
 * the User Management screen for them. Pre-release tags on the target
 * patch (e.g. `v4.1.9-rc.1`) count as capable, matching the strucpp
 * gate's treatment of the rc lineage.
 */
export function isUserManagementCapableRuntime(raw: string | null | undefined): boolean {
  const v = parseRuntimeVersion(raw)
  if (!v) return false
  if (v.major !== 4) return v.major > 4
  if (v.minor !== 1) return v.minor > 1
  return v.patch >= 9
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
    `Upload requires OpenPLC Runtime v${MIN_RUNTIME_VERSION} or newer (STruC++ pipeline).  ` +
    `Please upgrade the runtime on the target device before pushing this build.`
  )
}

/**
 * The other direction: this runtime declared a `minEditorVersion` at
 * `GET /api/capabilities` and this editor is below it.
 *
 * Names both versions and the single action that fixes it — a bare
 * "incompatible versions" turns into a support ticket.
 */
export function describeEditorTooOldForRuntime(args: {
  runtimeVersion: string | null | undefined
  minEditorVersion: string
  editorVersion: string
  deviceLabel?: string
}): string {
  const runtime = args.runtimeVersion?.trim() ?? 'unknown'
  const where = args.deviceLabel ? ` on ${args.deviceLabel}` : ''
  return (
    `Runtime ${runtime}${where} requires OpenPLC Editor ${args.minEditorVersion} or newer.  ` +
    `This editor is ${args.editorVersion}.  ` +
    `Update the editor, or connect to a runtime that accepts ${args.editorVersion}.`
  )
}

/**
 * The VPP providing the selected board declares a runtime floor the
 * connected runtime does not meet.
 *
 * Names the package's board rather than the package id — the board is
 * what the user picked and recognises.
 */
export function describeVppRuntimeMismatch(args: {
  boardTarget: string
  minRuntimeVersion: string
  runtimeVersion: string | null | undefined
  deviceLabel?: string
}): string {
  const runtime = args.runtimeVersion?.trim() ?? 'unknown'
  const where = args.deviceLabel ? `The runtime at ${args.deviceLabel} reports` : 'The connected runtime reports'
  return (
    `Board "${args.boardTarget}" requires OpenPLC Runtime v${args.minRuntimeVersion} or newer.  ` +
    `${where} ${runtime}.  ` +
    `Upgrade the runtime on that device, or select a board supported by ${runtime}.`
  )
}
