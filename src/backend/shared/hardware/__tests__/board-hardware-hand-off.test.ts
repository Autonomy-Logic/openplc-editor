import type { InstalledPackage, PackageManifest } from '../../../../middleware/shared/ports/types'
import { boardHardwareFromManifestDevice } from '../../../../middleware/shared/utils/board-hardware/from-manifest-device'
import { resolveBoardSelection } from '../../compile/steps/resolve-board-selection'
import { BoardInfoResolver, type HalsFileContent } from '../board-info-resolver'

type ManifestDevice = PackageManifest['devices'][number]

const PKG_PATH = '/fake/user-data/packages/com.openplc.fx3u-compatible'

const WS3U: ManifestDevice = {
  id: 'ws3u-14mx',
  name: 'WS3U-14Mx',
  preview: 'assets/boards/ws3u.png',
  target: { type: 'arduino-cli', core: 'STMicroelectronics:stm32', platform: 'STMicroelectronics:stm32:GenF1' },
  hal: { type: 'arduino-hal', source: 'hal/fx3u.cpp' },
  serialPorts: ['Serial', 'Serial3'],
  defaultSerial: 'Serial',
  networkInterfaces: ['Ethernet'],
  rs485FixedPins: { Serial3: 'PA14' },
}

/** A device of the same package that declares no fixed pin and ships no screen. */
const PLAIN: ManifestDevice = {
  id: 'fx3u-14m',
  name: 'FX3U-14M',
  preview: 'assets/boards/fx3u.png',
  target: { type: 'arduino-cli', core: 'STMicroelectronics:stm32', platform: 'STMicroelectronics:stm32:GenF1' },
  hal: { type: 'arduino-hal', source: 'hal/fx3u.cpp' },
  serialPorts: ['Serial', 'Serial1'],
  defaultSerial: 'Serial',
}

const MANIFEST: PackageManifest = {
  formatVersion: '1.0',
  package: {
    id: 'com.openplc.fx3u-compatible',
    name: 'FX3U-compatible boards',
    version: '1.0.0',
    vendor: { name: 'OpenPLC', logo: 'assets/logo.png' },
    description: 'desc',
  },
  devices: [WS3U, PLAIN],
}

const PKG: InstalledPackage = {
  packageId: 'com.openplc.fx3u-compatible',
  version: '1.0.0',
  installedAt: '2026-11-13T00:00:00.000Z',
  path: PKG_PATH,
  devices: ['ws3u-14mx', 'fx3u-14m'],
}

function makeResolver(halsContent: HalsFileContent = {}): BoardInfoResolver {
  return new BoardInfoResolver({
    halsContent,
    packageManager: {
      listInstalled: () => [PKG],
      getInstalledPackageManifest: (id) => (id === PKG.packageId ? MANIFEST : null),
    },
    resolveHalSourcePath: (rel) => `/fake/sources/${rel}`,
    resolvePackageRelativePath: (pkg, rel) => `${pkg}/${rel}`,
  })
}

describe('board hardware fields on the build side', () => {
  it('gives BoardBuildInfo the hardware fields of the shared mapping, fixed RS-485 pins included', () => {
    const info = makeResolver().resolve('WS3U-14Mx')
    const mapped = boardHardwareFromManifestDevice(WS3U)

    expect({
      serialPorts: info.serialPorts,
      defaultSerial: info.defaultSerial,
      networkInterfaces: info.networkInterfaces,
      rs485FixedPins: info.rs485FixedPins,
    }).toEqual(mapped)
    expect(info.rs485FixedPins).toEqual({ Serial3: 'PA14' })
  })

  it('gives a hals.json board no fixed RS-485 pins', () => {
    const info = makeResolver({ 'OpenPLC Runtime v4': { compiler: 'openplc-compiler' } }).resolve('OpenPLC Runtime v4')

    expect(info.rs485FixedPins).toBeUndefined()
  })

  it('hands the fixed RS-485 pins to the build entry', () => {
    const selection = resolveBoardSelection(makeResolver(), 'WS3U-14Mx')

    expect(selection.ok).toBe(true)
    if (selection.ok) {
      expect(selection.boardEntry.rs485FixedPins).toEqual({ Serial3: 'PA14' })
      expect(selection.boardEntry.serialPorts).toEqual(['Serial', 'Serial3'])
    }
  })

  it('marks a device that declares fixed RS-485 pins as per-UART aware, and hands that to the build entry', () => {
    expect(makeResolver().resolve('WS3U-14Mx').perUartAware).toBe(true)

    const selection = resolveBoardSelection(makeResolver(), 'WS3U-14Mx')
    expect(selection.ok).toBe(true)
    if (selection.ok) expect(selection.boardEntry.perUartAware).toBe(true)
  })

  it('marks a device with neither fixed pins nor a uart-pin-map field as not per-UART aware', () => {
    expect(makeResolver().resolve('FX3U-14M').perUartAware).toBe(false)

    const selection = resolveBoardSelection(makeResolver(), 'FX3U-14M')
    expect(selection.ok).toBe(true)
    if (selection.ok) expect(selection.boardEntry.perUartAware).toBe(false)
  })

  it('marks a hals.json board as not per-UART aware', () => {
    const info = makeResolver({ 'OpenPLC Runtime v4': { compiler: 'openplc-compiler' } }).resolve('OpenPLC Runtime v4')

    expect(info.perUartAware).toBe(false)
  })
})
