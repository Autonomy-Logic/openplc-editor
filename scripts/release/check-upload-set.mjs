#!/usr/bin/env node
import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { compareNames, expectedAssetNames } from './lib/release-assets.mjs'

runCli(() => {
  const { values, positionals } = parseCli({ version: { type: 'string' } }, ['version'])
  if (positionals.length !== 1) throw new CheckFailure(['usage: check-upload-set.mjs --version <version> <dir>'])
  const [dir] = positionals
  const expected = expectedAssetNames(values.version)

  const { missing, unexpected } = compareNames(readdirSync(dir), expected)
  const problems = [
    ...unexpected.map((name) => `${name}: unexpected in the upload set`),
    ...missing.map((name) => `${name}: missing from the upload set`),
    ...expected
      .filter((name) => !missing.includes(name) && !lstatSync(join(dir, name)).isFile())
      .map((name) => `${name}: not a regular file`),
  ]
  if (problems.length > 0) throw new CheckFailure([`${dir} is not exactly the six installers:`, ...problems])
  console.log(`${dir} holds exactly the six installers of ${values.version}`)
})
