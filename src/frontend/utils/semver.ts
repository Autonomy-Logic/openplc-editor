/**
 * Tiny semver helpers used by the VPP catalog browser to compare a package
 * version's `minEditorVersion` against the running editor's `APP_VERSION`.
 *
 * Intentionally local — adding the full `semver` npm dependency for two
 * comparisons would inflate the renderer bundle for no real gain. Pre-release
 * suffixes (`-rc.1`, `+build.5`) are stripped before parsing; this matches
 * what arduino-cli does when matching boards.txt menu constraints, and we
 * don't currently publish pre-release VPPs.
 *
 * Malformed strings degrade to `0.0.0` so a corrupt manifest in the wild
 * doesn't crash the UI — it just compares as the lowest possible version.
 */

type Triple = readonly [number, number, number]

function parseSemver(input: string): Triple {
  const stripped = input.split(/[-+]/)[0]
  const parts = stripped.split('.')
  const major = Number.parseInt(parts[0] ?? '', 10)
  const minor = Number.parseInt(parts[1] ?? '', 10)
  const patch = Number.parseInt(parts[2] ?? '', 10)
  return [Number.isFinite(major) ? major : 0, Number.isFinite(minor) ? minor : 0, Number.isFinite(patch) ? patch : 0]
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseSemver(a)
  const [bMajor, bMinor, bPatch] = parseSemver(b)
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
  return 0
}

export function isCompatibleEditorVersion(minRequired: string | undefined, current: string): boolean {
  if (!minRequired) return true
  return compareSemver(current, minRequired) >= 0
}
