#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { hardenedFuseProblems, readFuseWires } from './lib/fuse-wire.mjs'

/** Where a macOS bundle keeps the Electron binary that holds the fuse wire. */
const MAC_FUSE_BINARY = join('Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')

/**
 * The fuse problems of one built executable, or of the Electron Framework of a `.app` bundle.
 * @param {string} path
 * @returns {string[]}
 */
function problemsOf(path) {
  try {
    const isDirectory = statSync(path).isDirectory()
    if (isDirectory && !path.replace(/[\\/]+$/, '').endsWith('.app')) return ['a directory that is not a .app bundle']
    return hardenedFuseProblems(readFuseWires(readFileSync(isDirectory ? join(path, MAC_FUSE_BINARY) : path)))
  } catch (error) {
    return [`cannot be read: ${error instanceof Error ? error.message : String(error)}`]
  }
}

runCli(() => {
  const { positionals } = parseCli({}, [])
  if (positionals.length === 0) throw new CheckFailure(['usage: read-fuses.mjs <executable or .app>...'])
  const problems = positionals.flatMap((path) => problemsOf(path).map((problem) => `${path}: ${problem}`))
  if (problems.length > 0) throw new CheckFailure(['executables without the hardened fuses:', ...problems])
  console.log(`all ${positionals.length} executables carry the hardened fuses`)
})
