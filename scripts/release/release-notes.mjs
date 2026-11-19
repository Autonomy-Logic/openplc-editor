#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { readDigestMap } from './lib/release-assets.mjs'

const OPTIONS = ['body', 'date', 'commit', 'original', 'built']

/**
 * The notes section of one rebuild: its date, its commit and each installer's previous and new sha256.
 * @param {string} date
 * @param {string} commit
 * @param {Record<string, string>} original
 * @param {Record<string, string>} built
 * @returns {string}
 */
function rebuildSection(date, commit, original, built) {
  return [
    `### Installers rebuilt on ${date}`,
    '',
    `Rebuilt from commit ${commit}. The sha256 of each installer before and after this rebuild:`,
    '',
    '| Installer | Previous sha256 | New sha256 |',
    '| --- | --- | --- |',
    ...Object.keys(original).map((name) => `| ${name} | \`${original[name]}\` | \`${built[name]}\` |`),
    '',
  ].join('\n')
}

runCli(() => {
  const { values, positionals } = parseCli(
    Object.fromEntries(OPTIONS.map((name) => [name, { type: 'string' }])),
    OPTIONS,
  )
  const problems = []
  if (positionals.length > 0) problems.push(`unexpected arguments: ${positionals.join(' ')}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) problems.push(`--date ${values.date} is not YYYY-MM-DD`)
  if (!/^[0-9a-f]{40}$/.test(values.commit)) problems.push(`--commit ${values.commit} is not a 40-character commit SHA`)
  if (problems.length > 0) throw new CheckFailure(problems)

  const original = readDigestMap(values.original)
  const built = readDigestMap(values.built, Object.keys(original))
  const body = readFileSync(values.body, 'utf8')
  const separator = body === '' ? '' : body.endsWith('\n') ? '\n' : '\n\n'
  process.stdout.write(`${body}${separator}${rebuildSection(values.date, values.commit, original, built)}`)
})
