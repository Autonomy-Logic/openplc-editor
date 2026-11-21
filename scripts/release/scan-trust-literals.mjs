#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { parseTrustedKeys, scanPaths, trustNeedles } from './lib/trust-literals.mjs'

const USAGE =
  'usage: scan-trust-literals.mjs --trusted-keys <trusted-keys.ts> [--allow-begin-marker <path>]... <dir>...'

runCli(() => {
  const { values, positionals } = parseCli(
    { 'trusted-keys': { type: 'string' }, 'allow-begin-marker': { type: 'string', multiple: true } },
    ['trusted-keys'],
  )
  if (positionals.length === 0) throw new CheckFailure([USAGE])
  const allowed = new Set((values['allow-begin-marker'] ?? []).map((path) => path.replaceAll('\\', '/')))
  const needles = trustNeedles(parseTrustedKeys(readFileSync(values['trusted-keys'], 'utf8')))

  const reported = new Set()
  const problems = []
  for (const { file, relative, needle } of scanPaths(positionals, needles)) {
    if (needle.id === 'begin-marker' && allowed.has(relative)) continue
    const line = `${file}: ${needle.label}`
    if (reported.has(line)) continue
    reported.add(line)
    problems.push(line)
  }
  if (problems.length > 0) throw new CheckFailure(['trust-anchor literals found in the packaged output:', ...problems])
  console.log(`no trust-anchor literal in ${positionals.length} scanned path(s)`)
})
