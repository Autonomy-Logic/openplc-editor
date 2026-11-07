import { expect, test } from '@playwright/test'

import {
  DEVICE_PASSWORD,
  DEVICE_USER,
  type FakeDevice,
  freshDeviceProfile,
  PROVISIONING_HOST,
  startFakeDevice,
} from './helpers/fake-provisioning-device'
import { RuntimeProvisioningPage, writeProvisioningProject } from './pages/runtime-provisioning'

const DEBUGGER_REQUEST_ENDED = 'The debugger was not started because the editor is not connected to the OpenPLC Runtime'

test.describe.configure({ mode: 'default' })

/** Asserts the fake device only had its SSH greeting read: no client bytes, no login, no command. */
function expectGreetingOnly(device: FakeDevice): void {
  expect(device.connections.every((connection) => connection.clientBytes === 0)).toBe(true)
  expect(device.connections.flatMap((connection) => connection.authAttempts)).toHaveLength(0)
  expect(device.execs).toHaveLength(0)
}

test('the offer lists what will be done, with the ports, and needs both credentials', async () => {
  test.setTimeout(120000)
  const device = await startFakeDevice(freshDeviceProfile())
  const screen = await RuntimeProvisioningPage.open(writeProvisioningProject('offer-list', PROVISIONING_HOST))
  try {
    await screen.reachOfferThroughPort(device.sshPort)
    const toggle = screen.whatWillBeDone.getByRole('button')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(screen.whatWillBeDone).not.toContainText('TCP 8443')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(screen.whatWillBeDone).toContainText(
      'If an OpenPLC Runtime is already installed but stopped, what is stopped is started.',
    )
    await expect(screen.whatWillBeDone).toContainText('A script is downloaded from runtime.getedge.me')
    await expect(screen.whatWillBeDone).toContainText('The device then listens on TCP 8443, TCP 8445 and UDP 33333.')

    await expect(screen.submit).toBeDisabled()
    await screen.username.fill(DEVICE_USER)
    await expect(screen.submit).toBeDisabled()
    await screen.username.fill('')
    await screen.password.fill(DEVICE_PASSWORD)
    await expect(screen.submit).toBeDisabled()
    await screen.username.fill(DEVICE_USER)
    await expect(screen.submit).toBeEnabled()
    await expect(screen.password).toHaveAttribute('type', 'password')
    expectGreetingOnly(device)
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('an SSH port refused in the offer is reported and nothing reaches the device', async () => {
  test.setTimeout(120000)
  const device = await startFakeDevice(freshDeviceProfile())
  const screen = await RuntimeProvisioningPage.open(writeProvisioningProject('offer-port', PROVISIONING_HOST))
  try {
    await screen.reachOfferThroughPort(device.sshPort)
    await screen.sshPort.fill('70000')
    await screen.submitCredentials(DEVICE_USER, DEVICE_PASSWORD)
    await expect(screen.dialog).toContainText('The SSH port was refused: it must be a whole number from 1 to 65535.')
    await expect(screen.submit).toBeVisible()
    expectGreetingOnly(device)
  } finally {
    await screen.quit()
    await device.close()
  }
})

for (const { action, dismiss } of [
  { action: 'Decline', dismiss: (screen: RuntimeProvisioningPage) => screen.decline.click() },
  {
    action: 'the X button',
    dismiss: (screen: RuntimeProvisioningPage) =>
      screen.dialog.getByRole('button', { name: 'Close Icon', exact: true }).click(),
  },
  { action: 'Escape', dismiss: (screen: RuntimeProvisioningPage) => screen.page.keyboard.press('Escape') },
]) {
  test(`closing the offer with ${action} leaves the device untouched and the status disconnected`, async () => {
    test.setTimeout(120000)
    const device = await startFakeDevice(freshDeviceProfile())
    const screen = await RuntimeProvisioningPage.open(writeProvisioningProject('offer-dismiss', PROVISIONING_HOST))
    try {
      await screen.reachOfferThroughPort(device.sshPort)
      await screen.username.fill(DEVICE_USER)
      await screen.password.fill(DEVICE_PASSWORD)
      await dismiss(screen)
      await expect(screen.dialog).toBeHidden()
      await expect(screen.connectButton).toHaveText('Connect')
      await expect(screen.connectActivity).toHaveCount(0)
      expectGreetingOnly(device)
    } finally {
      await screen.quit()
      await device.close()
    }
  })
}

test('the next Connect checks the remembered port and asks for consent and credentials again', async () => {
  test.setTimeout(120000)
  const device = await startFakeDevice(freshDeviceProfile())
  const screen = await RuntimeProvisioningPage.open(writeProvisioningProject('offer-again', PROVISIONING_HOST))
  try {
    await screen.reachOfferThroughPort(device.sshPort)
    await screen.username.fill(DEVICE_USER)
    await screen.password.fill(DEVICE_PASSWORD)
    await screen.decline.click()
    await expect(screen.dialog).toBeHidden()
    const probesBefore = device.connections.length

    await screen.connectButton.click()
    await expect(screen.dialog).toBeVisible({ timeout: 15000 })
    await expect(screen.noDeviceModal).toBeHidden()
    expect(device.connections.length).toBe(probesBefore + 1)
    await expect(screen.sshPort).toHaveValue(String(device.sshPort))
    await expect(screen.username).toHaveValue('')
    await expect(screen.password).toHaveValue('')
    await expect(screen.submit).toBeDisabled()
    expectGreetingOnly(device)
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('the debugger "Not Connected" offer opens the same flow and ends its request with one console line', async () => {
  test.setTimeout(120000)
  const device = await startFakeDevice(freshDeviceProfile())
  const screen = await RuntimeProvisioningPage.open(writeProvisioningProject('debugger-offer', PROVISIONING_HOST))
  try {
    await screen.reachOfferThroughPort(device.sshPort)
    await screen.decline.click()
    await expect(screen.dialog).toBeHidden()

    await screen.page.getByRole('button', { name: 'Debugger', exact: true }).click()
    const notConnected = screen.messageDialog('Not Connected')
    await expect(notConnected).toContainText(`connect to OpenPLC Runtime v4 at ${PROVISIONING_HOST} now?`)
    await notConnected.getByRole('button', { name: 'Yes', exact: true }).click()

    await expect(screen.dialog).toBeVisible({ timeout: 15000 })
    await expect(screen.dialog).toContainText('Install or start the OpenPLC Runtime')
    await expect(screen.sshPort).toHaveValue(String(device.sshPort))
    await expect(screen.page.getByText('Debugger session cancelled.')).toHaveCount(0)
    await expect(screen.page.getByText('Variables', { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await screen.bodyText()).split(DEBUGGER_REQUEST_ENDED).length - 1).toBe(1)
    expectGreetingOnly(device)
  } finally {
    await screen.quit()
    await device.close()
  }
})
