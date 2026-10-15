/**
 * Strict semver ordering for the update check.
 *
 * Not `frontend/utils/semver`: that comparer treats `4.3.3-rc.1` as equal to
 * `4.3.3` on purpose (a runtime rc ships the line's features), and here the
 * difference is the whole point — an editor running rc.1 must be told about
 * rc.2.
 */

interface Version {
  core: [number, number, number]
  prerelease: string[]
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parse(value: string): Version | null {
  const match = VERSION.exec(value.trim())
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b))
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Negative when `a` is older, positive when newer, 0 when equal; `null` when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return null

  for (let index = 0; index < 3; index++) {
    const difference = left.core[index] - right.core[index]
    if (difference !== 0) return Math.sign(difference)
  }

  // A release outranks any of its prereleases.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length)
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index++) {
    const l = left.prerelease[index]
    const r = right.prerelease[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const order = compareIdentifiers(l, r)
    if (order !== 0) return order
  }
  return 0
}

/** True only when `candidate` is a readable version strictly newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return (compareVersions(candidate, current) ?? 0) > 0
}
