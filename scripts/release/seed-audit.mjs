#!/usr/bin/env node
import { createHmac } from 'node:crypto'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { scanPaths } from './lib/trust-literals.mjs'

/**
 * The release seed: HMAC-SHA256 keyed with the UTF-8 bytes of the secret over `<version>+<commit>`.
 * @param {string} secret
 * @param {string} version
 * @param {string} commit
 * @returns {Buffer}
 */
function deriveSeed(secret, version, commit) {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${version}+${commit}`).digest()
}

runCli(() => {
  const { values, positionals } = parseCli({ version: { type: 'string' }, commit: { type: 'string' } }, [
    'version',
    'commit',
  ])
  const problems = []
  if (positionals.length === 0) problems.push('usage: seed-audit.mjs --version <v> --commit <sha> <path>...')
  if (!/^\d+\.\d+\.\d+$/.test(values.version)) {
    problems.push(`--version ${values.version} is not <major>.<minor>.<patch>`)
  }
  if (!/^[0-9a-f]{40}$/.test(values.commit)) problems.push(`--commit ${values.commit} is not a 40-character commit SHA`)
  const secret = process.env.OPENPLC_TRUST_SEED_SECRET ?? ''
  if (secret === '') problems.push('OPENPLC_TRUST_SEED_SECRET is not set')
  if (problems.length > 0) throw new CheckFailure(problems)

  const seed = deriveSeed(secret, values.version, values.commit)
  const needles = [
    { form: 'raw', bytes: seed },
    { form: 'hex-lower', bytes: Buffer.from(seed.toString('hex')) },
    { form: 'hex-upper', bytes: Buffer.from(seed.toString('hex').toUpperCase()) },
    { form: 'base64', bytes: Buffer.from(seed.toString('base64').replace(/=+$/, '')) },
  ]
  const matches = scanPaths(positionals, needles).map(
    ({ file, offset, needle }) => `match: ${file} offset ${offset} form ${needle.form}`,
  )
  seed.fill(0)
  if (matches.length > 0) throw new CheckFailure(matches)
  console.log('no match')
})
