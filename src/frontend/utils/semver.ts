/**
 * Single source of truth for comparing OpenPLC version strings.
 *
 * Four independent compatibility questions are decided by comparing two
 * version strings (DOPE-448):
 *
 *   1. is this runtime new enough for this editor?    (`MIN_RUNTIME_VERSION`)
 *   2. is this editor new enough for this runtime?    (`minEditorVersion` from
 *                                                      `GET /api/capabilities`)
 *   3. is this editor new enough for this VPP?        (`package.minEditorVersion`)
 *   4. is this runtime new enough for this VPP?       (`package.minRuntimeVersion`)
 *
 * This file used to answer only #3, with `firmware/runtime-version-gate.ts`
 * carrying its own parser for the runtime side. The two disagreed on exactly
 * the inputs that show up in the field:
 *
 *   input        | catalog parser   | runtime parser
 *   -------------|------------------|----------------
 *   "v4"         | 4.0.0            | rejected
 *   "4.1"        | 4.1.0            | rejected
 *   "garbage"    | 0.0.0 (lowest)   | rejected
 *
 * Neither behaviour was wrong for its own caller. A package manifest carrying
 * a corrupt version should not crash the catalog UI, and an unidentifiable
 * runtime must not receive an upload. What was wrong is that the DIFFERENCE
 * lived in two separate parsers, where nothing named it and nothing tested it
 * side by side.
 *
 * So: one parse, one comparison, and the lenient-vs-strict choice made
 * explicitly by name at the call site. `parseVersionStrict` returns null for
 * anything it cannot fully identify — callers that must fail closed use it.
 * `parseVersionLenient` fills missing components with 0 and degrades garbage to
 * 0.0.0 — callers rendering untrusted metadata use it.
 *
 * Pre-release and build suffixes (`-rc.1`, `+build.5`) are parsed but do NOT
 * affect ordering: `4.1.0-rc.3` compares equal to `4.1.0`. This is deliberate
 * and load-bearing for the runtime gate — the rc tags on a version line ARE
 * the builds shipping that line's features, so treating them as "less than"
 * the release (strict semver's rule) would reject runtimes that work.
 *
 * Lives in `frontend/utils/` rather than `backend/shared/` on purpose: the
 * architecture rules let `backend-shared` import `utils` but not the reverse,
 * and both the VPP surface and the runtime gate need this. No layer exception
 * required.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Pre-release identifier (e.g. `rc.3`) when present. Never affects ordering. */
  prerelease?: string
}

/** `v4.1.0-rc.3` / `4.1.0` — all three numeric components required. */
const STRICT_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/

/**
 * Parse a version string, requiring all three numeric components.
 *
 * Returns null for anything else — `"v4"`, `"4.1"`, `"dev"`, `""`, null. Use
 * this when an unidentifiable version must block an action: the caller cannot
 * accidentally treat "I don't know" as "old enough" or "new enough", because
 * there is no number to compare.
 */
export function parseVersionStrict(raw: string | null | undefined): ParsedVersion | null {
  if (!raw) return null
  const match = raw.trim().match(STRICT_RE)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4],
  }
}

/**
 * Parse a version string, filling in whatever is missing with zero.
 *
 * `"4.1"` becomes 4.1.0; `"garbage"` and `""` become 0.0.0 — the lowest
 * possible version, so a corrupt value loses every comparison instead of
 * winning one. Use this for untrusted metadata being rendered rather than
 * enforced, where a malformed field should degrade the display and not throw.
 */
export function parseVersionLenient(raw: string | null | undefined): ParsedVersion {
  // Deliberately unanchored at the end: it consumes as many leading numeric
  // components as it finds and ignores whatever follows, so `4.1.9-rc.1` and
  // `4.1` both parse without a separate suffix-stripping pass.
  const match = (raw ?? '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return { major: 0, minor: 0, patch: 0 }
  const toInt = (value: string | undefined): number => {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return { major: toInt(match[1]), minor: toInt(match[2]), patch: toInt(match[3]) }
}

/**
 * Order two parsed versions. Pre-release suffixes are ignored (see the module
 * comment) — only the numeric triple decides.
 */
export function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
  return 0
}

/**
 * `candidate >= minimum`, where an unparseable `candidate` fails closed.
 *
 * This is the shape every DOPE-448 gate wants: "may I proceed?" answered
 * `false` when the peer cannot be identified. An absent `minimum` means no
 * constraint was declared, which is a pass — a peer that asks for nothing gets
 * nothing enforced, which is what keeps runtimes predating
 * `/api/capabilities` working unchanged.
 */
export function isVersionAtLeast(candidate: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!minimum) return true
  const min = parseVersionStrict(minimum)
  if (!min) return true // a floor we cannot read declares nothing
  const version = parseVersionStrict(candidate)
  if (!version) return false // an unidentifiable peer never clears a real floor
  return compareParsedVersions(version, min) >= 0
}

// ---------------------------------------------------------------------------
// Lenient VPP-surface helpers
// ---------------------------------------------------------------------------

/**
 * Lenient comparison, used by the VPP catalog and the package install gate.
 *
 * Lenient is right *here* specifically: a package manifest is untrusted
 * third-party metadata, and a corrupt `version` string should sort as the
 * lowest possible version rather than break a card in the catalog UI. Gates
 * deciding whether to talk to a runtime use `isVersionAtLeast` instead.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  return compareParsedVersions(parseVersionLenient(a), parseVersionLenient(b))
}

/**
 * True when `current` satisfies `minRequired`. An absent or empty minimum
 * means the package declared no floor, which is a pass.
 */
export function isCompatibleEditorVersion(minRequired: string | undefined, current: string): boolean {
  if (!minRequired) return true
  return compareSemver(current, minRequired) >= 0
}
