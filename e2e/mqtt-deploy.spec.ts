// Needs the production build, the copied preload and MQTT_DEPLOY_RUNTIME_IMAGE; runtimes are reached only on 8443.
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'
import JSZip from 'jszip'

const IMAGE = process.env.MQTT_DEPLOY_RUNTIME_IMAGE ?? ''
const CONTAINER = 'openplc-e2e-mqtt-deploy'
const ROOT = join(tmpdir(), 'openplc-e2e-mqtt-deploy')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const RUNTIME_USER = 'e5operator'
const RUNTIME_PASSWORD = 'e5-runtime-login-7d2a'
const PASSWORD_MARKER = 'MARKER-PW-e5-deploy-desktop-4c19'
const USERNAME_MARKER = 'MARKER-USER-e5-deploy-desktop-b07e'
const MARKERS = [PASSWORD_MARKER, USERNAME_MARKER]
const IMPOSTOR_PIN = 'AA:'.repeat(31) + 'AA'

const MAIN_ST = `PROGRAM Main
  VAR
    Counter : DINT;
  END_VAR

Counter := Counter + 1;

END_PROGRAM
`

const docker = (...args: string[]): string => execFileSync('docker', args, { encoding: 'utf-8' })

interface RuntimeReply {
  status: number
  body: string
}

/** Test harness only: talks to the container like an operator would with curl -k. */
const runtimeCall = (method: string, path: string, token?: string, body?: string): Promise<RuntimeReply> =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: 8443,
        method,
        path,
        rejectUnauthorized: false,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => (data += chunk.toString('utf-8')))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })

const runtimeToken = async (): Promise<string> => {
  const login = await runtimeCall(
    'POST',
    '/api/login',
    undefined,
    JSON.stringify({ username: RUNTIME_USER, password: RUNTIME_PASSWORD }),
  )
  const parsed: { access_token: string } = JSON.parse(login.body)
  return parsed.access_token
}

interface RuntimeCredentials {
  active: null | { id: string; revision: number; method: string; binding: { host: string; client_id: string } }
  staged: Array<{ stagingId: string }>
}

const runtimeCredentials = async (): Promise<RuntimeCredentials> =>
  JSON.parse((await runtimeCall('GET', '/api/mqtt/credentials', await runtimeToken())).body)

const startRuntime = async (): Promise<string> => {
  try {
    docker('rm', '-f', CONTAINER)
  } catch {
    /* not running */
  }
  docker('run', '-d', '--name', CONTAINER, '-p', '127.0.0.1:8443:8443', IMAGE)
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    try {
      if ((await runtimeCall('GET', '/api/version')).status === 200) break
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  const created = await runtimeCall(
    'POST',
    '/api/create-user',
    undefined,
    JSON.stringify({ username: RUNTIME_USER, password: RUNTIME_PASSWORD }),
  )
  expect(created.status).toBe(201)
  // Read on the device itself, as the panel tells the user to.
  return docker(
    'exec',
    CONTAINER,
    'openssl',
    'x509',
    '-in',
    '/workdir/webserver/certOPENPLC.pem',
    '-noout',
    '-fingerprint',
    '-sha256',
  ).trim()
}

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'mqtt-deploy', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'Line1', program: 'Main', task: 'task0' }],
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(FIXTURE, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '127.0.0.1',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(FIXTURE, 'devices', 'servers', 'Telemetry.json'),
    JSON.stringify({
      name: 'Telemetry',
      protocol: 'mqtt',
      mqttConfig: {
        formatVersion: 1,
        enabled: true,
        mode: 'generic',
        connection: {
          host: 'broker.invalid',
          port: 8883,
          clientId: 'line-1',
          tls: { enabled: true, trust: { source: 'system' } },
        },
        authMethod: 'username_password',
        generic: { publishMode: 'on_change', sampleIntervalMs: 100, publishIntervalMs: 1000, qos: 0, retain: false },
        sparkplug: { groupId: 'openplc', edgeNodeId: 'line-1', sampleIntervalMs: 100 },
        selections: [
          {
            source: {
              tokens: [
                { role: 'instance', name: 'Line1' },
                { role: 'program', name: 'Main' },
                { role: 'variable', name: 'Counter' },
              ],
            },
          },
        ],
      },
    }),
  )
  writeFileSync(join(FIXTURE, 'pous', 'programs', 'Main.st'), MAIN_ST)

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'mqtt-deploy',
        path: FIXTURE,
        projectFilePath: join(FIXTURE, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtime = join(USER_DATA, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          return { app, page: w }
        }
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

const shutdown = async (app: ElectronApplication) => {
  const closed = app.close().then(() => true)
  const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000))
  if (!(await Promise.race([closed, timedOut]))) app.process().kill('SIGKILL')
}

const editor = (page: Page) => page.getByLabel('MQTT client editor')

const openTelemetry = async (page: Page) => {
  const entry = page
    .locator('li')
    .filter({ hasText: /^\*?\s*Telemetry$/ })
    .first()
  if (!(await entry.isVisible())) await page.getByText('Servers', { exact: true }).first().click()
  await entry.click()
  await expect(page.getByRole('heading', { name: 'MQTT client: Telemetry' })).toBeVisible()
  await editor(page)
    .getByRole('tab', { name: /^Security/ })
    .click()
}

const connectRuntime = async (page: Page) => {
  const leaf = page.getByText('Configuration', { exact: true }).first()
  if (!(await leaf.isVisible())) await page.getByText('Device', { exact: true }).first().click()
  await leaf.click()
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await page.locator('#runtime-user-default').fill(RUNTIME_USER)
  await page.locator('#runtime-pass-default').fill(RUNTIME_PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible({ timeout: 30000 })
}

const occurrences = (text: string, pattern: RegExp): number =>
  (text.match(new RegExp(pattern.source, 'g')) ?? []).length

/** Runs Build and upload and waits for one more settling line; returns the page text at that point. */
const buildAndUpload = async (page: Page, settledBy: RegExp): Promise<string> => {
  const before = occurrences(await page.locator('body').innerText(), settledBy)
  await page.getByLabel('Build options').click()
  await page.getByText('Build and upload', { exact: true }).click()
  // A running PLC is stopped before an upload, behind a confirmation.
  const stopFirst = page.getByRole('button', { name: 'Stop PLC and Continue' })
  try {
    await stopFirst.waitFor({ state: 'visible', timeout: 5000 })
    await stopFirst.click()
  } catch {
    /* the PLC was not running */
  }
  try {
    await expect
      .poll(async () => occurrences(await page.locator('body').innerText(), settledBy), { timeout: 240000 })
      .toBeGreaterThan(before)
  } catch (error) {
    writeFileSync(join(ROOT, 'page-at-failure.txt'), await page.locator('body').innerText())
    throw error
  }
  return page.locator('body').innerText()
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) return []
    return stat.isDirectory() ? filesUnder(full) : [full]
  })

const expectNoMarker = (label: string, text: string) => {
  for (const marker of MARKERS) {
    expect(text.includes(marker), `${label} contains ${marker}`).toBe(false)
    expect(text.includes(Buffer.from(marker).toString('base64')), `${label} contains base64 ${marker}`).toBe(false)
  }
}

test.describe.configure({ mode: 'serial' })

test('deploys an MQTT credential only to the verified runtime and keeps it out of every artifact', async () => {
  test.skip(IMAGE === '', 'MQTT_DEPLOY_RUNTIME_IMAGE is not set')
  test.setTimeout(900000)
  writeFixture()
  const fingerprint = await startRuntime()
  expect(fingerprint).toMatch(/^sha256 Fingerprint=([0-9A-F]{2}:){31}[0-9A-F]{2}$/i)

  const { app, page } = await launch()
  try {
    await page.getByText('mqtt-deploy', { exact: true }).first().click({ timeout: 30000 })
    await expect(page.getByText('Main', { exact: true }).first()).toBeVisible({ timeout: 30000 })

    await openTelemetry(page)
    await page.getByRole('button', { name: 'Enter credential' }).click()
    await editor(page).getByLabel('Username', { exact: true }).fill(USERNAME_MARKER)
    await editor(page).getByLabel('Password', { exact: true }).fill(PASSWORD_MARKER)
    await page.getByRole('button', { name: 'Save credential' }).click()
    await expect(page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'local')
    await expect(page.getByTestId('runtime-identity-state')).toHaveAttribute('data-state', 'untrusted')

    await connectRuntime(page)

    // 1. Identity never verified: nothing is staged and nothing is uploaded.
    let text = await buildAndUpload(page, /runtime_trust_missing/)
    expect(text).toContain('The runtime identity is not verified')
    expect(await runtimeCredentials()).toEqual({ active: null, staged: [] })
    expect((await runtimeCall('GET', '/api/project-snapshot', await runtimeToken())).status).toBe(404)

    // 2. A wrong fingerprint: the connection is refused before the token or the secret is sent.
    await openTelemetry(page)
    await editor(page).getByLabel('Runtime certificate SHA-256 fingerprint').fill(IMPOSTOR_PIN)
    await page.getByRole('button', { name: 'Trust this runtime' }).click()
    await expect(page.getByTestId('runtime-identity-state')).toHaveAttribute('data-state', 'trusted')
    text = await buildAndUpload(page, /runtime_identity_mismatch/)
    expect(text).toContain('does not match the trusted fingerprint')
    expect(await runtimeCredentials()).toEqual({ active: null, staged: [] })

    // 3. The fingerprint read on the device: staged, uploaded, activated with the program.
    await openTelemetry(page)
    await editor(page).getByLabel('Runtime certificate SHA-256 fingerprint').fill(fingerprint)
    await page.getByRole('button', { name: 'Trust this runtime' }).click()
    await expect(page.getByTestId('runtime-identity-state')).toContainText(
      fingerprint.replace(/^sha256 Fingerprint=/i, ''),
    )
    text = await buildAndUpload(page, /Upload complete\.|Failed to upload|Stopping compilation process/)
    expect(text).toContain('Upload complete.')
    expect(text).toMatch(/Generated conf\/mqtt\.json for "Telemetry": 1 leaves, mode generic/)

    const afterFirst = await runtimeCredentials()
    expect(afterFirst.staged).toEqual([])
    expect(afterFirst.active).toMatchObject({
      revision: 1,
      method: 'username_password',
      binding: { host: 'broker.invalid', client_id: 'line-1' },
    })
    const installed: { auth: { credential_ref: { id: string; revision: number; staging_id: string | null } } } =
      JSON.parse(docker('exec', CONTAINER, 'cat', '/workdir/core/src/drivers/plugins/python/mqtt/mqtt.json'))
    expect(installed.auth.credential_ref).toMatchObject({ id: afterFirst.active?.id, revision: 1 })
    expect(installed.auth.credential_ref.staging_id).toMatch(/^[0-9a-f-]{36}$/)
    const uploadedConf = readFileSync(join(FIXTURE, 'build', 'OpenPLC Runtime v4', 'src', 'conf', 'mqtt.json'), 'utf-8')
    expect(JSON.parse(uploadedConf).auth).toEqual(installed.auth)

    // 4. Reopen without the local copy: the runtime credential for the same broker is reused, not re-sent.
    await openTelemetry(page)
    await page.getByRole('button', { name: 'Remove credential' }).click()
    await expect(page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'runtime', { timeout: 30000 })
    text = await buildAndUpload(page, /Upload complete\.|Failed to upload|Stopping compilation process/)
    expect(text).not.toContain('Failed to upload')
    const afterReuse = await runtimeCredentials()
    expect(afterReuse.active).toMatchObject({ id: afterFirst.active?.id, revision: 1 })
    const reused: typeof installed = JSON.parse(
      docker('exec', CONTAINER, 'cat', '/workdir/core/src/drivers/plugins/python/mqtt/mqtt.json'),
    )
    expect(reused.auth.credential_ref).toEqual({ id: afterFirst.active?.id, revision: 1, staging_id: null })

    // 5. Secret markers: editor profile and logs, project with its build output, stored project, runtime disk.
    for (const file of [...filesUnder(FIXTURE), ...filesUnder(USER_DATA)])
      expectNoMarker(file, readFileSync(file, 'latin1'))
    const snapshot: { contentBase64: string } = JSON.parse(
      (await runtimeCall('GET', '/api/project-snapshot', await runtimeToken())).body,
    )
    const archive = await JSZip.loadAsync(Buffer.from(snapshot.contentBase64, 'base64'))
    for (const name of Object.keys(archive.files)) {
      if (!archive.files[name].dir) expectNoMarker(`snapshot:${name}`, await archive.files[name].async('string'))
    }
    const runtimeHits = docker(
      'exec',
      CONTAINER,
      'sh',
      '-c',
      `grep -rlaF -e '${PASSWORD_MARKER}' -e '${USERNAME_MARKER}' /workdir /var/run/runtime /tmp 2>/dev/null || true`,
    ).trim()
    expect(runtimeHits).toBe('')
    expect(docker('exec', CONTAINER, 'sh', '-c', 'ls /var/run/runtime/mqtt/credentials.vault')).toContain(
      'credentials.vault',
    )
  } finally {
    await shutdown(app)
    try {
      docker('rm', '-f', CONTAINER)
    } catch {
      /* already gone */
    }
  }
})
