/**
 * The desktop mechanisms the trust module runs on: the package snapshot, the Ed25519 primitive and the key encoding.
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process'
import { createHash, sign } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { TRUSTED_PACKAGE_KEYS } from '../../../shared/utils/vpp/trusted-keys'
import { desktopPackageTrustMechanisms as mechanisms } from '../index'
import { UNTRUSTED_KEY, FX3U_KEY_ID, pemToDer, signTestPackage } from './fixtures/sign-test-package'

const onPosix = process.platform === 'win32' ? it.skip : it
const asRegularUser = process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-mechanisms-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function write(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe('readSnapshot', () => {
  it('hashes every regular file but signature.json under its POSIX path and parses both documents', () => {
    const binary = new Uint8Array([0, 255, 1, 254, 10, 13])
    const signed = signTestPackage(join(root, 'pkg'))
    write(join(root, 'pkg', 'assets', 'nested', 'logo.bin'), binary)

    const snapshot = mechanisms.readSnapshot(join(root, 'pkg'))

    if ('error' in snapshot) throw new Error(snapshot.error)
    expect(Object.fromEntries(snapshot.fileHashes)).toEqual({
      ...signed.payload.files,
      'assets/nested/logo.bin': sha256Hex(binary),
    })
    expect(snapshot.manifestDocument).toMatchObject({ package: { id: signed.payload.packageId } })
    expect(snapshot.signatureDocument).toMatchObject({ keyId: 'untrusted-dev', files: signed.payload.files })
  })

  onPosix('refuses a package holding a symbolic link', () => {
    signTestPackage(join(root, 'pkg'))
    write(join(root, 'outside.c'), 'void outside(void) {}')
    symlinkSync(join(root, 'outside.c'), join(root, 'pkg', 'plugin', 'link.c'))

    expect(mechanisms.readSnapshot(join(root, 'pkg'))).toEqual({ error: expect.any(String) })
  })

  onPosix('refuses a package holding a FIFO', () => {
    signTestPackage(join(root, 'pkg'))
    execFileSync('mkfifo', [join(root, 'pkg', 'plugin', 'pipe')])

    expect(mechanisms.readSnapshot(join(root, 'pkg'))).toEqual({ error: expect.any(String) })
  })

  onPosix('refuses a package holding an entry whose path is unsafe', () => {
    signTestPackage(join(root, 'pkg'))
    write(join(root, 'pkg', 'plugin', 'a\\b.c'), 'void escaped(void) {}')

    expect(mechanisms.readSnapshot(join(root, 'pkg'))).toEqual({ error: expect.any(String) })
  })

  asRegularUser('refuses a package holding an unreadable file', () => {
    signTestPackage(join(root, 'pkg'))
    chmodSync(join(root, 'pkg', 'plugin', 'main.c'), 0o000)

    expect(mechanisms.readSnapshot(join(root, 'pkg'))).toEqual({ error: expect.any(String) })
  })
})

describe('verifyEd25519', () => {
  const message = new TextEncoder().encode('canonical payload')
  const signature = new Uint8Array(sign(null, message, UNTRUSTED_KEY.privateKey))

  it('accepts a signature made by the key (positive control)', () => {
    expect(mechanisms.verifyEd25519(message, UNTRUSTED_KEY.publicKeyDer, signature)).toBe(true)
  })

  it('rejects the signature over another message', () => {
    expect(mechanisms.verifyEd25519(new TextEncoder().encode('other'), UNTRUSTED_KEY.publicKeyDer, signature)).toBe(
      false,
    )
  })

  it('rejects the signature under another key', () => {
    const other = pemToDer(TRUSTED_PACKAGE_KEYS[FX3U_KEY_ID])

    expect(mechanisms.verifyEd25519(message, other, signature)).toBe(false)
  })

  it.each([
    ['an empty key', new Uint8Array(0)],
    ['a truncated key', UNTRUSTED_KEY.publicKeyDer.slice(0, 20)],
    ['random key bytes', new Uint8Array(44).fill(7)],
  ])('returns false, without throwing, for %s', (_label, key) => {
    expect(mechanisms.verifyEd25519(message, key, signature)).toBe(false)
  })

  it.each([
    ['an empty signature', new Uint8Array(0)],
    ['a truncated signature', signature.slice(0, 32)],
    ['an oversized signature', new Uint8Array([...signature, 0])],
  ])('returns false, without throwing, for %s', (_label, malformed) => {
    expect(mechanisms.verifyEd25519(message, UNTRUSTED_KEY.publicKeyDer, malformed)).toBe(false)
  })
})

describe('spkiDerToPem', () => {
  it('gives the PEM the key was exported as', () => {
    expect(mechanisms.spkiDerToPem(UNTRUSTED_KEY.publicKeyDer)).toBe(UNTRUSTED_KEY.publicKeyPem)
  })

  it('round-trips the Autonomy key to the PEM the editor trusts', () => {
    const pem = TRUSTED_PACKAGE_KEYS[FX3U_KEY_ID]

    expect(mechanisms.spkiDerToPem(pemToDer(pem))).toBe(pem)
  })
})
