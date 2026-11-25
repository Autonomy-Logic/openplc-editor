import { createPublicKey } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

/** The PEM header of a public key. */
export const BEGIN_MARKER = '-----BEGIN PUBLIC KEY-----'

/** One `'<keyId>': \`<PEM>\`` entry of the trusted-keys map. */
const KEY_ENTRY = /(['"])([^'"\r\n]+)\1\s*:\s*`(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----\s*)`/g

/**
 * The `keyId -> PEM` entries of a trusted-keys TypeScript source.
 * @param {string} source
 * @returns {{ id: string, pem: string }[]}
 * @throws {Error} when no key is found, or when a PEM marker sits outside a parsed entry.
 */
export function parseTrustedKeys(source) {
  const keys = [...source.matchAll(KEY_ENTRY)].map((match) => ({ id: match[2], pem: match[3] }))
  if (keys.length === 0) throw new Error('no keyId -> PEM entry found in the trusted keys file')
  const markers = source.split(BEGIN_MARKER).length - 1
  if (markers !== keys.length) {
    throw new Error(
      `the trusted keys file holds ${markers} PEM keys but ${keys.length} keyId -> PEM entries were parsed`,
    )
  }
  return keys
}

/**
 * The 32 raw bytes of an Ed25519 public key given as PEM.
 * @param {string} pem
 * @returns {Buffer}
 */
export function rawEd25519Key(pem) {
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`expected an Ed25519 key, found ${key.asymmetricKeyType}`)
  return Buffer.from(String(key.export({ format: 'jwk' }).x), 'base64url')
}

/**
 * Every byte sequence that would reveal a trusted key in a packaged file: its id, its PEM body with and without
 * line breaks and JSON-escaped, and its raw bytes as binary, hex and base64. The BEGIN marker has id `begin-marker`.
 * @param {{ id: string, pem: string }[]} keys
 * @returns {{ id: string, label: string, bytes: Buffer }[]}
 */
export function trustNeedles(keys) {
  const needles = [{ id: 'begin-marker', label: 'the PEM BEGIN marker', bytes: Buffer.from(BEGIN_MARKER) }]
  for (const key of keys) {
    const lines = key.pem.split(/\r?\n/).filter((line) => line !== '' && !line.startsWith('-----'))
    const raw = rawEd25519Key(key.pem)
    const forms = [
      ['the key id', key.id],
      ['the PEM body with line breaks', lines.join('\n')],
      ['the PEM body with CRLF line breaks', lines.join('\r\n')],
      ['the PEM body without line breaks', lines.join('')],
      ['the PEM body JSON-escaped', lines.join('\\n')],
      ['the PEM body JSON-escaped with CRLF', lines.join('\\r\\n')],
      ['the raw key bytes', raw],
      ['the key bytes as lowercase hex', raw.toString('hex')],
      ['the key bytes as uppercase hex', raw.toString('hex').toUpperCase()],
      ['the key bytes as base64', raw.toString('base64').replace(/=+$/, '')],
    ]
    for (const [label, value] of forms) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (needles.some((needle) => needle.bytes.equals(bytes))) continue
      needles.push({ id: `key:${key.id}`, label: `${label} of key ${key.id}`, bytes })
    }
  }
  return needles
}

/**
 * The regular files under a path; a regular file given directly is yielded itself. Symbolic links are not followed.
 * @param {string} path
 * @returns {Generator<{ root: string, file: string, relative: string }>}
 */
export function* walkFiles(path) {
  const stat = lstatSync(path)
  if (stat.isFile()) {
    yield { root: path, file: path, relative: basename(path) }
    return
  }
  if (!stat.isDirectory()) return
  const pending = [path]
  while (pending.length > 0) {
    const dir = pending.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) yield { root: path, file: full, relative: relative(path, full).split(sep).join('/') }
    }
  }
}

/**
 * Every offset at which `needle` occurs in `haystack`.
 * @param {Buffer} haystack
 * @param {Buffer} needle
 * @returns {number[]}
 */
export function findAll(haystack, needle) {
  const offsets = []
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) offsets.push(at)
  return offsets
}

/**
 * Searches every regular file under each path for each needle, file contents read as raw bytes.
 * @template {{ bytes: Buffer }} N
 * @param {string[]} paths
 * @param {N[]} needles
 * @returns {{ root: string, file: string, relative: string, needle: N, offset: number }[]}
 */
export function scanPaths(paths, needles) {
  const findings = []
  for (const path of paths) {
    for (const entry of walkFiles(path)) {
      const content = readFileSync(entry.file)
      for (const needle of needles) {
        for (const offset of findAll(content, needle.bytes)) findings.push({ ...entry, needle, offset })
      }
    }
  }
  return findings
}
