import { expect, test } from '@playwright/test'

import {
  freshDeviceProfile,
  portAnswers,
  PROVISIONING_HOST,
  provisioningAddress,
  startFakeBootloader,
  startFakeDevice,
  startResettingRuntimePort,
} from './helpers/fake-provisioning-device'
import { RuntimeProvisioningPage, writeProvisioningProject } from './pages/runtime-provisioning'

const RUNTIME_IP = process.env.E2E_RUNTIME_IP ?? ''
const UNUSED_IP = '192.0.2.10'

test.describe.configure({ mode: 'default' })

/** In the window: milliseconds from the Connect click to the "No recognized device" modal appearing. */
function measureNoDeviceDelay(): Promise<number> {
  return new Promise((resolve) => {
    let pressedAt: number | null = null
    const button = document.querySelector('#runtime-connect-button-container > button')
    button?.addEventListener('click', () => (pressedAt = performance.now()), { capture: true, once: true })
    const observer = new MutationObserver(() => {
      if (pressedAt === null || document.querySelector('[data-testid="runtime-no-device-modal"]') === null) return
      observer.disconnect()
      resolve(performance.now() - pressedAt)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

test.beforeAll(async () => {
  const address = await provisioningAddress()
  for (const port of [22, 8443, 8445]) {
    expect(
      await portAnswers(address, port),
      `${PROVISIONING_HOST} (${address}) must refuse port ${port}; set E2E_PROVISIONING_HOST to a loopback name where it does`,
    ).toBe(false)
  }
})

test('nothing answering: the no-device message names the address and port 22 within 10 s', async () => {
  test.setTimeout(120000)
  const paths = writeProvisioningProject('no-device', UNUSED_IP)
  const screen = await RuntimeProvisioningPage.open(paths)
  try {
    const elapsed = screen.page.evaluate(measureNoDeviceDelay)
    await screen.connectButton.click()
    await expect(screen.noDeviceModal).toBeVisible({ timeout: 15000 })
    const delay = await elapsed
    test.info().annotations.push({ type: 'no-device delay (ms)', description: String(Math.round(delay)) })
    expect(delay).toBeLessThanOrEqual(10000)
    await expect(screen.noDeviceModal).toContainText('No recognized device')
    await expect(screen.noDeviceModal).toContainText(`No recognized device was found at ${UNUSED_IP}`)
    await expect(screen.noDeviceModal).toContainText('SSH on port 22')
    await expect(screen.noDevicePortInput).toBeVisible()
    await expect(screen.dialog).toBeHidden()
    await screen.page.keyboard.press('Escape')
    await expect(screen.noDeviceModal).toBeHidden()
    await expect(screen.connectButton).toHaveText('Connect')
  } finally {
    await screen.quit()
  }
})

test('an SSH port outside 1-65535 is refused before any check', async () => {
  test.setTimeout(120000)
  const device = await startFakeDevice(freshDeviceProfile())
  const paths = writeProvisioningProject('port-refused', PROVISIONING_HOST)
  const screen = await RuntimeProvisioningPage.open(paths)
  try {
    await screen.connectButton.click()
    await expect(screen.noDeviceModal).toBeVisible({ timeout: 15000 })
    for (const value of ['0', '65536', 'abc', '22.5', '-22', '']) {
      await screen.noDevicePortInput.fill(value)
      await screen.noDeviceCheck.click()
      await expect(screen.noDeviceModal).toContainText('The SSH port was refused')
      await expect(screen.noDeviceModal).toContainText('The device was not contacted.')
    }
    await expect(screen.dialog).toBeHidden()
    expect(device.connections).toHaveLength(0)
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('"Try another SSH port" checks the port and opens the offer with only the greeting read', async () => {
  test.setTimeout(120000)
  const device = await startFakeDevice(freshDeviceProfile())
  const paths = writeProvisioningProject('try-port', PROVISIONING_HOST)
  const screen = await RuntimeProvisioningPage.open(paths)
  try {
    await screen.reachOfferThroughPort(device.sshPort)
    await expect(screen.dialog).toContainText('Install OpenPLC Runtime')
    await expect(screen.dialog).toContainText(
      `Enter your device login credentials to install OpenPLC Runtime on ${PROVISIONING_HOST}.`,
    )
    await expect(screen.submit).toHaveText('Install')
    await expect(screen.dialog).toContainText('Device username')
    await expect(screen.dialog).not.toContainText('Login to OpenPLC Runtime')
    await expect(screen.dialog).not.toContainText('Create First User')
    await expect(screen.sshPort).toHaveValue(String(device.sshPort))
    await expect(screen.connectButton).toHaveText('Connect')
    expect(device.connections.length).toBeGreaterThanOrEqual(1)
    expect(device.connections.every((connection) => connection.clientBytes === 0)).toBe(true)
    expect(device.connections.flatMap((connection) => connection.authAttempts)).toHaveLength(0)
    expect(device.execs).toHaveLength(0)
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('a reset on port 8443 keeps the "No Response" error and makes no bootloader or SSH check', async () => {
  test.setTimeout(120000)
  const address = await provisioningAddress()
  const runtimePort = await startResettingRuntimePort(address)
  const bootloader = await startFakeBootloader(address, 'healthy', false)
  const paths = writeProvisioningProject('reset', PROVISIONING_HOST)
  const screen = await RuntimeProvisioningPage.open(paths)
  try {
    await screen.connectButton.click()
    await expect(screen.messageDialog('No Response')).toBeVisible({ timeout: 15000 })
    await expect(screen.messageDialog('No Response')).toContainText(
      `Could not reach OpenPLC Runtime v4 at ${PROVISIONING_HOST}`,
    )
    expect(runtimePort.accepted()).toBeGreaterThanOrEqual(1)
    expect(bootloader.paths).toHaveLength(0)
    await expect(screen.noDeviceModal).toBeHidden()
    await expect(screen.dialog).toBeHidden()
  } finally {
    await screen.quit()
    await bootloader.close()
    await runtimePort.close()
  }
})

for (const { state, recovery, title, text } of [
  {
    state: 'recovery',
    recovery: true,
    title: 'Runtime failed to start',
    text: `The OpenPLC Runtime is installed on ${PROVISIONING_HOST} but failed to start. Bootloader state: recovery.`,
  },
  {
    state: 'updating',
    recovery: false,
    title: 'Bootloader busy',
    text: `The bootloader on ${PROVISIONING_HOST} reports the state "updating". Try again later.`,
  },
  {
    state: 'pulling',
    recovery: false,
    title: 'Bootloader busy',
    text: `The bootloader on ${PROVISIONING_HOST} reports the state "pulling". Try again later.`,
  },
]) {
  test(`a bootloader in state "${state}" is reported and no SSH offer is made`, async () => {
    test.setTimeout(120000)
    const address = await provisioningAddress()
    const bootloader = await startFakeBootloader(address, state, recovery)
    const paths = writeProvisioningProject(`bootloader-${state}`, PROVISIONING_HOST)
    const screen = await RuntimeProvisioningPage.open(paths)
    try {
      await screen.connectButton.click()
      await expect(screen.messageDialog(title)).toBeVisible({ timeout: 15000 })
      await expect(screen.messageDialog(title)).toContainText(text)
      expect(bootloader.paths).toContain('/api/bootloader/capabilities')
      await expect(screen.noDeviceModal).toBeHidden()
      await expect(screen.dialog).toBeHidden()
      await expect(screen.connectButton).toHaveText('Connect')
    } finally {
      await screen.quit()
      await bootloader.close()
    }
  })
}

test('a runtime that answers on 8443 connects as before, with no provisioning dialog', async () => {
  test.skip(RUNTIME_IP === '', 'set E2E_RUNTIME_IP to an OpenPLC Runtime v4 that has user accounts')
  test.setTimeout(120000)
  const paths = writeProvisioningProject('runtime-answers', RUNTIME_IP)
  const screen = await RuntimeProvisioningPage.open(paths)
  try {
    await screen.connectButton.click()
    await expect(screen.messageDialog('Login to OpenPLC Runtime')).toBeVisible({ timeout: 15000 })
    await expect(screen.dialog).toBeHidden()
    await expect(screen.noDeviceModal).toBeHidden()
  } finally {
    await screen.quit()
  }
})
