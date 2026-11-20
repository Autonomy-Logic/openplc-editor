import { readFileSync } from 'node:fs'

import { CheckFailure } from './cli.mjs'

/** A release tag: `v<major>.<minor>.<patch>`, optionally followed by `-rehearsal`. */
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)(-rehearsal)?$/

/** An editor version: `<major>.<minor>.<patch>`. */
export const VERSION = /^\d+\.\d+\.\d+$/

/** A prerelease editor version: `<major>.<minor>.<patch>-<prerelease>`, dot-separated identifiers, no build metadata. */
export const PRERELEASE_VERSION = /^\d+\.\d+\.\d+-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/

/**
 * Why `version` has none of the accepted forms; null when it has one.
 * @param {string} version
 * @param {{ allowPrerelease?: boolean }} [options] `allowPrerelease` also accepts `PRERELEASE_VERSION`.
 * @returns {string | null} `"<version>" is not <the accepted forms>`.
 */
export function versionFormProblem(version, { allowPrerelease = false } = {}) {
  if (VERSION.test(String(version))) return null
  if (!allowPrerelease) return `${JSON.stringify(version)} is not <major>.<minor>.<patch>`
  if (PRERELEASE_VERSION.test(String(version))) return null
  return `${JSON.stringify(version)} is not <major>.<minor>.<patch> or <major>.<minor>.<patch>-<prerelease>`
}

/** A bare lowercase sha256 hex digest. */
export const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * The editor version a release tag stands for (`v4.3.5-rehearsal` -> `4.3.5`).
 * @param {string} tag
 * @returns {string}
 * @throws {Error} naming the tag when it has another form.
 */
export function versionFromReleaseTag(tag) {
  const match = RELEASE_TAG.exec(String(tag))
  if (!match) {
    throw new Error(`release tag ${JSON.stringify(tag)} is not v<major>.<minor>.<patch> or its -rehearsal form`)
  }
  return match[1]
}

/**
 * The six installer names of a release of `version`, one per platform and architecture.
 * @param {string} version
 * @param {{ allowPrerelease?: boolean }} [options] `allowPrerelease` also accepts `PRERELEASE_VERSION`.
 * @returns {string[]}
 * @throws {Error} naming the version and the accepted forms when it has none of them.
 */
export function expectedAssetNames(version, options) {
  const problem = versionFormProblem(version, options)
  if (problem !== null) throw new Error(`version ${problem}`)
  return [
    `OpenPLC.Editor-${version}.AppImage`,
    `OpenPLC.Editor-${version}-ARM64.AppImage`,
    `OpenPLC.Editor_${version}.exe`,
    `OpenPLC.Editor_${version}-ARM64.exe`,
    `OpenPLC_Editor_${version}.dmg`,
    `OpenPLC_Editor_${version}-ARM.dmg`,
  ]
}

/**
 * Compares a list of file names with the expected ones.
 * @param {string[]} actual
 * @param {string[]} expected
 * @returns {{ missing: string[], unexpected: string[], duplicated: string[] }}
 */
export function compareNames(actual, expected) {
  const seen = new Set()
  const duplicated = []
  for (const name of actual) {
    if (seen.has(name) && !duplicated.includes(name)) duplicated.push(name)
    seen.add(name)
  }
  return {
    missing: expected.filter((name) => !seen.has(name)),
    unexpected: [...seen].filter((name) => !expected.includes(name)),
    duplicated,
  }
}

/**
 * Reads a JSON file of `{ <asset name>: <bare lowercase sha256 hex> }`.
 * @param {string} path
 * @param {string[]} [names] when given, the exact names the map must hold.
 * @returns {Record<string, string>}
 * @throws {CheckFailure} naming each malformed or missing entry.
 */
export function readDigestMap(path, names) {
  const map = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new CheckFailure([`${path} is not an object of asset name to sha256`])
  }
  const problems = Object.entries(map)
    .filter(([, digest]) => typeof digest !== 'string' || !SHA256_HEX.test(digest))
    .map(([name]) => `${name}: ${path} holds no lowercase sha256 hex for it`)
  if (names) {
    const { missing, unexpected } = compareNames(Object.keys(map), names)
    problems.push(...missing.map((name) => `${name}: missing from ${path}`))
    problems.push(...unexpected.map((name) => `${name}: unexpected in ${path}`))
  }
  if (problems.length > 0) throw new CheckFailure(problems)
  return map
}
