/**
 * Byte-for-byte parity between the desktop VPP writer and the shared builder
 * openplc-web packs with.
 *
 * The desktop composes the bundle on disk; openplc-web composes it in memory
 * from a verified archive. Both go through `buildVppPluginFiles`, and this test
 * is what proves the desktop's on-disk result IS that function's output —
 * every file, every byte, no extras. A drift here is a bundle the runtime
 * would compile differently depending on which IDE produced it.
 */

import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, sep } from 'path'

import { buildVppPluginFiles, type VppDevice } from '@root/backend/shared/utils/vpp/build-vpp-plugin-files'

jest.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: {},
  MessageChannelMain: class {},
}))

type FindVppDevice = typeof import('../../../shared/hardware/find-vpp-device')

const listInstalled = jest.fn()
const getInstalledPackageManifest = jest.fn()
const verifyBoardPackageIntegrity = jest.fn(() => ({ ok: true }))

jest.mock('@root/backend/shared/firmware/hals-loader', () => ({
  readHalsFile: jest.fn(async () => ({})),
}))
jest.mock('../../package-manager', () => ({
  formatPackageIntegrityError: () => 'integrity failure',
  PackageManagerModule: jest.fn().mockImplementation(() => {
    const port = { listInstalled, getInstalledPackageManifest }
    return {
      ...port,
      verifyBoardPackageIntegrity,
      findDeviceByBoardName: (boardName: string) =>
        (jest.requireActual('../../../shared/hardware/find-vpp-device') as FindVppDevice).findVppDeviceByBoardName(
          port,
          boardName,
        ),
    }
  }),
}))

// eslint-disable-next-line import/first
import { CompilerModule } from '../compiler-module'

const BOARD = 'SLM-RP4'
const handler = CompilerModule.prototype.handleVendorPluginPackaging

const SIGNATURE = {
  formatVersion: '1.0',
  alg: 'ed25519',
  keyId: 'openplc-2026',
  packageId: 'com.synergy-logic.slm-rp4',
  version: '0.3.1',
  signedAt: '2026-09-01T00:00:00.000Z',
  files: { 'manifest.json': 'aa' },
}

const HAL = {
  type: 'runtime-v4-plugin',
  pluginType: 'native',
  pluginEntry: 'hal/plugin/main.cpp',
  configTemplate: 'hal/plugin/config_template.json',
}

const PACKAGE_FILE_CONTENT: Record<string, string> = {
  'hal/plugin/main.cpp': 'int main(){ return 0; }\n',
  'hal/plugin/Makefile': 'all:\n\t$(CC) main.cpp\n',
  'hal/plugin/nested/driver.c': 'void drive(void) {}\n',
  'hal/plugin/config_template.json': JSON.stringify({ plugin_name: 'synergy', baud: 9600 }),
  'hal/plugin/requirements.txt': 'pyserial\n',
  'signature.json': JSON.stringify(SIGNATURE),
}

const VENDOR_SCREEN_DATA = { general: { baud: 115200, label: 'line-a' } }

function makeDevice(): VppDevice {
  return {
    id: 'slm-rp4',
    name: BOARD,
    preview: 'assets/logo.png',
    target: { type: 'runtime-v4' },
    hal: HAL,
  } as unknown as VppDevice
}

/** Every regular file under `dir`, as POSIX paths relative to it. */
function walk(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const childRel = rel ? `${rel}/${entry}` : entry
    if (statSync(full).isDirectory()) out.push(...walk(full, childRel))
    else out.push(childRel)
  }
  return out.sort()
}

describe('VPP bundle parity — desktop writer vs shared builder', () => {
  let pkgDir: string
  let projectDir: string
  let targetDir: string

  beforeEach(() => {
    jest.clearAllMocks()
    pkgDir = mkdtempSync(join(tmpdir(), 'vpp-parity-pkg-'))
    projectDir = mkdtempSync(join(tmpdir(), 'vpp-parity-proj-'))
    targetDir = mkdtempSync(join(tmpdir(), 'vpp-parity-target-'))

    for (const [rel, content] of Object.entries(PACKAGE_FILE_CONTENT)) {
      const absolute = join(pkgDir, ...rel.split('/'))
      mkdirSync(join(absolute, '..'), { recursive: true })
      writeFileSync(absolute, content)
    }
    mkdirSync(join(projectDir, 'devices'), { recursive: true })
    writeFileSync(
      join(projectDir, 'devices', 'configuration.json'),
      JSON.stringify({ vendorScreenData: VENDOR_SCREEN_DATA }),
    )

    listInstalled.mockReturnValue([{ packageId: 'com.synergy-logic.slm-rp4', path: pkgDir }])
    getInstalledPackageManifest.mockReturnValue({ devices: [makeDevice()] })
  })

  afterEach(() => {
    for (const dir of [pkgDir, projectDir, targetDir]) rmSync(dir, { recursive: true, force: true })
  })

  it('writes exactly the files the shared builder produces, byte for byte', async () => {
    await handler.call(
      Object.create(CompilerModule.prototype) as CompilerModule,
      BOARD,
      projectDir,
      targetDir,
      () => undefined,
    )

    // The same inputs openplc-web hands the builder, out of a verified archive.
    const packageFiles = new Map<string, Uint8Array>()
    for (const rel of ['hal/plugin/config_template.json', 'hal/plugin/main.cpp', 'hal/plugin/Makefile', 'hal/plugin/nested/driver.c']) {
      packageFiles.set(rel, Uint8Array.from(readFileSync(join(pkgDir, ...rel.split('/')))))
    }
    const expected = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles,
      packageSignature: SIGNATURE,
      vendorScreenData: VENDOR_SCREEN_DATA,
      sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
    })

    expect(expected.errors).toEqual([])
    expect(walk(targetDir)).toEqual(Object.keys(expected.files).sort())

    for (const [rel, bytes] of Object.entries(expected.files)) {
      const onDisk = Uint8Array.from(readFileSync(join(targetDir, ...rel.split('/'))))
      expect({ file: rel, bytes: Buffer.from(onDisk).toString('base64') }).toEqual({
        file: rel,
        bytes: Buffer.from(bytes).toString('base64'),
      })
    }
  })

  it('removes a previous build tree instead of leaving stale plugin files behind', async () => {
    const stale = join(targetDir, 'vpp_plugin', 'gone.c')
    mkdirSync(join(targetDir, 'vpp_plugin'), { recursive: true })
    writeFileSync(stale, 'void gone(void) {}\n')

    await handler.call(
      Object.create(CompilerModule.prototype) as CompilerModule,
      BOARD,
      projectDir,
      targetDir,
      () => undefined,
    )

    expect(walk(targetDir)).not.toContain('vpp_plugin/gone.c')
  })

  it('never writes outside the bundle directory', async () => {
    await handler.call(
      Object.create(CompilerModule.prototype) as CompilerModule,
      BOARD,
      projectDir,
      targetDir,
      () => undefined,
    )

    for (const rel of walk(targetDir)) {
      expect(relative(targetDir, join(targetDir, ...rel.split('/'))).startsWith(`..${sep}`)).toBe(false)
    }
  })
})
