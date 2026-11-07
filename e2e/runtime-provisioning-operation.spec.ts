import { readFileSync, writeFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import { utils } from 'ssh2'

import {
  type CommandKind,
  DEVICE_PASSWORD,
  DEVICE_USER,
  type DeviceProfile,
  type FakeDevice,
  type FakeHttpsEndpoint,
  freshDeviceProfile,
  PROVISIONING_HOST,
  provisioningAddress,
  startFakeDevice,
  startFakeRuntime,
} from './helpers/fake-provisioning-device'
import {
  hostKeyFilePath,
  profileTexts,
  type ProvisioningPaths,
  RuntimeProvisioningPage,
  writeProvisioningProject,
} from './pages/runtime-provisioning'

const SUDO_PREFIX = "/usr/bin/sudo -S -k -p '' sh -c "
const DEBUGGER_REQUEST_ENDED = 'The debugger was not started because the editor is not connected to the OpenPLC Runtime'

test.describe.configure({ mode: 'default' })

/** The kinds of the commands the device ran, in order, with consecutive installer polls folded into one. */
function commandKinds(device: FakeDevice): CommandKind[] {
  return device.execs
    .map((exec) => exec.kind)
    .filter((kind, index, kinds) => kind !== 'poll-installer' || kinds[index - 1] !== 'poll-installer')
}

/** Logins the device accepted or rejected, one per password attempt. */
function passwordAttempts(device: FakeDevice): number {
  return device.connections.flatMap((connection) => connection.authAttempts).filter((a) => a.method === 'password')
    .length
}

/** Asserts every elevated command went through sudo with the password on stdin, and no other command got it. */
function expectSudoDiscipline(device: FakeDevice): void {
  for (const exec of device.execs) {
    if (exec.kind === 'probe-system') {
      expect(exec.command.startsWith('/usr/bin/sudo')).toBe(false)
      expect(exec.stdin).toBe('')
    } else {
      expect(exec.command.startsWith(SUDO_PREFIX)).toBe(true)
      expect(exec.stdin).toBe(`${DEVICE_PASSWORD}\n`)
    }
  }
}

/** Opens the editor on a new profile aimed at the fake device and accepts its offer with the device account. */
async function startOperation(
  slug: string,
  profile: DeviceProfile,
  prepare: (paths: ProvisioningPaths, device: FakeDevice) => void = () => undefined,
): Promise<{ device: FakeDevice; paths: ProvisioningPaths; screen: RuntimeProvisioningPage }> {
  const device = await startFakeDevice(profile)
  const paths = writeProvisioningProject(slug, PROVISIONING_HOST)
  prepare(paths, device)
  const screen = await RuntimeProvisioningPage.open(paths)
  await screen.reachOfferThroughPort(device.sshPort)
  await screen.submitCredentials(DEVICE_USER, DEVICE_PASSWORD)
  return { device, paths, screen }
}

/** The audit entry pattern of one operation on the fake device. */
function auditEntry(device: FakeDevice, operation: string, outcome: string): RegExp {
  return new RegExp(
    `\\[runtime-provisioning-audit\\] target=${PROVISIONING_HOST}:${device.sshPort} operation=${operation} start=\\S+ end=\\S+ outcome=${outcome}`,
  )
}

/** Asserts @p count audit entries for the operation in the editor log, and no credential in the log or the window. */
async function expectAudit(
  screen: RuntimeProvisioningPage,
  paths: ProvisioningPaths,
  device: FakeDevice,
  operation: 'inspect' | 'start' | 'install',
  outcome: 'success' | 'failure' | 'cancelled' | 'unknown',
  count = 1,
): Promise<void> {
  const entry = auditEntry(device, operation, outcome)
  await expect
    .poll(
      () =>
        profileTexts(paths)
          .split('\n')
          .filter((line) => entry.test(line)).length,
    )
    .toBe(count)
  const texts = `${await screen.bodyText()}\n${profileTexts(paths)}`
  expect(texts).not.toContain(DEVICE_PASSWORD)
  expect(texts).not.toContain(DEVICE_USER)
}

/** Waits until the device received the command that starts the installer. */
async function installerStarted(device: FakeDevice): Promise<void> {
  await expect.poll(() => device.execs.some((exec) => exec.kind === 'start-installer'), { timeout: 30000 }).toBe(true)
}

test('a hidden install stays reachable, refuses a second operation and ends with its last lines', async () => {
  test.setTimeout(180000)
  const { device, paths, screen } = await startOperation('install-failure', freshDeviceProfile())
  try {
    await installerStarted(device)
    device.installer.write('Step 1/3: installing Docker')
    await expect(screen.latestLine).toHaveText('Step 1/3: installing Docker')
    await expect(screen.elapsed).toHaveText(/^\d+:\d\d$/)
    await expect(screen.cancel).toHaveCount(0)
    device.installer.write(`Logging in to the registry with ${DEVICE_PASSWORD}`)
    device.installer.write('Step 2/3: pulling images')
    await expect(screen.latestLine).toHaveText('Step 2/3: pulling images')

    await screen.hide.click()
    await expect(screen.dialog).toBeHidden()
    await expect(screen.connectActivity).toHaveText('Installing runtime...')
    await screen.connectActivity.click()
    await expect(screen.dialog).toBeVisible()
    await expect(screen.latestLine).toHaveText('Step 2/3: pulling images')
    await screen.hide.click()
    await expect(screen.dialog).toBeHidden()

    await screen.page.getByRole('button', { name: 'Debugger', exact: true }).click()
    await screen.messageDialog('Not Connected').getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(screen.dialog).toBeVisible({ timeout: 15000 })
    await expect(screen.latestLine).toHaveText('Step 2/3: pulling images')
    await expect.poll(async () => (await screen.bodyText()).split(DEBUGGER_REQUEST_ENDED).length - 1).toBe(1)
    expect(passwordAttempts(device)).toBe(1)
    await screen.hide.click()

    device.installer.write('ERROR: could not pull the runtime image')
    device.installer.finish(1)
    await expect(screen.toast('Installer failed')).toBeVisible({ timeout: 30000 })
    await expect(screen.dialog).toBeHidden()
    await expect(screen.connectActivity).toHaveText('Show result')
    await screen.connectActivity.click()
    await expect(screen.dialog).toContainText('Installer failed')
    await expect(screen.dialog).toContainText(`The installer failed on ${PROVISIONING_HOST}.`)
    await expect(screen.lastLines).toContainText('Step 1/3: installing Docker')
    await expect(screen.lastLines).toContainText('ERROR: could not pull the runtime image')
    await screen.close.click()
    await expect(screen.dialog).toBeHidden()
    await expect(screen.connectActivity).toHaveCount(0)
    await expect(screen.connectButton).toHaveText('Connect')

    expect(commandKinds(device)).toEqual([
      'probe-system',
      'privilege-check',
      'inspect-runtime',
      'prepare-installer',
      'start-installer',
      'poll-installer',
    ])
    expectSudoDiscipline(device)
    expect(passwordAttempts(device)).toBe(1)

    const hostKeys: unknown = JSON.parse(readFileSync(hostKeyFilePath(paths), 'utf-8'))
    expect(hostKeys).toMatchObject({
      version: 1,
      hosts: [
        { host: PROVISIONING_HOST, port: device.sshPort, keyType: 'ecdsa-sha2-nistp256', key: device.hostKeyBase64 },
      ],
    })

    await expectAudit(screen, paths, device, 'install', 'failure')
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('a finished install continues into "Create First User" without a second Connect', async () => {
  test.setTimeout(180000)
  const address = await provisioningAddress()
  let runtime: FakeHttpsEndpoint | null = null
  const { device, paths, screen } = await startOperation('install-success', freshDeviceProfile())
  try {
    await installerStarted(device)
    device.installer.write('Step 3/3: starting the runtime')
    await expect(screen.latestLine).toHaveText('Step 3/3: starting the runtime')
    await screen.hide.click()
    runtime = await startFakeRuntime(address, false)
    device.installer.finish(0)

    await expect(screen.toast('Runtime ready')).toBeVisible({ timeout: 30000 })
    await expect(screen.toast('Runtime ready')).toContainText(
      `The OpenPLC Runtime was installed on ${PROVISIONING_HOST} and answers.`,
    )
    await expect(screen.messageDialog('Create First User')).toBeVisible({ timeout: 15000 })
    await expect(screen.dialog).toBeHidden()
    expect(runtime.paths.filter((path) => path === '/api/get-users-info').length).toBeGreaterThanOrEqual(2)
    expect(passwordAttempts(device)).toBe(1)
    await expectAudit(screen, paths, device, 'install', 'success')
  } finally {
    await screen.quit()
    await runtime?.close()
    await device.close()
  }
})

test('a stopped runtime is started, not reinstalled, and the runtime login follows', async () => {
  test.setTimeout(180000)
  const address = await provisioningAddress()
  const started: { runtime: FakeHttpsEndpoint | null } = { runtime: null }
  const profile = freshDeviceProfile({
    runtime: { docker: 'absent', bootloader: 'absent', runtimeContainer: 'absent', native: 'inactive', v3: 'none' },
    onStartCommand: async () => {
      started.runtime = await startFakeRuntime(address, true)
    },
  })
  const { device, paths, screen } = await startOperation('start-native', profile)
  try {
    await expect(screen.toast('Runtime ready')).toBeVisible({ timeout: 30000 })
    await expect(screen.toast('Runtime ready')).toContainText(
      `The OpenPLC Runtime was started on ${PROVISIONING_HOST} and answers.`,
    )
    await expect(screen.messageDialog('Login to OpenPLC Runtime')).toBeVisible({ timeout: 15000 })
    await expect(screen.dialog).toBeHidden()
    expect(commandKinds(device)).toEqual(['probe-system', 'privilege-check', 'inspect-runtime', 'start-native-service'])
    expectSudoDiscipline(device)
    await expectAudit(screen, paths, device, 'start', 'success')
  } finally {
    await screen.quit()
    await started.runtime?.close()
    await device.close()
  }
})

test('a rejected login asks again in the same operation, then a v3 runtime ends it with nothing changed', async () => {
  test.setTimeout(180000)
  const device = await startFakeDevice(
    freshDeviceProfile({ runtime: { ...freshDeviceProfile().runtime, v3: 'openplc.service' } }),
  )
  const paths = writeProvisioningProject('login-rejected', PROVISIONING_HOST)
  const screen = await RuntimeProvisioningPage.open(paths)
  try {
    await screen.reachOfferThroughPort(device.sshPort)
    await screen.submitCredentials(DEVICE_USER, 'wrong-password')
    await expect(screen.dialog).toContainText('Login rejected', { timeout: 30000 })
    await expect(screen.dialog).toContainText('The device rejected the login. Nothing was changed on the device.')
    await expect(screen.username).toHaveValue(DEVICE_USER)
    await expect(screen.password).toHaveValue('')
    await expect(screen.sshPort).toHaveValue(String(device.sshPort))
    expect(device.execs).toHaveLength(0)

    await screen.password.fill(DEVICE_PASSWORD)
    await screen.submit.click()
    await expect(screen.dialog).toContainText('OpenPLC Runtime v3 present', { timeout: 30000 })
    await expect(screen.dialog).toContainText(`An OpenPLC Runtime v3 is installed on ${PROVISIONING_HOST}.`)
    expect(commandKinds(device)).toEqual(['probe-system', 'privilege-check', 'inspect-runtime'])
    await screen.close.click()
    await expect(screen.connectButton).toHaveText('Connect')
    await expectAudit(screen, paths, device, 'inspect', 'failure', 2)
  } finally {
    await screen.quit()
    await device.close()
  }
})

for (const { account, uid, sudo, title, kinds } of [
  {
    account: 'without sudo rights',
    uid: '1000',
    sudo: false,
    title: 'No administrative rights',
    kinds: ['probe-system', 'privilege-check'],
  },
  {
    account: 'root',
    uid: '0',
    sudo: false,
    title: 'OpenPLC Runtime v3 present',
    kinds: ['probe-system', 'inspect-runtime'],
  },
]) {
  test(`an account ${account} ends with "${title}" and runs only ${kinds.join(', ')}`, async () => {
    test.setTimeout(180000)
    const profile = freshDeviceProfile({
      uid,
      sudo,
      runtime: { ...freshDeviceProfile().runtime, v3: 'openplc.service' },
    })
    const { device, paths, screen } = await startOperation(`account-${uid}`, profile)
    try {
      await expect(screen.dialog).toContainText(title, { timeout: 30000 })
      expect(commandKinds(device)).toEqual(kinds)
      if (uid === '0') {
        expect(device.execs.every((exec) => !exec.command.includes('sudo') && exec.stdin === '')).toBe(true)
      }
      await expectAudit(screen, paths, device, 'inspect', 'failure')
    } finally {
      await screen.quit()
      await device.close()
    }
  })
}

test('a changed host key stops before login and names the target', async () => {
  test.setTimeout(180000)
  const other = utils.parseKey(utils.generateKeyPairSync('ecdsa', { bits: 256 }).private)
  if (other instanceof Error) throw other
  const savedKeys = (paths: ProvisioningPaths, device: FakeDevice): void =>
    writeFileSync(
      hostKeyFilePath(paths),
      JSON.stringify({
        version: 1,
        hosts: [
          {
            host: PROVISIONING_HOST,
            port: device.sshPort,
            keyType: 'ecdsa-sha2-nistp256',
            key: other.getPublicSSH().toString('base64'),
            firstSeen: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    )
  const { device, paths, screen } = await startOperation('host-key-changed', freshDeviceProfile(), savedKeys)
  try {
    const before = readFileSync(hostKeyFilePath(paths), 'utf-8')
    await expect(screen.dialog).toContainText('Host key changed', { timeout: 30000 })
    await expect(screen.dialog).toContainText(
      `The SSH host key of ${PROVISIONING_HOST}:${device.sshPort} changed since the editor saved it. Nothing was sent to the device.`,
    )
    expect(passwordAttempts(device)).toBe(0)
    expect(device.execs).toHaveLength(0)
    expect(readFileSync(hostKeyFilePath(paths), 'utf-8')).toBe(before)
    await expectAudit(screen, paths, device, 'inspect', 'failure')
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('an empty host-key file stops the operation before any SSH contact', async () => {
  test.setTimeout(180000)
  const emptyKeys = (paths: ProvisioningPaths): void => writeFileSync(hostKeyFilePath(paths), '')
  const { device, paths, screen } = await startOperation('host-key-unusable', freshDeviceProfile(), emptyKeys)
  try {
    await expect(screen.dialog).toContainText('Host key file unusable', { timeout: 30000 })
    expect(device.connections.every((connection) => connection.clientBytes === 0)).toBe(true)
    expect(passwordAttempts(device)).toBe(0)
    expect(readFileSync(hostKeyFilePath(paths), 'utf-8')).toBe('')
    await expectAudit(screen, paths, device, 'inspect', 'failure')
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('Cancel during the inspection ends the operation with nothing installed', async () => {
  test.setTimeout(180000)
  const device = await startFakeDevice(freshDeviceProfile())
  const release = device.holdNext('probe-system')
  const paths = writeProvisioningProject('cancel', PROVISIONING_HOST)
  const screen = await RuntimeProvisioningPage.open(paths)
  try {
    await screen.reachOfferThroughPort(device.sshPort)
    await screen.submitCredentials(DEVICE_USER, DEVICE_PASSWORD)
    await expect.poll(() => device.execs.length, { timeout: 30000 }).toBe(1)
    await expect(screen.cancel).toBeVisible()
    await screen.cancel.click()
    await expect(screen.dialog).toContainText('Operation cancelled')
    await expect(screen.dialog).toContainText(`Nothing was installed or started on ${PROVISIONING_HOST}.`)
    release()
    await expect(screen.toast('Operation cancelled')).toHaveCount(0)
    await screen.close.click()
    await expect(screen.connectButton).toHaveText('Connect')
    expect(commandKinds(device)).toEqual(['probe-system'])
    await expectAudit(screen, paths, device, 'inspect', 'cancelled')
  } finally {
    release()
    await screen.quit()
    await device.close()
  }
})

test('the installer lines written just before it fails reach the editor console', async () => {
  test.setTimeout(180000)
  const { device, screen } = await startOperation('console-last-lines', freshDeviceProfile())
  try {
    await installerStarted(device)
    device.installer.write('Step 1/3: installing Docker')
    await expect(screen.latestLine).toHaveText('Step 1/3: installing Docker')
    device.installer.write('ERROR: could not pull the runtime image')
    device.installer.finish(1)
    await expect(screen.dialog).toContainText('Installer failed', { timeout: 30000 })
    await expect(screen.lastLines).toContainText('ERROR: could not pull the runtime image')
    await screen.close.click()
    await expect(screen.page.getByText('Step 1/3: installing Docker')).toHaveCount(1)
    await expect(screen.page.getByText('ERROR: could not pull the runtime image')).toHaveCount(1)
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('the audit entry of an operation reaches the editor console', async () => {
  test.setTimeout(180000)
  const emptyKeys = (paths: ProvisioningPaths): void => writeFileSync(hostKeyFilePath(paths), '')
  const { device, paths, screen } = await startOperation('console-audit', freshDeviceProfile(), emptyKeys)
  try {
    await expect(screen.dialog).toContainText('Host key file unusable', { timeout: 30000 })
    await expectAudit(screen, paths, device, 'inspect', 'failure')
    await expect(screen.page.getByText(auditEntry(device, 'inspect', 'failure'))).toHaveCount(1)
  } finally {
    await screen.quit()
    await device.close()
  }
})

test('a lost SSH channel during an install ends as unknown and asks to Connect again', async () => {
  test.setTimeout(180000)
  const { device, paths, screen } = await startOperation('channel-lost', freshDeviceProfile())
  try {
    await installerStarted(device)
    device.installer.write('Step 2/3: pulling images')
    await expect(screen.latestLine).toHaveText('Step 2/3: pulling images')
    device.dropConnections()
    await expect(screen.dialog).toContainText('Result unknown', { timeout: 60000 })
    await expect(screen.dialog).toContainText(
      `The editor lost track of the operation on ${PROVISIONING_HOST}, so its result is unknown. Connect again to check the device.`,
    )
    await screen.close.click()
    await expect(screen.connectButton).toHaveText('Connect')
    expect(passwordAttempts(device)).toBe(1)
    await expectAudit(screen, paths, device, 'install', 'unknown')
  } finally {
    await screen.quit()
    await device.close()
  }
})

for (const { device: kind, profile, title, text, kinds } of [
  {
    device: 'without internet access',
    profile: freshDeviceProfile({ download: 'failed' }),
    title: 'No internet access',
    text: 'The device could not download the OpenPLC Runtime. Docker is not installed on the device.',
    kinds: ['probe-system', 'privilege-check', 'inspect-runtime', 'prepare-installer'],
  },
  {
    device: 'on an ARMv6 board',
    profile: freshDeviceProfile({ arch: { dpkgArch: 'armhf', machine: 'armv6l', longBit: '32' } }),
    title: 'Unsupported device',
    text: `The OpenPLC Runtime cannot run on ${PROVISIONING_HOST}: its architecture (armhf (armv6l)) is not supported.`,
    kinds: ['probe-system', 'privilege-check', 'inspect-runtime'],
  },
]) {
  test(`an install ${kind} ends with "${title}" before the installer runs`, async () => {
    test.setTimeout(180000)
    const { device, screen } = await startOperation(`install-${title.replace(/\W+/g, '-')}`, profile)
    try {
      await expect(screen.dialog).toContainText(title, { timeout: 30000 })
      await expect(screen.dialog).toContainText(text)
      expect(commandKinds(device)).toEqual(kinds)
    } finally {
      await screen.quit()
      await device.close()
    }
  })
}

test('a device that refuses password login ends the operation with nothing run', async () => {
  test.setTimeout(180000)
  const { device, screen } = await startOperation('password-refused', freshDeviceProfile({ passwordLogin: false }))
  try {
    await expect(screen.dialog).toContainText('Password login not accepted', { timeout: 30000 })
    await expect(screen.dialog).toContainText(
      'The device does not accept password login over SSH. Nothing was changed on the device.',
    )
    expect(passwordAttempts(device)).toBe(0)
    expect(device.execs).toHaveLength(0)
  } finally {
    await screen.quit()
    await device.close()
  }
})
