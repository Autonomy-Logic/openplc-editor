import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'

/** The third-party package the abuse checks offer to a hardened editor. */
export const UNTRUSTED_PACKAGE_ID = 'com.example.untrusted'

/** The key id the third-party package is signed under. */
export const UNTRUSTED_KEY_ID = 'untrusted-dev'

/** The board the third-party package provides. */
export const UNTRUSTED_BOARD = 'UNTRUSTED'

/** The package registry of a user data folder, as the editor writes it from 4.3.0 on. */
const REGISTRY_FORMAT_VERSION = '1.0'

/** A package id the editor accepts as a folder name. */
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Key-sorted JSON serialization, byte for byte the canonical form `package-verification-core.ts` signs and verifies.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`
}

/**
 * The files of the third-party package, without its signature.
 * @returns {Record<string, string>}
 */
function untrustedFiles() {
  const manifest = {
    formatVersion: '1.0',
    package: {
      id: UNTRUSTED_PACKAGE_ID,
      name: 'UNTRUSTED boards',
      version: '1.0.0',
      vendor: { name: 'UNTRUSTED test vendor' },
      description: 'A package signed by a key the editor does not trust, for the packaged abuse checks.',
      license: 'GPL-3.0',
      minEditorVersion: '4.3.0',
    },
    devices: [
      {
        id: 'untrusted',
        name: UNTRUSTED_BOARD,
        category: 'PLC',
        target: {
          type: 'arduino-cli',
          core: 'esp32:esp32',
          platform: 'esp32:esp32:esp32s3',
          boardManagerUrl: 'https://espressif.github.io/arduino-esp32/package_esp32_index.json',
        },
        hal: { type: 'arduino-hal', source: 'hal/arduino/untrusted.cpp' },
      },
    ],
  }
  return {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'hal/arduino/untrusted.cpp':
      'void hardwareInit() {}\nvoid updateInputBuffers() {}\nvoid updateOutputBuffers() {}\n',
  }
}

/**
 * Writes the third-party `com.example.untrusted` package, signed under `untrusted-dev` by a fresh Ed25519 key whose private
 * half is never written, as a ZIP of stored entries.
 * @param {string} vppPath
 * @returns {{ packageId: string, keyId: string, publicKeyPem: string, boardName: string }}
 */
export function writeUntrustedVpp(vppPath) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const files = untrustedFiles()
  const manifest = JSON.parse(files['manifest.json'])
  const payload = {
    formatVersion: '1.0',
    alg: 'ed25519',
    keyId: UNTRUSTED_KEY_ID,
    packageId: manifest.package.id,
    version: manifest.package.version,
    signedAt: new Date().toISOString(),
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')]),
    ),
  }
  const signature = sign(null, Buffer.from(canonicalize(payload), 'utf8'), privateKey).toString('base64')
  const entries = Object.entries({
    ...files,
    'signature.json': `${JSON.stringify({ ...payload, signature }, null, 2)}\n`,
  }).map(([name, content]) => ({ name, data: Buffer.from(content, 'utf8') }))
  mkdirSync(dirname(vppPath), { recursive: true })
  writeFileSync(vppPath, storedZip(entries))
  return {
    packageId: UNTRUSTED_PACKAGE_ID,
    keyId: UNTRUSTED_KEY_ID,
    publicKeyPem: String(publicKey.export({ type: 'spki', format: 'pem' })),
    boardName: UNTRUSTED_BOARD,
  }
}

/**
 * A ZIP archive whose entries are all stored (method 0), each with its CRC-32.
 * @param {{ name: string, data: Buffer }[]} entries
 * @returns {Buffer}
 */
export function storedZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

/**
 * The files of a ZIP archive, read through its central directory; stored and deflated entries are supported.
 * @param {Buffer} zip
 * @returns {{ name: string, data: Buffer }[]} directory entries are left out.
 * @throws {Error} on another compression method, a CRC-32 mismatch or an entry path that leaves the archive root.
 */
export function readZip(zip) {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (endAt === -1) throw new Error('not a ZIP archive: no end of central directory record')
  const count = zip.readUInt16LE(endAt + 10)
  let at = zip.readUInt32LE(endAt + 16)
  const files = []
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`ZIP central directory entry ${index} is malformed`)
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const compressedSize = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    const localAt = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (!isSafeEntryPath(name)) throw new Error(`ZIP entry ${JSON.stringify(name)} leaves the archive root`)
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28)
    const raw = zip.subarray(dataAt, dataAt + compressedSize)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`ZIP entry ${name} uses compression method ${method}`)
    if (crc32(data) !== crc) throw new Error(`ZIP entry ${name} does not match its CRC-32`)
    files.push({ name, data })
  }
  return files
}

/** True for a relative POSIX entry path with no empty, `.` or `..` segment. */
function isSafeEntryPath(name) {
  if (name === '' || name.startsWith('/') || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) {
    return false
  }
  return !name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}

/**
 * Places a `.vpp` into a user data folder the way a person adding a package by hand would: its files under
 * `packages/<packageId>/` and an entry in `packages/registry.json`, which is created when absent.
 * @param {{ vppPath: string, userDataDir: string }} options
 * @returns {{ packageId: string, packageDir: string }}
 */
export function placePackageByHand({ vppPath, userDataDir }) {
  const files = readZip(readFileSync(vppPath))
  const manifestFile = files.find((file) => file.name === 'manifest.json')
  if (!manifestFile) throw new Error(`${vppPath} holds no manifest.json`)
  const manifest = JSON.parse(manifestFile.data.toString('utf8'))
  const packageId = manifest?.package?.id
  if (typeof packageId !== 'string' || !PACKAGE_ID.test(packageId)) {
    throw new Error(`${vppPath}: manifest.json names no usable package id`)
  }
  const packagesDir = join(userDataDir, 'packages')
  const packageDir = join(packagesDir, packageId)
  for (const { name, data } of files) {
    const target = join(packageDir, ...name.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
  }
  const registryPath = join(packagesDir, 'registry.json')
  const registry = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf8'))
    : { formatVersion: REGISTRY_FORMAT_VERSION, packages: {} }
  registry.packages = registry.packages ?? {}
  registry.packages[packageId] = {
    version: manifest.package.version,
    installedAt: new Date().toISOString(),
    path: packageDir,
    devices: (Array.isArray(manifest.devices) ? manifest.devices : []).map((device) => device.id),
  }
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8')
  return { packageId, packageDir }
}
