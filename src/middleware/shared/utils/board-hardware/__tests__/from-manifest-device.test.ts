import type { PackageManifest } from '../../../ports/types'
import { boardHardwareFromManifestDevice } from '../from-manifest-device'

type ManifestDevice = PackageManifest['devices'][number]

const device = (over: Partial<ManifestDevice>): ManifestDevice => ({
  id: 'ws3u-14mx',
  name: 'WS3U-14Mx',
  preview: 'assets/boards/ws3u.png',
  target: { type: 'arduino-cli', core: 'STMicroelectronics:stm32', platform: 'STMicroelectronics:stm32:GenF1' },
  hal: { type: 'arduino-hal', source: 'hal/fx3u.cpp' },
  ...over,
})

describe('boardHardwareFromManifestDevice', () => {
  it('maps the four hardware fields a device declares', () => {
    const fx3u = device({
      serialPorts: ['Serial', 'Serial3'],
      defaultSerial: 'Serial',
      networkInterfaces: ['Ethernet'],
      rs485FixedPins: { Serial3: 'PA14' },
    })

    expect(boardHardwareFromManifestDevice(fx3u)).toEqual({
      serialPorts: ['Serial', 'Serial3'],
      defaultSerial: 'Serial',
      networkInterfaces: ['Ethernet'],
      rs485FixedPins: { Serial3: 'PA14' },
    })
  })

  it('keeps the fixed RS-485 pins of every UART the package fixes', () => {
    const twoFixed = device({
      serialPorts: ['Serial', 'Serial1', 'Serial2'],
      rs485FixedPins: { Serial1: '5', Serial2: 'PB3' },
    })

    expect(boardHardwareFromManifestDevice(twoFixed).rs485FixedPins).toEqual({ Serial1: '5', Serial2: 'PB3' })
  })

  it('keeps the network interfaces', () => {
    expect(boardHardwareFromManifestDevice(device({ networkInterfaces: ['Wi-Fi'] })).networkInterfaces).toEqual([
      'Wi-Fi',
    ])
  })

  it('keeps a declared empty UART list, which claims the board has no UART', () => {
    expect(boardHardwareFromManifestDevice(device({ serialPorts: [] })).serialPorts).toEqual([])
  })

  it('carries none of the fields a device leaves out', () => {
    const mapped = boardHardwareFromManifestDevice(device({}))

    expect(mapped.serialPorts).toBeUndefined()
    expect(mapped.defaultSerial).toBeUndefined()
    expect(mapped.networkInterfaces).toBeUndefined()
    expect(mapped.rs485FixedPins).toBeUndefined()
  })
})
