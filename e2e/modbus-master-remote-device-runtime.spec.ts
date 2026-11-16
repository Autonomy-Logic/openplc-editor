/**
 * The Remote Device screen and build on Runtime v4 and the Simulator: a new device starts with Reconnect
 * unchecked, the Reconnect help shows on every target while the Timeout help and the board links stay
 * baremetal only, Reconnect reaches the Runtime v4 master config, and the agreement checks refuse a build.
 *
 * Needs a production build and the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  consolePanel,
  launchProject,
  openTreeItem,
  readProjectJson,
  remoteDevice,
  save,
  shutdown,
  writeModbusMasterProject,
} from './helpers/modbus-master-project'

const RUNTIME_V4 = 'OpenPLC Runtime v4'
const SIMULATOR = 'OpenPLC Simulator'
const RECONNECT_HELP_START = 'When unchecked, the device is given up after a failed first connection'

const readGroup = (location: string) => ({
  id: 'g1',
  name: 'READS',
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 1,
  errorHandling: 'set-to-zero',
  ioPoints: [{ id: 'p0', name: 'p0', type: 'register', iecLocation: location }],
})

const tcpDevice = (name: string, extra: Record<string, unknown>) =>
  remoteDevice(name, { transport: 'tcp', host: '192.168.1.60', port: 502, ...extra })

async function createModbusDevice(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create PLC element trigger component' }).click({ timeout: 30000 })
  await page.getByTestId('create-remote-device').hover()
  await page.locator('#remote-device-name').fill(name)
  await page.getByRole('combobox', { name: 'remote-device-protocol' }).click()
  await page.getByRole('option', { name: 'Modbus', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
}

async function expectNoBaremetalAids(page: Page): Promise<void> {
  await expect(page.getByTestId('remote-device-timeout-input')).toBeVisible()
  await expect(page.getByTestId('remote-device-timeout-help')).toHaveCount(0)
  await expect(page.getByTestId('remote-device-board-network-link')).toHaveCount(0)
  await expect(page.getByTestId('remote-device-board-serial-link')).toHaveCount(0)
}

/** Every file named `name` under `dir`, depth first. */
function findFiles(dir: string, name: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...findFiles(path, name))
    else if (entry === name) found.push(path)
  }
  return found
}

async function buildOnly(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
  await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })
}

/** Starts a build for `board`: Build only, or Start on the Simulator, which builds before it runs. */
async function startBuild(page: Page, board: string): Promise<void> {
  if (board === SIMULATOR) await page.getByRole('button', { name: 'Play' }).click({ timeout: 30000 })
  else await buildOnly(page)
}

test('a new Runtime v4 device starts with Reconnect unchecked and its help, with no Timeout help or board links', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeModbusMasterProject('v4-create', { board: RUNTIME_V4 })
  const { app, page } = await launchProject(userData)
  try {
    await createModbusDevice(page, 'Meter')
    await openTreeItem(page, 'Meter')

    await expect(page.getByTestId('remote-device-transport-select')).toContainText('TCP/IP')
    await expect(page.getByTestId('remote-device-reconnect-checkbox')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('remote-device-reconnect-help')).toContainText(RECONNECT_HELP_START)
    await expectNoBaremetalAids(page)

    await page.getByTestId('remote-device-transport-select').click()
    await page.getByRole('option', { name: 'RTU (Serial)', exact: true }).click()
    await expect(page.getByTestId('remote-device-serial-port-select')).toBeVisible()
    await expectNoBaremetalAids(page)
    await page.getByTestId('remote-device-transport-select').click()
    await page.getByRole('option', { name: 'TCP/IP', exact: true }).click()
    await expect(page.getByTestId('remote-device-reconnect-checkbox')).toHaveAttribute('aria-checked', 'false')

    await save(app)
    await expect
      .poll(() => readProjectJson(project, 'devices', 'remote', 'Meter.json'), { timeout: 15000 })
      .toMatchObject({ modbusTcpConfig: { transport: 'tcp', reconnect: false } })
  } finally {
    await shutdown(app)
  }
})

test('a Simulator device shows the Reconnect help and no Timeout help or board links', async () => {
  test.setTimeout(180000)
  const { userData } = writeModbusMasterProject('simulator-screen', {
    board: SIMULATOR,
    remoteDevices: [tcpDevice('Meter', { reconnect: false })],
  })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Meter')
    await expect(page.getByTestId('remote-device-reconnect-help')).toContainText(RECONNECT_HELP_START)
    await expectNoBaremetalAids(page)
  } finally {
    await shutdown(app)
  }
})

test('Reconnect reaches the Runtime v4 master config: unchecked as false, an older device as true', async () => {
  test.setTimeout(300000)
  const { project, userData } = writeModbusMasterProject('v4-config', {
    board: RUNTIME_V4,
    remoteDevices: [
      tcpDevice('Meter', { reconnect: false, ioGroups: [readGroup('%IW100')] }),
      tcpDevice('Pump', { host: '192.168.1.61', ioGroups: [readGroup('%IW200')] }),
    ],
  })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Meter')
    await expect(page.getByTestId('remote-device-reconnect-checkbox')).toHaveAttribute('aria-checked', 'false')
    await buildOnly(page)
    await expect(consolePanel(page).getByText('Compile only mode — skipping upload to runtime.').first()).toBeVisible({
      timeout: 240000,
    })

    const configs = findFiles(join(project, 'build'), 'modbus_master.json')
    expect(configs).toHaveLength(1)
    const devices: unknown = JSON.parse(readFileSync(configs[0], 'utf-8'))
    expect(devices).toEqual([
      expect.objectContaining({
        name: 'Meter',
        config: expect.objectContaining({ host: '192.168.1.60', reconnect: false }),
      }),
      expect.objectContaining({
        name: 'Pump',
        config: expect.objectContaining({ host: '192.168.1.61', reconnect: true }),
      }),
    ])
  } finally {
    await shutdown(app)
  }
})

test('Runtime v4 and the Simulator refuse devices that disagree on Reconnect or on the baud rate', async () => {
  test.setTimeout(300000)
  const devices = [
    tcpDevice('PumpA', { host: '192.168.1.50', reconnect: true, ioGroups: [readGroup('%IW100')] }),
    tcpDevice('PumpB', { host: '192.168.1.50', reconnect: false, slaveId: 2, ioGroups: [readGroup('%IW101')] }),
    remoteDevice('Drive1', {
      transport: 'rtu',
      serialPort: '/dev/ttyUSB0',
      baudRate: 9600,
      ioGroups: [readGroup('%IW110')],
    }),
    remoteDevice('Drive2', {
      transport: 'rtu',
      serialPort: '/dev/ttyUSB0',
      baudRate: 19200,
      slaveId: 2,
      ioGroups: [readGroup('%IW111')],
    }),
  ]
  for (const board of [RUNTIME_V4, SIMULATOR]) {
    const slug = board === RUNTIME_V4 ? 'v4-refusal' : 'simulator-refusal'
    const { project, userData } = writeModbusMasterProject(slug, { board, remoteDevices: devices })
    const { app, page } = await launchProject(userData)
    try {
      await openTreeItem(page, 'PumpA')
      await startBuild(page, board)
      const output = consolePanel(page)
      await expect(
        output.getByText('Remote devices "PumpA" and "PumpB" on 192.168.1.50:502 disagree on Reconnect.').first(),
      ).toBeVisible({ timeout: 120000 })
      await expect(
        output.getByText('Remote devices "Drive1" and "Drive2" on /dev/ttyUSB0 disagree on the baud rate.').first(),
      ).toBeVisible()
      await expect(output.getByText('Stopping compilation process.').first()).toBeVisible()
      await expect(output.getByText('Generating Structured Text...')).toHaveCount(0)
      expect(findFiles(project, 'modbus_master.json')).toEqual([])
    } finally {
      await shutdown(app)
    }
  }
})
