import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { MEGA, NO_PAGES, UNO } from './fixtures/baremetal-modbus-master/build-package'
import {
  launchProject,
  openTreeItem,
  readProjectJson,
  remoteDevice,
  save,
  shutdown,
  writeModbusMasterProject,
} from './helpers/modbus-master-project'

const RECONNECT_HELP =
  'When unchecked, the device is given up after a failed first connection or a lost connection, including a brief network fault or a reset sent by another host, and is not contacted again until Stop then Start or a reset of the controller. Check Reconnect for production devices: the master then retries after 2 s, growing x1.5 up to 30 s.'
const TIMEOUT_HELP = 'On a microcontroller, each connection attempt can hold the scan for up to this time.'

const tcpDevice = (name: string, extra: Record<string, unknown> = {}) =>
  remoteDevice(name, { transport: 'tcp', host: '192.168.1.60', port: 502, reconnect: true, ...extra })

const rtuDevice = (name: string, serialPort: string, extra: Record<string, unknown> = {}) =>
  remoteDevice(name, { transport: 'rtu', serialPort, baudRate: 19200, parity: 'N', stopBits: 1, dataBits: 8, ...extra })

/** Names of the options a Radix select lists once its trigger is opened; closes it again. */
async function selectOptions(page: Page, testId: string): Promise<string[]> {
  await page.getByTestId(testId).click()
  const options = page.getByRole('option')
  await expect(options.first()).toBeVisible()
  const names = await options.allInnerTexts()
  await page.keyboard.press('Escape')
  return names.map((name) => name.trim())
}

/** UARTs the RTU Serial Port combobox lists; closes it again. */
async function serialPortOptions(page: Page): Promise<string[]> {
  await page.getByTestId('remote-device-serial-port-select').getByRole('button').click()
  const options = page.getByRole('menu').getByRole('option')
  await expect(options.first()).toBeVisible()
  const names = await options.allInnerTexts()
  await page.keyboard.press('Escape')
  return names.map((name) => name.trim())
}

async function chooseTransport(page: Page, label: 'TCP/IP' | 'RTU (Serial)'): Promise<void> {
  await page.getByTestId('remote-device-transport-select').click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(page.getByTestId('remote-device-transport-select')).toContainText(label)
}

/** The tab strip entry of an open editor named `name`. */
const editorTab = (page: Page, name: string) =>
  page.getByRole('tab').filter({ has: page.getByText(new RegExp(`^(\\* )?${name}$`)) })

/** Creates a Modbus remote device named `name` from the "+" menu. */
async function createModbusDevice(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create PLC element trigger component' }).click({ timeout: 30000 })
  await page.getByTestId('create-remote-device').hover()
  const nameField = page.locator('#remote-device-name')
  await expect(nameField, 'the Remote Device card offers its creation form').toBeVisible()
  await nameField.fill(name)
  await page.getByRole('combobox', { name: 'remote-device-protocol' }).click()
  await page.getByRole('option', { name: 'Modbus', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
}

test('a Mega offers TCP and its spare UARTs, with Reconnect help, the Timeout help on TCP and links to its pages', async () => {
  test.setTimeout(180000)
  const { userData } = writeModbusMasterProject('mega-screen', { board: MEGA, remoteDevices: [tcpDevice('Gateway')] })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Gateway')

    expect(await selectOptions(page, 'remote-device-transport-select')).toEqual(['TCP/IP', 'RTU (Serial)'])
    await expect(page.getByTestId('remote-device-reconnect-help')).toHaveText(RECONNECT_HELP)
    await expect(page.getByTestId('remote-device-reconnect-checkbox')).toHaveAttribute(
      'aria-describedby',
      (await page.getByTestId('remote-device-reconnect-help').getAttribute('id')) ?? 'missing',
    )
    await expect(page.getByTestId('remote-device-timeout-help')).toHaveText(TIMEOUT_HELP)
    await expect(page.getByTestId('remote-device-board-serial-link')).toHaveCount(0)

    await page.getByTestId('remote-device-board-network-link').getByRole('button').click()
    await expect(editorTab(page, 'Network')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByLabel('Enable Network')).toBeVisible()

    await openTreeItem(page, 'Gateway')
    await chooseTransport(page, 'RTU (Serial)')
    expect(await serialPortOptions(page)).toEqual(['Serial1', 'Serial2', 'Serial3'])
    await expect(page.getByTestId('remote-device-reconnect-checkbox')).toHaveCount(0)
    await expect(page.getByTestId('remote-device-timeout-help')).toHaveCount(0)
    await expect(page.getByTestId('remote-device-board-network-link')).toHaveCount(0)

    await page.getByTestId('remote-device-board-serial-link').getByRole('button').click()
    await expect(editorTab(page, 'Serial')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('serial-rs485-pins')).toBeVisible()
  } finally {
    await shutdown(app)
  }
})

test('a new Remote Device on a Mega starts on TCP with Reconnect unchecked and saves it so', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeModbusMasterProject('mega-create', { board: MEGA })
  const { app, page } = await launchProject(userData)
  try {
    await createModbusDevice(page, 'Gateway')

    await openTreeItem(page, 'Gateway')
    await expect(page.getByTestId('remote-device-transport-select')).toContainText('TCP/IP')
    await expect(page.getByTestId('remote-device-reconnect-checkbox')).toHaveAttribute('aria-checked', 'false')
    await save(app)
    await expect
      .poll(() => readProjectJson(project, 'devices', 'remote', 'Gateway.json'), { timeout: 15000 })
      .toMatchObject({ modbusTcpConfig: { transport: 'tcp', reconnect: false } })
  } finally {
    await shutdown(app)
  }
})

test('an Uno offers TCP only, and a board without settings pages disables its links with the reason', async () => {
  test.setTimeout(180000)
  const { userData } = writeModbusMasterProject('uno-screen', { board: UNO, remoteDevices: [tcpDevice('Gateway')] })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Gateway')
    expect(await selectOptions(page, 'remote-device-transport-select')).toEqual(['TCP/IP'])
    await expect(page.getByTestId('remote-device-board-network-link').getByRole('button')).toBeEnabled()
  } finally {
    await shutdown(app)
  }

  const bare = writeModbusMasterProject('no-pages-screen', {
    board: NO_PAGES,
    remoteDevices: [tcpDevice('Gateway'), rtuDevice('Drive', 'Serial1')],
  })
  const second = await launchProject(bare.userData)
  try {
    await openTreeItem(second.page, 'Gateway')
    const networkLink = second.page.getByTestId('remote-device-board-network-link')
    await expect(networkLink.getByRole('button', { name: /Board network settings/ })).toBeDisabled()
    await networkLink.getByLabel('Field help').focus()
    await expect(second.page.getByRole('tooltip')).toContainText("This board's package has no network settings page.")

    await openTreeItem(second.page, 'Drive')
    const serialLink = second.page.getByTestId('remote-device-board-serial-link')
    await expect(serialLink.getByRole('button', { name: /Board serial settings/ })).toBeDisabled()
    await serialLink.getByLabel('Field help').focus()
    await expect(second.page.getByRole('tooltip')).toContainText("This board's package has no serial settings page.")
  } finally {
    await shutdown(second.app)
  }
})

test('switching a Mega project with an RTU device on Serial2 to an Uno warns that the build will be refused', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeModbusMasterProject('switch-to-uno', {
    board: MEGA,
    remoteDevices: [rtuDevice('Drive', 'Serial2')],
  })
  const { app, page } = await launchProject(userData)
  try {
    await openTreeItem(page, 'Configuration')
    await page.getByRole('combobox', { name: 'Device selection' }).click({ timeout: 30000 })
    await page.getByRole('option', { name: UNO, exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Remote Devices Not Supported')
    await expect(dialog).toContainText(`(${UNO}) cannot run the remote device "Drive"`)
    await expect(dialog).toContainText('stay in the project')
    await expect(dialog).toContainText('refused')
    await expect(dialog).toContainText('fixed or removed')
    await dialog.getByRole('button', { name: 'Continue Anyway' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Device selection' })).toContainText(UNO)

    await save(app)
    await expect
      .poll(() => readProjectJson(project, 'devices', 'configuration.json'), { timeout: 15000 })
      .toMatchObject({ deviceBoard: UNO })
    expect(readProjectJson(project, 'devices', 'remote', 'Drive.json')).toMatchObject({
      modbusTcpConfig: { transport: 'rtu', serialPort: 'Serial2' },
    })
  } finally {
    await shutdown(app)
  }
})
