#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { compareNames, expectedAssetNames, readDigestMap, SHA256_HEX } from './lib/release-assets.mjs'

const USAGE = [
  'usage: release-digests.mjs before --version <v> --assets <release-assets.json> --out <original.json>',
  '       release-digests.mjs after --version <v> --assets <release-assets.json> --built <built.json> --original <original.json>',
]

/**
 * The `name -> sha256 hex` of a release's assets, read from the `assets` array of the REST release object.
 * @param {string} path
 * @param {string[]} expected
 * @returns {{ digests: Map<string, string | undefined>, problems: string[] }}
 */
function readReleaseAssets(path, expected) {
  const assets = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(assets)) throw new CheckFailure([`${path} is not the assets array of a release`])
  const names = assets.map((asset) => String(asset?.name))
  const digests = new Map(
    assets.map((asset) => {
      const digest = typeof asset?.digest === 'string' ? asset.digest : ''
      const hex = digest.startsWith('sha256:') && SHA256_HEX.test(digest.slice(7)) ? digest.slice(7) : undefined
      return [String(asset?.name), hex]
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
    ...expected.filter((name) => digests.has(name) && !digests.get(name)).map((name) => `${name}: no sha256 digest`),
  )
  if (problems.length > 0) {
    throw new CheckFailure([`release assets in ${values.assets} are not the six installers:`, ...problems])
  }
  writeFileSync(
    values.out,
    `${JSON.stringify(Object.fromEntries(expected.map((name) => [name, digests.get(name)])), null, 2)}\n`,
  )
  console.log(`recorded the sha256 of the six installers in ${values.out}`)
}

/** Checks that a release holds exactly the six installers, each with its build digest and none with its original. */
function after(values, expected) {
  const built = readDigestMap(values.built, expected)
  const original = readDigestMap(values.original, expected)
  const { digests, problems } = readReleaseAssets(values.assets, expected)
  for (const name of expected) {
    if (!digests.has(name)) continue
    const digest = digests.get(name)
    if (!digest) problems.push(`${name}: no sha256 digest`)
    else if (digest === original[name]) problems.push(`${name}: still carrying its original digest`)
    else if (digest !== built[name]) problems.push(`${name}: digest differs from the build`)
  }
  if (problems.length > 0) {
    throw new CheckFailure([`release assets in ${values.assets} fail the digest check:`, ...problems])
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
