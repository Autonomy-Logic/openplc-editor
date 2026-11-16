#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MARKER = ['__OPENPLC', 'E2E', 'DEBUG', 'SESSION__'].join('_')

function walk(dir, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, found)
      continue
    }
    if (!entry.isFile() || statSync(full).size === 0) continue
    if (readFileSync(full, 'latin1').includes(MARKER)) found.push(full)
  }
  return found
}

const root = process.argv[2]

if (!root) {
  console.error('usage: check-debug-seam-leak.mjs <directory>')
  process.exit(1)
}

let leaks
try {
  leaks = walk(root, [])
} catch (error) {
  console.error(`cannot scan ${root}: ${error.message}`)
  process.exit(1)
}

if (leaks.length > 0) {
  console.error(`the test-only debug seam leaked into the build:\n${leaks.join('\n')}`)
  process.exit(1)
}

console.log(`no debug seam in ${root}`)
