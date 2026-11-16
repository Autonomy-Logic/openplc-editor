/**
 * The per-UART RS-485 enable pin on a baremetal board's Serial screen: one field per UART, none where the
 * package fixes the pin, the entry check of each value, and where a 4.3.x project's single pin shows up.
 *
 * Boards come from the unsigned e2e package in `fixtures/baremetal-modbus-master/`. Needs a production build
 * and the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { FIXED_PIN, MEGA } from './fixtures/baremetal-modbus-master/build-package'
import {
  launchProject,
  openTreeItem,
  readProjectJson,
  remoteDevice,
  save,
  shutdown,
  writeModbusMasterProject,
} from './helpers/modbus-master-project'

const LEGACY_SERIAL = { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: '2' }

const rtuServer = (serialPort: string) => ({
  name: 'ModbusServer',
  protocol: 'modbus-tcp',
  modbusSlaveConfig: {
    enabled: true,
    transports: ['rtu'],
    networkInterface: '0.0.0.0',
    port: 502,
    slaveId: 1,
    serialPort,
    baudRate: 19200,
    parity: 'N',
    stopBits: 1,
    dataBits: 8,
  },
})

/** A TCP device saved before Reconnect existed: no `reconnect` field. */
const legacyGateway = () => remoteDevice('Gateway', { transport: 'tcp', host: '192.168.1.60', port: 502 })

const pinField = (page: Page, uart: string) => page.getByTestId(`serial-rs485-pin-${uart}`)
const pinAlerts = (page: Page) => page.getByTestId('serial-rs485-pins').getByRole('alert')

type StoredSerial = { rs485_en_pins?: Record<string, string>; rs485_en_pin?: string; enable_rs485_en_pin?: boolean }

const storedSerial = (project: string): StoredSerial | undefined => {
  const config = readProjectJson(project, 'devices', 'configuration.json')
  if (typeof config !== 'object' || config === null || !('vendorScreenData' in config)) return undefined
  const screens: unknown = config.vendorScreenData
  if (typeof screens !== 'object' || screens === null || !('serial' in screens)) return undefined
  const serial: unknown = screens.serial
  return typeof serial === 'object' && serial !== null ? serial : undefined
}

test('the Mega gets one RS-485 pin per UART, and a UART with a package-fixed pin gets none', async () => {
  test.setTimeout(180000)
  const mega = writeModbusMasterProject('pins-mega', { board: MEGA })
  const first = await launchProject(mega.userData)
  try {
    await openTreeItem(first.page, 'Serial')
    for (const uart of ['Serial', 'Serial1', 'Serial2', 'Serial3']) {
      await expect(pinField(first.page, uart)).toBeVisible()
    }
    await expect(first.page.getByTestId('serial-rs485-pins').getByRole('textbox')).toHaveCount(4)
  } finally {
    await shutdown(first.app)
  }

  const fixed = writeModbusMasterProject('pins-fixed', { board: FIXED_PIN })
  const second = await launchProject(fixed.userData)
  try {
    await openTreeItem(second.page, 'Serial')
    await expect(pinField(second.page, 'Serial')).toBeVisible()
    await expect(pinField(second.page, 'Serial3')).toHaveCount(0)
    await expect(second.page.getByTestId('serial-rs485-pins').getByRole('textbox')).toHaveCount(1)
  } finally {
    await shutdown(second.app)
  }
})

test('a Serial1 pin is accepted as a pin name and refused otherwise, naming Serial1 and the RS-485 pin', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeModbusMasterProject('pins-format', { board: MEGA })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Serial')
    const field = pinField(page, 'Serial1')

    for (const accepted of ['2', '13', '999', 'A0', 'PA14']) {
      await field.fill(accepted)
      await field.blur()
      await expect(pinAlerts(page)).toHaveCount(0)
      await expect(field).toHaveAttribute('aria-invalid', 'false')
    }

    for (const refused of ['pa14', 'PA1234', 'ABC1', '-1', '2;']) {
      await field.fill(refused)
      await field.blur()
      await expect(pinAlerts(page)).toHaveText([
        'RS-485 pin of Serial1 must be up to two capital letters followed by one to three digits, such as 22, A0 or PA14.',
      ])
      await expect(field).toHaveAttribute('aria-invalid', 'true')
    }

    await save(app)
    await expect.poll(() => storedSerial(project)?.rs485_en_pins, { timeout: 15000 }).toEqual({ Serial1: 'PA14' })
  } finally {
    await shutdown(app)
  }
})

test('a 4.3.x pin shows on the RTU server UART, and Reconnect of an older TCP device loads checked', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeModbusMasterProject('pins-migration-server', {
    board: MEGA,
    vendorScreenData: { serial: LEGACY_SERIAL },
    servers: [rtuServer('Serial1')],
    remoteDevices: [legacyGateway()],
  })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Serial')
    await expect(pinField(page, 'Serial1')).toHaveValue('2')
    for (const uart of ['Serial', 'Serial2', 'Serial3']) await expect(pinField(page, uart)).toHaveValue('')

    await openTreeItem(page, 'Gateway')
    await expect(page.getByTestId('remote-device-reconnect-checkbox')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('remote-device-timeout-input').fill('900')
    await page.getByTestId('remote-device-timeout-input').blur()
    await save(app)
    await expect
      .poll(() => readProjectJson(project, 'devices', 'remote', 'Gateway.json'), { timeout: 15000 })
      .toMatchObject({ modbusTcpConfig: { timeout: 900, reconnect: true } })
  } finally {
    await shutdown(app)
  }
})

test('with no RTU server a 4.3.x pin shows on no UART, and the first per-UART pin replaces it', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeModbusMasterProject('pins-migration-none', {
    board: MEGA,
    vendorScreenData: { serial: LEGACY_SERIAL },
  })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Serial')
    for (const uart of ['Serial', 'Serial1', 'Serial2', 'Serial3']) await expect(pinField(page, uart)).toHaveValue('')

    await pinField(page, 'Serial2').fill('5')
    await save(app)
    await expect.poll(() => storedSerial(project)?.rs485_en_pins, { timeout: 15000 }).toEqual({ Serial2: '5' })
    const serial = storedSerial(project)
    expect(serial?.rs485_en_pin).toBeUndefined()
    expect(serial?.enable_rs485_en_pin).toBeUndefined()
  } finally {
    await shutdown(app)
  }
})
