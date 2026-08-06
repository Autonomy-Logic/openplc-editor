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
 * the inputs that show up in the field — `"v4"` and `"4.1"` parsed in one and
 * were rejected by the other — and a first pass at unifying them kept that
 * split alive as a lenient parser and a strict parser chosen by name.
 *
 * That was still one parser too many. The same string has to mean the same
 * thing everywhere, or a floor is enforced in one place and ignored in
 * another: `minEditorVersion: "4.3"` refused an install while the identical
 * value from a runtime sailed through unnoticed. So there is now exactly
 * ONE parser, and it applies one rule:
 *
 *   - a `v` prefix is decoration:   `v4.3.2` === `4.3.2`
 *   - a missing component is zero:  `4.3` === `4.3.0`,  `4` === `4.0.0`
 *   - anything else is UNKNOWN:     `"dev"`, `"garbage"`, `""` → null
 *
 * "Unknown" is never a version. It does not become 0.0.0 behind the caller's
 * back and it never satisfies a declared floor — a peer that cannot say what
 * it is does not get to claim it is new enough.
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

/**
 * `4`, `4.3`, `4.3.2`, `v4.3.2`, `4.3.2-rc.1`, `4.3.2+build.5`.
 *
 * Anchored at both ends on purpose: a trailing-garbage input like `"4.1 beta"`
 * must fail rather than silently parse as `4.1.0`, because a value nobody can
 * read is a mistake worth surfacing, not a version worth guessing.
 */
const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.+))?$/

/** Lowest possible version — what an unknown string is worth in a total order. */
const ZERO: ParsedVersion = { major: 0, minor: 0, patch: 0 }

/**
 * Parse a version string, or return null when the string is not a version.
 *
 * Missing trailing components are zero, so a floor written as `"4.3"` means
 * exactly what `"4.3.0"` means and is enforced identically. A leading `v` is
 * stripped. Everything else — `"dev"`, `"garbage"`, `""`, `"4.1 beta"`, null —
 * is UNKNOWN, and callers decide what unknown costs them.
 */
export function parseVersion(raw: string | null | undefined): ParsedVersion | null {
  if (!raw) return null
  const match = raw.trim().match(VERSION_RE)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: match[2] === undefined ? 0 : Number.parseInt(match[2], 10),
    patch: match[3] === undefined ? 0 : Number.parseInt(match[3], 10),
    prerelease: match[4],
  }
}

/** True when `raw` is a version this codebase can compare. */
export function isValidVersion(raw: string | null | undefined): boolean {
  return parseVersion(raw) !== null
}

/**
 * A version string as it should appear in a message to the user: trimmed, or
 * the word `unknown` when there is nothing readable to show.
 *
 * Exists so that every "incompatible versions" message renders an unreadable
 * peer the same way. Printing an empty string leaves a hole in the sentence
 * ("Runtime  on 10.0.0.1 requires…") and tells the user nothing about which
 * of the two versions the editor failed to establish.
 */
export function formatVersionForDisplay(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : 'unknown'
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
 * `candidate >= minimum` — the one comparison every DOPE-448 gate asks.
 *
 * Three inputs and what each costs:
 *
 *   - `minimum` absent or empty → **pass**. A peer that declares no floor
 *     constrains nothing; this is every runtime predating `/api/capabilities`
 *     and it is what makes shipping the gates safe.
 *   - `minimum` present but unreadable → **pass**, because an unknown floor is
 *     worth 0.0.0 and everything clears 0.0.0. Callers that can see the string
 *     should say so out loud rather than let it vanish — the manifest schema
 *     rejects such a value outright, and the runtime probe logs a warning.
 *   - `candidate` unreadable against a real floor → **fail**. An unknown
 *     version never satisfies a declared minimum.
 */
export function isVersionAtLeast(candidate: string | null | undefined, minimum: string | null | undefined): boolean {
  const min = parseVersion(minimum)
  if (!min) return true
  const version = parseVersion(candidate)
  if (!version) return false
  return compareParsedVersions(version, min) >= 0
}

/**
 * Order two version strings for display purposes — sorting catalog rows,
 * deciding whether an available version is newer than the installed one.
 *
 * This is the ONE place an unknown version is coerced to 0.0.0, because a
 * sortable list needs a total order and a corrupt `version` field in somebody
 * else's manifest should sort to the bottom rather than break the UI. Nothing
 * is gated on the result. Every gate uses `isVersionAtLeast`.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  return compareParsedVersions(parseVersion(a) ?? ZERO, parseVersion(b) ?? ZERO)
}

/**
 * True when `current` satisfies the `minRequired` a package declares.
 *
 * Delegates to `isVersionAtLeast` so the install gate and the runtime gates
 * cannot disagree about what a given string means — the bug this consolidation
 * exists to prevent.
 */
export function isCompatibleEditorVersion(minRequired: string | undefined, current: string): boolean {
  return isVersionAtLeast(current, minRequired)
}
