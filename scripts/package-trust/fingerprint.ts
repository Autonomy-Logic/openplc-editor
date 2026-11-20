import * as nodeCrypto from 'node:crypto'
import * as nodePath from 'node:path'

import ts from 'typescript'

import type { TrustVerdict } from '../../src/backend/editor/package-trust/types'
import { isRecord } from './generator'
import { loadTrustModule } from './load-module'

type Hook = 'import' | 'use'

interface RecordedCall {
  hook: Hook
  keyDigest: string
  result: boolean
}

/** The directory the synthetic package is served at by the in-memory `node:fs`. */
const PACKAGE_DIR = 'fingerprint-package'

const sha256Hex = (bytes: Uint8Array): string => nodeCrypto.createHash('sha256').update(bytes).digest('hex')

/** SHA-256 hex of the SPKI DER of a key in any form `node:crypto` accepts; '' when it is no public key. */
function keyDigest(key: unknown): string {
  try {
    const object: unknown =
      key instanceof nodeCrypto.KeyObject ? key : Reflect.apply(nodeCrypto.createPublicKey, nodeCrypto, [key])
    if (!(object instanceof nodeCrypto.KeyObject)) return ''
    return sha256Hex(Uint8Array.from(object.export({ format: 'der', type: 'spki' })))
  } catch {
    return ''
  }
}

/** keyId -> SHA-256 hex of the SPKI DER of each PEM key in @p keys. */
function expectedDigests(keys: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(keys).map(([keyId, pem]) => [keyId, keyDigest(pem)]))
}

/** The specifier @p source imports verifyPackageSignature from; throws when it imports it from nowhere. */
function verifierSpecifier(source: string): string {
  const file = ts.createSourceFile('package-trust-anchor.ts', source, ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS)
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => (element.propertyName ?? element.name).text === 'verifyPackageSignature')
    ) {
      return statement.moduleSpecifier.text
    }
  }
  throw new Error('the module does not import verifyPackageSignature')
}

/** The files of a package whose signature names @p keyId and cannot verify under any key. */
function syntheticPackage(keyId: string): Map<string, Uint8Array> {
  const manifest = new TextEncoder().encode(
    JSON.stringify({ package: { id: 'com.example.fingerprint', version: '1.0.0' } }),
  )
  const signature = {
    formatVersion: '1.0',
    alg: 'ed25519',
    keyId,
    packageId: 'com.example.fingerprint',
    version: '1.0.0',
    signedAt: '1970-01-01T00:00:00.000Z',
    files: { 'manifest.json': sha256Hex(manifest) },
    signature: Buffer.alloc(64, 1).toString('base64'),
  }
  return new Map([
    ['manifest.json', manifest],
    ['signature.json', new TextEncoder().encode(JSON.stringify(signature))],
  ])
}

/** A `node:fs` serving @p files in the directory PACKAGE_DIR, with the read calls of a directory walk. */
function memoryFs(files: Map<string, Uint8Array>): object {
  const fileAt = (path: unknown): Uint8Array | undefined =>
    [...files].find(([name]) => nodePath.join(PACKAGE_DIR, name) === String(path))?.[1]
  const isDirectory = (path: unknown): boolean => String(path) === PACKAGE_DIR
  const stat = (path: unknown): object => ({
    isFile: () => fileAt(path) !== undefined,
    isDirectory: () => isDirectory(path),
  })
  return {
    readdirSync: (path: unknown) => {
      if (!isDirectory(path)) throw new Error(`ENOTDIR: ${String(path)}`)
      return [...files.keys()]
    },
    lstatSync: stat,
    statSync: stat,
    existsSync: (path: unknown) => isDirectory(path) || fileAt(path) !== undefined,
    readFileSync: (path: unknown) => {
      const bytes = fileAt(path)
      if (bytes === undefined) throw new Error(`ENOENT: ${String(path)}`)
      return Buffer.from(bytes)
    },
  }
}

/** The problems of a key map the module handed to the shared verifier, against @p expected. */
function keyMapProblems(map: unknown, expected: Map<string, string>): string[] {
  if (!isRecord(map)) return ['the module handed the shared verifier no key map']
  const problems: string[] = []
  if (Object.getPrototypeOf(map) !== null) problems.push('the key map has a prototype')
  const ids = Object.keys(map).sort()
  if (ids.join('\n') !== [...expected.keys()].sort().join('\n')) {
    problems.push(`the key map holds ${ids.length} key id(s) that differ from the ${expected.size} expected`)
  }
  for (const id of ids) {
    const pem = map[id]
    if (typeof pem !== 'string' || expected.get(id) !== keyDigest(pem)) {
      problems.push('a key of the key map differs from the expected key')
    }
  }
  return problems
}

function moduleProblems(source: string, keys: Record<string, string>): string[] {
  const expected = expectedDigests(keys)
  const allowed = new Set(expected.values())
  const [keyId] = [...expected.keys()].sort()
  const problems: string[] = []
  const calls: RecordedCall[] = []
  const maps: unknown[] = []
  let hook: Hook = 'import'

  const verify = (...args: unknown[]): unknown => {
    const result: unknown = Reflect.apply(nodeCrypto.verify, nodeCrypto, args)
    if (typeof result === 'boolean') calls.push({ hook, keyDigest: keyDigest(args[2]), result })
    return result
  }
  const createPublicKey = (...args: unknown[]): unknown => {
    try {
      const key: unknown = Reflect.apply(nodeCrypto.createPublicKey, nodeCrypto, args)
      return key
    } catch (error) {
      problems.push(`the ${hook} hook recombined a key that is not a public key`)
      throw error
    }
  }
  const verifyTrusted = loadTrustModule(source, {
    'node:crypto': { ...nodeCrypto, verify, createPublicKey },
    'node:fs': memoryFs(syntheticPackage(keyId)),
    'node:path': nodePath,
    [verifierSpecifier(source)]: {
      verifyPackageSignature: (_packageDir: unknown, trustedKeys: unknown) => {
        maps.push(trustedKeys)
        return { valid: true }
      },
    },
  })

  const verdicts: [Hook, TrustVerdict][] = [['import', verifyTrusted(PACKAGE_DIR, true)]]
  hook = 'use'
  verdicts.push(['use', verifyTrusted(PACKAGE_DIR, false)])

  if (maps.length !== 2) problems.push(`the module handed the shared verifier ${maps.length} key map(s) in 2 calls`)
  for (const map of maps) problems.push(...keyMapProblems(map, expected))
  for (const [checked, verdict] of verdicts) {
    const failed = calls.filter((call) => call.hook === checked && !call.result)
    if (failed.length < 2) problems.push(`the ${checked} hook made ${failed.length} failing key check(s), fewer than 2`)
    if (failed.some((call) => !allowed.has(call.keyDigest))) {
      problems.push(`the ${checked} hook checked a signature under a key that is not expected`)
    }
    if (verdict[0]) problems.push(`the ${checked} hook accepted a package with an invalid signature`)
  }
  return [...new Set(problems)]
}

/**
 * Checks that the trust module @p source recombines exactly the keys in @p keys. It loads the module with a recording
 * `node:crypto`, a recording shared verifier that accepts every package, and an in-memory package whose signature
 * names the first key id and cannot verify; then every key of the map handed to the shared verifier, and every key
 * that a verify call returning false used, must be one of @p keys, with at least two such calls per hook, and both
 * hooks must refuse the package. Never throws.
 */
export function checkFingerprint(
  source: string,
  keys: Record<string, string>,
): { ok: true } | { ok: false; error: string } {
  let problems: string[]
  try {
    problems = moduleProblems(source, keys)
  } catch (error) {
    problems = [`the module failed: ${error instanceof Error ? error.message : String(error)}`]
  }
  return problems.length === 0 ? { ok: true } : { ok: false, error: `fingerprint mismatch: ${problems.join('; ')}` }
}
