import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import extract from 'extract-zip'
import JSZip from 'jszip'

import {
  canonicalize,
  encodeUtf8,
  SIGNATURE_FILENAME,
  type SignaturePayload,
} from '../../../../shared/utils/vpp/package-verification-core'

/** An Ed25519 key pair for signing synthetic packages, with its public key in the forms the verifiers take. */
export interface TestSigningKey {
  keyId: string
  privateKey: KeyObject
  publicKeyPem: string
  publicKeyDer: Uint8Array
}

const PKCS8_ED25519_PREFIX = '302e020100300506032b657004220420'

/** A deterministic Ed25519 key whose 32-byte private seed is @p seedHex. */
export function testSigningKey(keyId: string, seedHex: string): TestSigningKey {
  const privateKey = createPrivateKey({
    key: Buffer.from(PKCS8_ED25519_PREFIX + seedHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  })
  const publicKey = createPublicKey(privateKey)
  return {
    keyId,
    privateKey,
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    publicKeyDer: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })),
  }
}

/** The SPKI DER bytes of a PEM public key. */
export function pemToDer(pem: string): Uint8Array {
  return new Uint8Array(createPublicKey(pem).export({ format: 'der', type: 'spki' }))
}

/** The throwaway key standing in for the third-party `eqsp32-dev` signing key. */
export const EQSP32_KEY = testSigningKey(
  'eqsp32-dev',
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
)
export const EQSP32_PACKAGE_ID = 'com.erqos.eqsp32'
export const EQSP32_BOARD = 'EQSP32'

/** The Autonomy-signed catalog package kept as a fixture, and the board it provides. */
export const FX3U_VPP = join(__dirname, 'com.openplc.fx3u-compatible-2.1.0.vpp')
export const FX3U_PACKAGE_ID = 'com.openplc.fx3u-compatible'
export const FX3U_BOARD = 'FX3U-14M / LE3U-14M'
export const FX3U_KEY_ID = 'openplc-2026'

/** Options of `signTestPackage`; every field has a default that gives the `eqsp32-dev` package. */
export interface SignTestPackageOptions {
  /** The key that signs; `EQSP32_KEY` by default. */
  key?: TestSigningKey
  /** The `keyId` written in the payload; the signing key's id by default. */
  keyId?: string
  packageId?: string
  /** The `packageId` written in the payload; `packageId` by default. */
  signedPackageId?: string
  version?: string
  boardName?: string
  /** Replaces the default files (a manifest naming the package and one plugin source). */
  files?: Record<string, string>
  /** Files written or rewritten after signing. */
  alter?: Record<string, string>
}

/** A package directory written by `signTestPackage`, with what was signed. */
export interface SignedTestPackage {
  dir: string
  payload: SignaturePayload
  /** The canonical payload bytes the signature covers. */
  signedBytes: Uint8Array
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function writeFile(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** The manifest and plugin source of a runtime-v4 package providing one board. */
export function defaultPackageFiles(packageId: string, version: string, boardName: string): Record<string, string> {
  return {
    'manifest.json': JSON.stringify({
      formatVersion: '1.0',
      package: { id: packageId, name: boardName, version },
      devices: [
        { id: 'board', name: boardName, target: { type: 'runtime-v4' }, hal: { pluginEntry: 'plugin/main.c' } },
      ],
    }),
    'plugin/main.c': 'int vpp_init(void) { return 0; }',
  }
}

/** Writes a signed package directory at @p dir; with no options, the `eqsp32-dev` package. */
export function signTestPackage(dir: string, options: SignTestPackageOptions = {}): SignedTestPackage {
  const key = options.key ?? EQSP32_KEY
  const packageId = options.packageId ?? EQSP32_PACKAGE_ID
  const version = options.version ?? '1.0.0'
  const files = options.files ?? defaultPackageFiles(packageId, version, options.boardName ?? EQSP32_BOARD)

  const hashes: Record<string, string> = {}
  for (const [rel, content] of Object.entries(files)) {
    writeFile(join(dir, rel), content)
    hashes[rel] = sha256Hex(encodeUtf8(content))
  }

  const payload: SignaturePayload = {
    formatVersion: '1.0',
    alg: 'ed25519',
    keyId: options.keyId ?? key.keyId,
    packageId: options.signedPackageId ?? packageId,
    version,
    signedAt: '2026-06-01T00:00:00.000Z',
    files: hashes,
  }
  const signedBytes = encodeUtf8(canonicalize(payload))
  const signature = sign(null, signedBytes, key.privateKey).toString('base64')
  writeFile(join(dir, SIGNATURE_FILENAME), JSON.stringify({ ...payload, signature }, null, 2))

  for (const [rel, content] of Object.entries(options.alter ?? {})) {
    writeFile(join(dir, rel), content)
  }
  return { dir, payload, signedBytes }
}

/** Every regular file under @p dir, as sorted POSIX paths relative to it. */
export function listFiles(dir: string, under = dir): string[] {
  return readdirSync(under, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(under, entry.name)
      if (entry.isDirectory()) return listFiles(dir, path)
      return entry.isFile() ? [relative(dir, path).split(sep).join('/')] : []
    })
    .sort()
}

/** Zips the package directory @p dir into the `.vpp` file @p vppPath. */
export async function zipPackage(dir: string, vppPath: string): Promise<string> {
  const zip = new JSZip()
  for (const rel of listFiles(dir)) zip.file(rel, new Uint8Array(readFileSync(join(dir, rel))))
  writeFile(vppPath, await zip.generateAsync({ type: 'uint8array' }))
  return vppPath
}

/** Extracts the fx3u fixture with the real extract-zip into @p dest, an absolute path. */
export async function extractFx3u(dest: string): Promise<string> {
  await extract(FX3U_VPP, { dir: dest })
  return dest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The registry entries of @p packagesDir, keyed by package id. */
export function readRegistryPackages(packagesDir: string): Record<string, unknown> {
  const path = join(packagesDir, 'registry.json')
  if (!existsSync(path)) return {}
  const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'))
  return isRecord(raw) && isRecord(raw.packages) ? raw.packages : {}
}

/** Copies @p sourceDir into @p packagesDir and registers it, as a user adding a folder by hand would. */
export function installByHand(packagesDir: string, packageId: string, sourceDir: string, devices: string[]): string {
  const target = join(packagesDir, packageId)
  cpSync(sourceDir, target, { recursive: true })
  const packages = {
    ...readRegistryPackages(packagesDir),
    [packageId]: { version: '1.0.0', installedAt: '2026-06-01T00:00:00.000Z', path: target, devices },
  }
  writeFile(join(packagesDir, 'registry.json'), JSON.stringify({ formatVersion: '1.0', packages }, null, 2))
  return target
}
