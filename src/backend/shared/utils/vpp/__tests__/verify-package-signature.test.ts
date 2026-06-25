import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, type PathOrFileDescriptor, rmSync, type Stats, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { canonicalize, SIGNATURE_FILENAME, TrustedKeys, verifyPackageSignature } from '../verify-package-signature'

// Replace node:fs with a spread of the real module so its exports become
// plain, configurable own-properties — Node's native module bindings are
// non-configurable and can't be spied on directly. All methods still call
// through to the genuine implementation; individual tests spy where needed.
jest.mock('node:fs', () => ({ ...jest.requireActual<typeof import('node:fs')>('node:fs') }))

const KEY_ID = 'test-key'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const TRUSTED: TrustedKeys = { [KEY_ID]: PUBLIC_PEM }

const sha256 = (s: string): string =>
  createHash('sha256')
    .update(Uint8Array.from(Buffer.from(s, 'utf-8')))
    .digest('hex')

/** Files written into every fixture package (relative path -> contents). */
const DEFAULT_FILES: Record<string, string> = {
  'manifest.json': '{"formatVersion":"1.0"}',
  'hal/arduino/hal.cpp': 'void hardwareInit() {}',
  'assets/logo.png': 'PNGDATA',
}

interface BuildOpts {
  files?: Record<string, string>
  /** Override fields on the signed payload (applied before signing). */
  payloadOverride?: Record<string, unknown>
  /** Mutate the on-disk signature.json after signing (e.g. flip a byte). */
  signatureMutate?: (sig: Record<string, unknown>) => void
  /** Skip writing signature.json entirely. */
  omitSignature?: boolean
  /** Write raw (non-signed) content as signature.json. */
  rawSignatureContent?: string
}

function buildPackage(dir: string, opts: BuildOpts = {}): void {
  const files = opts.files ?? DEFAULT_FILES
  const fileHashes: Record<string, string> = {}
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
    fileHashes[rel] = sha256(content)
  }

  if (opts.omitSignature) return

  if (opts.rawSignatureContent !== undefined) {
    writeFileSync(join(dir, SIGNATURE_FILENAME), opts.rawSignatureContent)
    return
  }

  const payload = {
    formatVersion: '1.0',
    alg: 'ed25519',
    keyId: KEY_ID,
    packageId: 'com.test.pkg',
    version: '1.0.0',
    signedAt: '2026-06-01T00:00:00.000Z',
    files: fileHashes,
    ...opts.payloadOverride,
  }
  const signature = cryptoSign(
    null,
    Uint8Array.from(Buffer.from(canonicalize(payload), 'utf-8')),
    PRIVATE_PEM,
  ).toString('base64')
  const sig: Record<string, unknown> = { ...payload, signature }
  opts.signatureMutate?.(sig)
  writeFileSync(join(dir, SIGNATURE_FILENAME), JSON.stringify(sig, null, 2))
}

describe('verifyPackageSignature', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vpp-sig-test-'))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a correctly signed package', () => {
    buildPackage(dir)
    expect(verifyPackageSignature(dir, TRUSTED)).toEqual({ valid: true })
  })

  it('rejects a package with no signature.json', () => {
    buildPackage(dir, { omitSignature: true })
    const result = verifyPackageSignature(dir, TRUSTED)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/not signed/i)
  })

  it('rejects a signature.json that is not valid JSON', () => {
    buildPackage(dir, { rawSignatureContent: 'not json at all' })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/not signed/i)
  })

  it('rejects when the top-level JSON is not an object', () => {
    buildPackage(dir, { rawSignatureContent: 'null' })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/malformed/i)
  })

  it('rejects when the signature field is missing', () => {
    buildPackage(dir, {
      signatureMutate: (sig) => {
        delete sig.signature
      },
    })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/malformed/i)
  })

  it('rejects when a payload field has the wrong type', () => {
    buildPackage(dir, { payloadOverride: { version: 123 } })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/malformed/i)
  })

  it('rejects when files is not an object', () => {
    buildPackage(dir, { payloadOverride: { files: 'nope' } })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/malformed/i)
  })

  it('rejects when a file hash entry is not a string', () => {
    buildPackage(dir, {
      signatureMutate: (sig) => {
        ;(sig.files as Record<string, unknown>)['manifest.json'] = 42
      },
    })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/malformed/i)
  })

  it('rejects an unsupported algorithm', () => {
    buildPackage(dir, { payloadOverride: { alg: 'rsa-pss' } })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/Unsupported signature algorithm/i)
  })

  it('rejects an untrusted keyId', () => {
    buildPackage(dir)
    const result = verifyPackageSignature(dir, { 'other-key': PUBLIC_PEM })
    expect(result.error).toMatch(/Untrusted signing key/i)
  })

  it('rejects when the public key is malformed (crypto throws)', () => {
    buildPackage(dir)
    const result = verifyPackageSignature(dir, { [KEY_ID]: 'garbage-not-a-pem' })
    expect(result.error).toMatch(/Signature verification error/i)
  })

  it('rejects a tampered signature that decodes but does not verify', () => {
    buildPackage(dir, {
      signatureMutate: (sig) => {
        const bytes = Buffer.from(sig.signature as string, 'base64')
        bytes[0] ^= 0xff
        sig.signature = bytes.toString('base64')
      },
    })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/Invalid package signature/i)
  })

  it('rejects when an extra unsigned file is added after signing', () => {
    buildPackage(dir)
    writeFileSync(join(dir, 'sneaky.txt'), 'injected')
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/file count mismatch/i)
  })

  it('rejects when a signed file is removed', () => {
    buildPackage(dir)
    rmSync(join(dir, 'assets/logo.png'))
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/file count mismatch/i)
  })

  it('rejects when a signed file is swapped for an unsigned one (same count)', () => {
    buildPackage(dir)
    rmSync(join(dir, 'assets/logo.png'))
    writeFileSync(join(dir, 'assets/other.png'), 'PNGDATA')
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/Unsigned file present/i)
  })

  it('rejects when a signed file is tampered with (same path)', () => {
    buildPackage(dir)
    writeFileSync(join(dir, 'hal/arduino/hal.cpp'), 'void hardwareInit() { evil(); }')
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/Tampered file detected/i)
  })

  it('reports failure when listing package contents throws', () => {
    buildPackage(dir)
    const fs = jest.requireMock<typeof import('node:fs')>('node:fs')
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('readdir boom')
    })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/Failed to read package contents/i)
  })

  it('reports failure when hashing a package file throws', () => {
    buildPackage(dir)
    const fs = jest.requireMock<typeof import('node:fs')>('node:fs')
    const realReadFileSync = jest.requireActual<typeof import('node:fs')>('node:fs').readFileSync
    // verifyPackageSignature only ever calls readFileSync(path) (single arg,
    // string path → Buffer), so the mock matches that overload exactly.
    jest.spyOn(fs, 'readFileSync').mockImplementation((path: PathOrFileDescriptor) => {
      if (String(path).includes('hal.cpp')) throw new Error('read boom')
      return realReadFileSync(path)
    })
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/Failed to hash package file/i)
  })

  it('rejects a non-regular entry (symlink / special file)', () => {
    buildPackage(dir)
    const fs = jest.requireMock<typeof import('node:fs')>('node:fs')
    // Simulate a symlink/special file: neither a directory nor a regular file.
    const fakeStat = { isDirectory: () => false, isFile: () => false } as unknown as Stats
    jest.spyOn(fs, 'lstatSync').mockReturnValue(fakeStat)
    expect(verifyPackageSignature(dir, TRUSTED).error).toMatch(/Failed to read package contents/i)
  })
})

describe('canonicalize', () => {
  it('serializes primitives and null', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(42)).toBe('42')
    expect(canonicalize('hi')).toBe('"hi"')
    expect(canonicalize(true)).toBe('true')
  })

  it('serializes arrays preserving order', () => {
    expect(canonicalize([3, 'a', null])).toBe('[3,"a",null]')
  })

  it('sorts object keys recursively', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [1, 2] } })).toBe('{"a":{"c":[1,2],"d":2},"b":1}')
  })
})
