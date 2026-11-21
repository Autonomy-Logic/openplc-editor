#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { compareNames, expectedAssetNames, readDigestMap, SHA256_HEX } from './lib/release-assets.mjs'

const USAGE = [
  'usage: release-digests.mjs before --version <v> --assets <release-assets.json> --out <original.json>',
  '       release-digests.mjs after --version <v> --assets <release-assets.json> --built <built.json> --original <original.json>',
]

/** Exit status of `after` when its only problems are digests of the six installers GitHub has not computed yet. */
const PENDING_DIGEST_EXIT = 3

/**
 * The digest of each of a release's assets, read from the `assets` array of the REST release object: `hex` is the
 * sha256 hex of a `sha256:<hex>` digest, and `pending` is true when the `digest` field is absent or null.
 * @param {string} path
 * @param {string[]} expected
 * @returns {{ digests: Map<string, { hex: string | undefined, pending: boolean }>, problems: string[] }}
 */
function readReleaseAssets(path, expected) {
  const assets = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(assets)) throw new CheckFailure([`${path} is not the assets array of a release`])
  const names = assets.map((asset) => String(asset?.name))
  const digests = new Map(
    assets.map((asset) => {
      const pending = asset?.digest === undefined || asset?.digest === null
      const digest = typeof asset?.digest === 'string' ? asset.digest : ''
      const hex = digest.startsWith('sha256:') && SHA256_HEX.test(digest.slice(7)) ? digest.slice(7) : undefined
      return [String(asset?.name), { hex, pending }]
    }),
  )
  const { missing, unexpected, duplicated } = compareNames(names, expected)
  const problems = [
    ...missing.map((name) => `${name}: missing`),
    ...unexpected.map((name) => `${name}: unexpected`),
    ...duplicated.map((name) => `${name}: listed more than once`),
  ]
  return { digests, problems }
}

/** Records the sha256 of the six installers a release holds before they are replaced. */
function before(values, expected) {
  const { digests, problems } = readReleaseAssets(values.assets, expected)
  problems.push(
    ...expected
      .filter((name) => digests.has(name) && !digests.get(name)?.hex)
      .map((name) => `${name}: no sha256 digest`),
  )
  if (problems.length > 0) {
    throw new CheckFailure([`release assets in ${values.assets} are not the six installers:`, ...problems])
  }
  writeFileSync(
    values.out,
    `${JSON.stringify(Object.fromEntries(expected.map((name) => [name, digests.get(name)?.hex])), null, 2)}\n`,
  )
  console.log(`recorded the sha256 of the six installers in ${values.out}`)
}

/**
 * Checks that a release holds exactly the six installers, each with its build digest and none with its original.
 * Exits with PENDING_DIGEST_EXIT when the only problems are installers whose digest GitHub has not computed yet.
 */
function after(values, expected) {
  const built = readDigestMap(values.built, expected)
  const original = readDigestMap(values.original, expected)
  const { digests, problems } = readReleaseAssets(values.assets, expected)
  const pending = []
  for (const name of expected) {
    const digest = digests.get(name)
    if (!digest) continue
    if (digest.pending) pending.push(`${name}: no digest computed yet`)
    else if (!digest.hex) problems.push(`${name}: no sha256 digest`)
    else if (digest.hex === original[name]) problems.push(`${name}: still carrying its original digest`)
    else if (digest.hex !== built[name]) problems.push(`${name}: digest differs from the build`)
  }
  if (problems.length > 0) {
    throw new CheckFailure([`release assets in ${values.assets} fail the digest check:`, ...problems, ...pending])
  }
  if (pending.length > 0) {
    throw new CheckFailure(
      [`release assets in ${values.assets} have no digest computed yet:`, ...pending],
      PENDING_DIGEST_EXIT,
    )
  }
  console.log('the release holds the six installers built by this run')
}

runCli(() => {
  const [mode, ...args] = process.argv.slice(2)
  const required = { before: ['version', 'assets', 'out'], after: ['version', 'assets', 'built', 'original'] }[mode]
  if (!required) throw new CheckFailure(USAGE)
  const options = Object.fromEntries(required.map((name) => [name, { type: 'string' }]))
  const { values, positionals } = parseCli(options, required, args)
  if (positionals.length > 0) throw new CheckFailure(USAGE)
  const expected = expectedAssetNames(values.version)
  if (mode === 'before') before(values, expected)
  else after(values, expected)
})
