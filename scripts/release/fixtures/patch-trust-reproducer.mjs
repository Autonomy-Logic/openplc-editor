#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runAsarCli } from '../lib/asar.mjs'

/** What the published method prints when it finds no single trusted-keys object. */
const NOT_FOUND = 'Could not locate the trusted-keys object in dist/main'

/** The trusted-keys object as the original installers bundle it. */
const TRUSTED_OBJECT = /\{"openplc-2026":"-----BEGIN PUBLIC KEY-----\\n[^"]*"\}/g

/** The key id the patch adds. */
const ADDED_KEY_ID = 'patched-vendor-key'

/**
 * Runs the pinned asar command line and throws with its output when it fails.
 * @param {string[]} args
 */
function asar(args) {
  const result = runAsarCli(args)
  if (result.status !== 0) {
    const cause = result.error ? result.error.message : `${result.stdout}${result.stderr}`.trim()
    throw new Error(`npx asar ${args[0]} failed (${result.status ?? result.signal}): ${cause}`)
  }
}

/**
 * Every trusted-keys object in the `.js` files directly in `dist/main` of an extracted archive.
 * @param {string} extracted
 * @returns {{ file: string, index: number, text: string }[]}
 */
function findTrustedObjects(extracted) {
  const mainDir = join(extracted, 'dist', 'main')
  let entries
  try {
    entries = readdirSync(mainDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .flatMap((entry) => {
      const file = join(mainDir, entry.name)
      return [...readFileSync(file, 'latin1').matchAll(TRUSTED_OBJECT)].map((match) => ({
        file,
        index: match.index,
        text: match[0],
      }))
    })
}

/**
 * Reproduces the published trust patch on an `app.asar`: backup to `app.asar.bak`, extract, add a key to the single
 * trusted-keys object of `dist/main/*.js`, repack. Returns the exit status; 1 leaves `app.asar` untouched.
 */
function main() {
  const archive = process.argv[2]
  if (!archive) {
    console.error('usage: patch-trust-reproducer.mjs <path to app.asar>')
    return 2
  }
  copyFileSync(archive, `${archive}.bak`)
  const extracted = mkdtempSync(join(realpathSync(tmpdir()), 'patch-trust-'))
  try {
    asar(['extract', archive, extracted])
    const found = findTrustedObjects(extracted)
    if (found.length !== 1) {
      console.error(NOT_FOUND)
      return 1
    }
    const [{ file, index, text }] = found
    const pem = String(generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }))
    const source = readFileSync(file, 'latin1')
    const patched = `${text.slice(0, -1)},${JSON.stringify(ADDED_KEY_ID)}:${JSON.stringify(pem)}}`
    writeFileSync(file, `${source.slice(0, index)}${patched}${source.slice(index + text.length)}`, 'latin1')
    asar(['pack', extracted, archive])
    console.log(`added key ${ADDED_KEY_ID} to the trusted keys in ${file.slice(extracted.length + 1)}`)
    return 0
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
