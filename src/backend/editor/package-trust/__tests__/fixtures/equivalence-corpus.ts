import { createHash, sign } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { canonicalize } from '../../../../shared/utils/vpp/package-verification-core'
import { type TestSigningKey, UNTRUSTED_KEY } from './sign-test-package'
import { TEST_AUTONOMY_KEY } from './trust-test-kit'

/** The package id and version every corpus package is signed as, unless a case changes them. */
export const CORPUS_PACKAGE_ID = 'com.test.corpus'
export const CORPUS_VERSION = '1.0.0'

type Content = string | Uint8Array
type Json = Record<string, unknown>

/** How one corpus package differs from a package the test key signs over its canonical payload. */
interface CaseSpec {
  /** The files written and signed; a manifest naming the package and one source file by default. */
  files?: Record<string, Content>
  /** Rewrites the signed `files` map before signing. */
  signedFiles?: (hashes: Record<string, string>) => Record<string, unknown>
  /** Rewrites the payload before signing. */
  payload?: (payload: Json) => Json
  /** The text the signature covers; the shared canonical JSON by default. */
  signedText?: (payload: Json) => string
  key?: TestSigningKey
  /** Rewrites the signature document written to signature.json. */
  document?: (document: Json) => unknown
  /** Writes this text as signature.json instead of the document. */
  rawSignature?: string
  /** Puts a byte order mark before the signature.json text. */
  signatureBom?: boolean
  omitSignature?: boolean
  /** Changes the package directory after signing. */
  after?: (dir: string) => void
}

/** One package of the corpus: a name and how to write it. */
export interface CorpusCase {
  name: string
  spec: CaseSpec
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const bytesOf = (content: Content): Uint8Array =>
  typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content

function write(path: string, content: Content): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function manifest(id: unknown = CORPUS_PACKAGE_ID, version: unknown = CORPUS_VERSION): string {
  return JSON.stringify({ formatVersion: '1.0', package: { id, name: 'Corpus Board', version }, devices: [] })
}

const SOURCE = 'int vpp_init(void) { return 0; }'

function defaultFiles(manifestText: string = manifest()): Record<string, Content> {
  return { 'manifest.json': manifestText, 'plugin/main.c': SOURCE }
}

/** Keys sorted as `localeCompare` sorts them, which differs from the canonical code-unit order. */
function localeSorted(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(localeSorted).join(',')}]`
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${localeSorted(item)}`).join(',')}}`
}

/** @p record with its keys in reverse order, at every depth. */
function reversed(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(reversed)
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reversed(item)]),
  )
}

const flipHex = (hex: string): string => (hex[0] === '0' ? '1' : '0') + hex.slice(1)

const EXTRA_FIELDS: Json = {
  Z: 1,
  a: [3, 'a', null, { y: true, b: 1.5 }],
  é: 'é',
  '\u{1F600}': 'emoji',
  '￿': 'last code unit',
  ' ': '',
  numbers: [1e21, -0, 0.30000000000000004, 1e-7, -12],
  escapes: 'nul\u0000 unit\u001f quote" backslash\\ separator  lone\ud800',
  nested: { deeper: { deepest: [{ k: 'v' }, []] } },
}

/** Every corpus case. Each name tells whether the shared verifier accepts it; the test asks the shared verifier. */
export const CORPUS: CorpusCase[] = [
  { name: 'a package signed over its canonical payload', spec: {} },
  {
    name: 'a package with nested, binary, empty and unicode-named files',
    spec: {
      files: {
        ...defaultFiles(),
        'assets/nested/deep/logo.bin': Uint8Array.from([0, 255, 254, 128, 10, 13, 0xc3]),
        'empty.txt': '',
        'données/é.txt': 'é',
      },
    },
  },
  {
    name: 'a package with files named after Object.prototype members',
    spec: {
      files: {
        ...defaultFiles(),
        ['__proto__']: 'proto',
        constructor: 'constructor',
        toString: 'toString',
        hasOwnProperty: 'hasOwnProperty',
        'lib/__proto__': 'nested proto',
      },
    },
  },
  { name: 'a signature.json whose keys are in reverse order', spec: { document: reversed } },
  {
    name: 'a payload with extra fields: nested values, unicode keys, numbers and escaped strings',
    spec: { payload: (payload) => ({ ...payload, ...EXTRA_FIELDS }) },
  },
  { name: 'an unsigned file added after signing', spec: { after: (dir) => write(join(dir, 'sneaky.txt'), 'x') } },
  { name: 'a signed file removed', spec: { after: (dir) => rmSync(join(dir, 'plugin', 'main.c')) } },
  {
    name: 'a signed file renamed',
    spec: { after: (dir) => renameSync(join(dir, 'plugin', 'main.c'), join(dir, 'plugin', 'other.c')) },
  },
  {
    name: 'a signed file altered',
    spec: { after: (dir) => write(join(dir, 'plugin', 'main.c'), 'int vpp_init(void) { return 1; }') },
  },
  {
    name: 'a signed hash changed in the payload',
    spec: { signedFiles: (hashes) => ({ ...hashes, 'plugin/main.c': flipHex(hashes['plugin/main.c']) }) },
  },
  {
    name: 'a signed hash in upper case',
    spec: { signedFiles: (hashes) => ({ ...hashes, 'plugin/main.c': hashes['plugin/main.c'].toUpperCase() }) },
  },
  {
    name: 'a signed entry for an absent file in place of a present one',
    spec: {
      signedFiles: (hashes) => ({
        'manifest.json': hashes['manifest.json'],
        'plugin/ghost.c': hashes['plugin/main.c'],
      }),
    },
  },
  {
    name: 'a signed entry named __proto__ in place of a present file',
    spec: {
      signedFiles: (hashes) =>
        Object.fromEntries([
          ['manifest.json', hashes['manifest.json']],
          ['__proto__', hashes['plugin/main.c']],
        ]),
    },
  },
  {
    name: 'a manifest naming another package',
    spec: { files: defaultFiles(manifest('com.test.other')) },
  },
  { name: 'a manifest with another version', spec: { files: defaultFiles(manifest(CORPUS_PACKAGE_ID, '1.0.1')) } },
  {
    name: 'a manifest whose version is a number where the payload has a string',
    spec: {
      files: defaultFiles(manifest(CORPUS_PACKAGE_ID, 1)),
      payload: (payload) => ({ ...payload, version: '1' }),
    },
  },
  { name: 'a manifest that is an array', spec: { files: defaultFiles('[]') } },
  { name: 'a manifest that is null', spec: { files: defaultFiles('null') } },
  { name: 'a manifest that is a string', spec: { files: defaultFiles('"com.test.corpus"') } },
  { name: 'a manifest with no package block', spec: { files: defaultFiles('{"formatVersion":"1.0"}') } },
  { name: 'a manifest whose package block is an array', spec: { files: defaultFiles('{"package":[]}') } },
  { name: 'no manifest.json', spec: { files: { 'plugin/main.c': SOURCE } } },
  { name: 'a manifest.json that is not JSON', spec: { files: defaultFiles('{ not json') } },
  { name: 'a manifest.json starting with a byte order mark', spec: { files: defaultFiles(`﻿${manifest()}`) } },
  { name: 'a signature.json starting with a byte order mark', spec: { signatureBom: true } },
  { name: 'no signature.json', spec: { omitSignature: true } },
  { name: 'a signature.json that is not JSON', spec: { rawSignature: 'not json at all' } },
  { name: 'a signature.json that is null', spec: { rawSignature: 'null' } },
  { name: 'a signature.json that is an array', spec: { rawSignature: '[]' } },
  {
    name: 'a signature document with no signature field',
    spec: {
      document: (document) => Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'signature')),
    },
  },
  { name: 'an empty signature', spec: { document: (document) => ({ ...document, signature: '' }) } },
  { name: 'a payload version that is a number', spec: { payload: (payload) => ({ ...payload, version: 123 }) } },
  { name: 'a files map that is a string', spec: { payload: (payload) => ({ ...payload, files: 'nope' }) } },
  { name: 'a files map that is an array', spec: { payload: (payload) => ({ ...payload, files: ['x'] }) } },
  {
    name: 'a file hash that is not a string',
    spec: {
      document: (document) => ({
        ...document,
        files: { ...(typeof document.files === 'object' ? document.files : {}), 'manifest.json': 42 },
      }),
    },
  },
  { name: 'an unsupported algorithm', spec: { payload: (payload) => ({ ...payload, alg: 'rsa-pss' }) } },
  { name: 'a signature under the untrusted-dev key', spec: { key: UNTRUSTED_KEY } },
  {
    name: 'a signature under the untrusted-dev key claiming the module key id',
    spec: { key: UNTRUSTED_KEY, payload: (payload) => ({ ...payload, keyId: TEST_AUTONOMY_KEY.keyId }) },
  },
  ...['constructor', '__proto__', 'toString'].map(
    (keyId): CorpusCase => ({
      name: `a key id of ${keyId}`,
      spec: { payload: (payload) => ({ ...payload, keyId }) },
    }),
  ),
  {
    name: 'a tampered signature',
    spec: {
      document: (document) => {
        const bytes = Buffer.from(String(document.signature), 'base64')
        bytes[0] ^= 0xff
        return { ...document, signature: bytes.toString('base64') }
      },
    },
  },
  {
    name: 'a signature over the payload serialized without sorting its keys',
    spec: { signedText: (payload) => JSON.stringify(payload) },
  },
  {
    name: 'a signature over the payload with keys sorted by localeCompare',
    spec: { payload: (payload) => ({ ...payload, ...EXTRA_FIELDS }), signedText: localeSorted },
  },
]

/** Writes the package of @p corpusCase into @p dir, signed by the test key unless the case says otherwise. */
export function writeCorpusCase(dir: string, corpusCase: CorpusCase): string {
  const { spec } = corpusCase
  const files = spec.files ?? defaultFiles()
  for (const [rel, content] of Object.entries(files)) write(join(dir, rel), content)
  if (spec.omitSignature) return dir

  const hashes = Object.fromEntries(Object.entries(files).map(([rel, content]) => [rel, sha256Hex(bytesOf(content))]))
  const key = spec.key ?? TEST_AUTONOMY_KEY
  const basePayload: Json = {
    formatVersion: '1.0',
    alg: 'ed25519',
    keyId: key.keyId,
    packageId: CORPUS_PACKAGE_ID,
    version: CORPUS_VERSION,
    signedAt: '2026-06-01T00:00:00.000Z',
    files: spec.signedFiles ? spec.signedFiles(hashes) : hashes,
  }
  const payload = spec.payload ? spec.payload(basePayload) : basePayload
  const signedText = spec.signedText ? spec.signedText(payload) : canonicalize(payload)
  const signature = sign(null, Uint8Array.from(Buffer.from(signedText, 'utf8')), key.privateKey).toString('base64')
  const document = { ...payload, signature }
  const text = spec.rawSignature ?? JSON.stringify(spec.document ? spec.document(document) : document, null, 2)
  write(join(dir, 'signature.json'), spec.signatureBom ? `﻿${text}` : text)
  spec.after?.(dir)
  return dir
}
