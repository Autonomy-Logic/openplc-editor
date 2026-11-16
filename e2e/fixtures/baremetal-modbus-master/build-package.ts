/**
 * Installs an unsigned e2e package of Arduino-style baremetal boards for the Modbus master specs: a Mega
 * with four UARTs and a Network screen, an Uno with one UART, a board with no settings pages and a board
 * whose package fixes the RS-485 pin of one UART. The editor removes unsigned packages when a project
 * opens, so a suite using it must stub `packages:verify-signatures` first.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BAREMETAL_PACKAGE_ID = 'com.e2e.baremetal-modbus-master'
export const MEGA = 'E2E Mega'
export const UNO = 'E2E Uno'
export const NO_PAGES = 'E2E Board Without Pages'
export const FIXED_PIN = 'E2E Fixed Pin Board'

const PREVIEW_PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
)

/** A per-UART Serial screen: the default UART's speed and one RS-485 pin per UART. */
const SERIAL_SCREEN = {
  sections: [
    {
      id: 'serial',
      title: 'Serial Port',
      layout: 'form',
      collapsible: true,
      collapsed: false,
      fields: [
        {
          id: 'baud_rate',
          label: 'Baud Rate',
          type: 'select',
          options: ['9600', '19200', '38400', '57600', '115200'],
          default: '115200',
        },
        {
          id: 'rs485_en_pins',
          label: 'RS-485 EN Pin',
          type: 'uart-pin-map',
          optionsRef: 'board.serialPorts',
          validation: '^[A-Z]{0,2}\\d{1,3}$',
        },
      ],
    },
  ],
}

const NETWORK_SCREEN = {
  sections: [
    {
      id: 'network',
      title: 'Network',
      layout: 'form',
      collapsible: true,
      collapsed: false,
      fields: [
        { id: 'enabled', label: 'Enable Network', type: 'boolean', default: false },
        {
          id: 'ip_address',
          label: 'IP Address',
          type: 'ip-address',
          default: '',
          visible: { condition: 'fields.enabled', operator: 'equals', value: true },
        },
      ],
    },
  ],
}

const avrDevice = (id: string, name: string, platform: string, extra: Record<string, unknown>) => ({
  id,
  name,
  category: 'Development Board',
  preview: 'preview.png',
  target: { type: 'arduino-cli', core: 'arduino:avr', platform },
  hal: { type: 'arduino-hal', source: 'hal/board.cpp' },
  defaults: { pins: { defaultDin: ['2', '3'], defaultDout: ['7', '8'], defaultAin: ['A0'], defaultAout: ['9'] } },
  defaultSerial: 'Serial',
  ...extra,
})

const DEVICES = [
  avrDevice('e2e-mega', MEGA, 'arduino:avr:mega', {
    serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
    screens: { Serial: 'screens/serial.json', Network: 'screens/network.json' },
    networkInterfaces: ['Ethernet'],
    capabilities: { modbusTcpMaster: true },
  }),
  avrDevice('e2e-uno', UNO, 'arduino:avr:uno', {
    serialPorts: ['Serial'],
    screens: { Serial: 'screens/serial.json', Network: 'screens/network.json' },
    networkInterfaces: ['Ethernet'],
    capabilities: { modbusTcpMaster: true },
  }),
  avrDevice('e2e-no-pages', NO_PAGES, 'arduino:avr:mega', {
    serialPorts: ['Serial', 'Serial1'],
    capabilities: { modbusTcpMaster: true },
  }),
  avrDevice('e2e-fixed-pin', FIXED_PIN, 'arduino:avr:mega', {
    serialPorts: ['Serial', 'Serial3'],
    rs485FixedPins: { Serial3: 'PA14' },
    screens: { Serial: 'screens/serial.json' },
  }),
]

/** Writes the package under `packagesDir` and a `registry.json` listing only it; returns the package root. */
export function installBaremetalPackage(packagesDir: string): string {
  const root = join(packagesDir, BAREMETAL_PACKAGE_ID)
  mkdirSync(join(root, 'screens'), { recursive: true })
  mkdirSync(join(root, 'hal'), { recursive: true })
  writeFileSync(join(root, 'screens', 'serial.json'), JSON.stringify(SERIAL_SCREEN))
  writeFileSync(join(root, 'screens', 'network.json'), JSON.stringify(NETWORK_SCREEN))
  writeFileSync(join(root, 'hal', 'board.cpp'), '')
  writeFileSync(join(root, 'preview.png'), PREVIEW_PNG)
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      formatVersion: '1.0',
      package: {
        id: BAREMETAL_PACKAGE_ID,
        name: 'E2E Baremetal Modbus Master',
        version: '1.0.0',
        vendor: { name: 'E2E' },
      },
      devices: DEVICES,
    }),
  )
  writeFileSync(
    join(packagesDir, 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      packages: {
        [BAREMETAL_PACKAGE_ID]: {
          version: '1.0.0',
          installedAt: new Date().toISOString(),
          path: root,
          devices: DEVICES.map((device) => device.id),
        },
      },
    }),
  )
  return root
}
