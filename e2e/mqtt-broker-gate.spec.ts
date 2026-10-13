// Needs MQTT_DEPLOY_RUNTIME_IMAGE, MQTT_DEPLOY_SPARKPLUG_PROTO and Docker; runtimes are reached only on 8443.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'
import JSZip from 'jszip'

const IMAGE = process.env.MQTT_DEPLOY_RUNTIME_IMAGE ?? ''
const SPARKPLUG_PROTO = process.env.MQTT_DEPLOY_SPARKPLUG_PROTO ?? ''
// A packaged app binary; without it the production build in release/app/dist is launched.
const EXECUTABLE = process.env.EDITOR_E2E_EXECUTABLE ?? ''
const BROKER_IMAGE = 'eclipse-mosquitto:2.0.22'
const CONSUMER_IMAGE = 'openplc-editor-e2e-mqtt-consumer:local'

const NET = 'openplc-editor-e2e-mqtt-net'
const RUNTIME = 'openplc-editor-e2e-mqtt-runtime'
const BROKER = 'openplc-editor-e2e-mqtt-broker'
const CONSUMER = 'openplc-editor-e2e-mqtt-consumer'
const ROOT = join(tmpdir(), 'openplc-editor-e2e-mqtt-gate')
const PKI = join(ROOT, 'pki')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const RUNTIME_USER = 'gateoperator'
const RUNTIME_PASSWORD = 'gate-runtime-login-61f0'
const BROKER_USER = 'MARKER-USER-gate-desktop-2e71'
const BROKER_PASSWORD = 'MARKER-PW-gate-desktop-8b3d'
const WRONG_PASSWORD = 'MARKER-WRONGPW-gate-desktop-c5a9'
const CLIENT_ID = 'line-gate'
const GROUP_ID = 'openplc'
const LINT_MAX = '9223372036854775807'
const ULINT_MAX = '18446744073709551615'

const MAIN_ST = `PROGRAM Main
  VAR
    Counter : DINT;
    Toggle : BOOL;
    Big : LINT := ${LINT_MAX};
    Huge : ULINT := ${ULINT_MAX};
  END_VAR

Counter := Counter + 1;
Toggle := NOT Toggle;

END_PROGRAM
`

const run = (command: string, args: string[], input?: Buffer | string): string =>
  execFileSync(command, args, { encoding: 'utf-8', input, maxBuffer: 64 * 1024 * 1024 })
const docker = (...args: string[]): string => run('docker', args)
const quietly = (action: () => void) => {
  try {
    action()
  } catch {
    /* already gone */
  }
}

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

interface RuntimeMqttStatus {
  state: string
  mode?: string
  error: null | { category: string; code: string }
}

const runtimeMqttStatus = async (): Promise<RuntimeMqttStatus> =>
  JSON.parse((await runtimeCall('GET', '/api/mqtt/status', await runtimeToken())).body)

const plcStatus = async (): Promise<string> => {
  const parsed: { status: string } = JSON.parse((await runtimeCall('GET', '/api/status', await runtimeToken())).body)
  return parsed.status
}

const counterValue = (payload: string): number => {
  const parsed: { value: number } = JSON.parse(payload)
  return parsed.value
}

interface Pki {
  caPem: string
  clientCertPem: string
  clientKeyPem: string
  rogueCertPem: string
  rogueKeyPem: string
}

function writePki(): Pki {
  mkdirSync(PKI, { recursive: true })
  const at = (name: string) => join(PKI, name)
  const openssl = (...args: string[]) => run('openssl', args)
  const issue = (name: string, cn: string, ca: string, ext: string) => {
    openssl('genrsa', '-out', at(`${name}.key`), '2048')
    openssl('req', '-new', '-key', at(`${name}.key`), '-subj', `/CN=${cn}`, '-out', at(`${name}.csr`))
    writeFileSync(at(`${name}.ext`), ext)
    openssl(
      'x509',
      '-req',
      '-in',
      at(`${name}.csr`),
      '-CA',
      at(`${ca}.crt`),
      '-CAkey',
      at(`${ca}.key`),
      '-CAcreateserial',
      '-days',
      '2',
      '-extfile',
      at(`${name}.ext`),
      '-out',
      at(`${name}.crt`),
    )
  }
  for (const ca of ['ca', 'rogue-ca']) {
    openssl('genrsa', '-out', at(`${ca}.key`), '2048')
    openssl(
      'req',
      '-x509',
      '-new',
      '-key',
      at(`${ca}.key`),
      '-days',
      '2',
      '-subj',
      `/CN=${ca}`,
      '-out',
      at(`${ca}.crt`),
    )
  }
  issue('server', BROKER, 'ca', `subjectAltName=DNS:${BROKER}\nextendedKeyUsage=serverAuth\n`)
  issue('client', CLIENT_ID, 'ca', 'extendedKeyUsage=clientAuth\n')
  issue('rogue', CLIENT_ID, 'rogue-ca', 'extendedKeyUsage=clientAuth\n')
  for (const name of readdirSync(PKI)) chmodSync(at(name), 0o644)
  writeFileSync(
    at('mosquitto.conf'),
    [
      'persistence false',
      'log_dest stdout',
      'per_listener_settings true',
      'listener 8883',
      'certfile /pki/server.crt',
      'keyfile /pki/server.key',
      'allow_anonymous false',
      'password_file /mosquitto/passwd',
      'listener 8884',
      'certfile /pki/server.crt',
      'keyfile /pki/server.key',
      'cafile /pki/ca.crt',
      'require_certificate true',
      'use_identity_as_username true',
      '',
    ].join('\n'),
  )
  return {
    caPem: readFileSync(at('ca.crt'), 'utf-8'),
    clientCertPem: readFileSync(at('client.crt'), 'utf-8'),
    clientKeyPem: readFileSync(at('client.key'), 'utf-8'),
    rogueCertPem: readFileSync(at('rogue.crt'), 'utf-8'),
    rogueKeyPem: readFileSync(at('rogue.key'), 'utf-8'),
  }
}

/** Distinctive lines of a PEM body: what a leaked private key would look like in any file. */
const keyMarkers = (pem: string): string[] =>
  pem
    .split('\n')
    .filter((line) => line.length >= 60 && !line.startsWith('-----'))
    .slice(1, 3)

function writeFixture(): void {
  rmSync(FIXTURE, { recursive: true, force: true })
  rmSync(USER_DATA, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'mqtt-gate', type: 'plc-project' },
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
  writeFileSync(join(FIXTURE, 'pous', 'programs', 'Main.st'), MAIN_ST)

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'mqtt-gate',
        path: FIXTURE,
        projectFilePath: join(FIXTURE, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtimeDir = join(USER_DATA, 'User', 'Runtime')
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(join(runtimeDir, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtimeDir, 'arduino-library-control.json'), '[]')
}

const consumerDockerfile = [
  'FROM debian:bookworm-slim',
  'RUN apt-get update && apt-get install -y --no-install-recommends mosquitto-clients protobuf-compiler procps ca-certificates && rm -rf /var/lib/apt/lists/*',
  '',
].join('\n')

async function startEnvironment(): Promise<string> {
  docker('network', 'create', NET)
  run('docker', ['build', '-q', '-t', CONSUMER_IMAGE, '-'], consumerDockerfile)
  docker(
    'run',
    '-d',
    '--name',
    BROKER,
    '--network',
    NET,
    '-v',
    `${PKI}:/pki:ro`,
    BROKER_IMAGE,
    'sh',
    '-c',
    `mosquitto_passwd -b -c /mosquitto/passwd '${BROKER_USER}' '${BROKER_PASSWORD}' && chown mosquitto:mosquitto /mosquitto/passwd && chmod 0700 /mosquitto/passwd && exec mosquitto -c /pki/mosquitto.conf`,
  )
  docker(
    'run',
    '-d',
    '--name',
    CONSUMER,
    '--network',
    NET,
    '-v',
    `${PKI}:/pki:ro`,
    '-v',
    `${dirname(SPARKPLUG_PROTO)}:/proto:ro`,
    CONSUMER_IMAGE,
    'sleep',
    'infinity',
  )
  docker('run', '-d', '--name', RUNTIME, '--network', NET, '-p', '127.0.0.1:8443:8443', IMAGE)
  const deadline = Date.now() + 180000
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
  // Read on the device itself, as the identity panel tells the user to.
  return docker(
    'exec',
    RUNTIME,
    'openssl',
    'x509',
    '-in',
    '/workdir/webserver/certOPENPLC.pem',
    '-noout',
    '-fingerprint',
    '-sha256',
  ).trim()
}

const cleanup = () => {
  quietly(() => docker('rm', '-f', RUNTIME, BROKER, CONSUMER))
  quietly(() => docker('network', 'rm', NET))
}

interface Capture {
  lines: () => string[]
  stop: () => void
}

/** Independent mosquitto_sub, started early because births are not retained; it retries while the broker is down. */
const capture = (topic: string, format: '%t %p' | '%t %x'): Capture => {
  const out: string[] = []
  let pending = ''
  const tag = `capture-${Math.random().toString(16).slice(2)}`
  const subscriber = [
    `until mosquitto_sub -i ${tag} -h ${BROKER} -p 8883 --cafile /pki/ca.crt`,
    `-u '${BROKER_USER}' -P '${BROKER_PASSWORD}' -t '${topic}' -F '${format}'; do sleep 0.2; done`,
  ].join(' ')
  const child: ChildProcess = spawn('docker', ['exec', CONSUMER, 'sh', '-c', subscriber])
  child.stdout?.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf-8')
    const parts = pending.split('\n')
    pending = parts.pop() ?? ''
    out.push(...parts.filter((line) => line.trim() !== ''))
  })
  return {
    lines: () => [...out],
    stop: () => {
      child.kill('SIGTERM')
      quietly(() => docker('exec', CONSUMER, 'pkill', '-f', tag))
    },
  }
}

interface Message {
  topic: string
  payload: string
}

const messages = (lines: string[]): Message[] =>
  lines.map((line) => ({ topic: line.slice(0, line.indexOf(' ')), payload: line.slice(line.indexOf(' ') + 1) }))

/** Decoded by protoc from the official schema, independently of the runtime's serializer. */
const decodeSparkplug = (hex: string): string =>
  run(
    'docker',
    [
      'exec',
      '-i',
      CONSUMER,
      'protoc',
      '--decode=org.eclipse.tahu.protobuf.Payload',
      '-I',
      '/proto',
      '/proto/sparkplug_b.proto',
    ],
    Buffer.from(hex, 'hex'),
  )

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = EXECUTABLE
    ? await electron.launch({ executablePath: EXECUTABLE, args: [`--user-data-dir=${USER_DATA}`] })
    : await electron.launch({
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

/** Ctrl+S is a native menu accelerator, which Playwright's keyboard never reaches. */
const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

const editor = (page: Page) => page.getByLabel('MQTT client editor')
const openTab = (page: Page, name: string) =>
  editor(page)
    .getByRole('tab', { name: new RegExp(`^${name}`) })
    .click()

const commit = async (page: Page, label: string, value: string) => {
  const field = editor(page).getByLabel(label, { exact: true })
  await field.fill(value)
  await field.press('Enter')
}

const openTelemetry = async (page: Page) => {
  const entry = page
    .locator('li')
    .filter({ hasText: /^\*?\s*Telemetry$/ })
    .first()
  if (!(await entry.isVisible())) await page.getByText('Servers', { exact: true }).first().click()
  await entry.click()
  await expect(page.getByRole('heading', { name: 'MQTT client: Telemetry' })).toBeVisible()
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

const UPLOAD_SETTLED = /Upload complete\.|Failed to upload|Stopping compilation process|MQTT Configuration Error/

/** Runs Build and upload and waits for one more settling line; returns the page text at that point. */
const buildAndUpload = async (page: Page): Promise<string> => {
  const before = occurrences(await page.locator('body').innerText(), UPLOAD_SETTLED)
  await page.getByLabel('Build options').click()
  await page.getByText('Build and upload', { exact: true }).click()
  const stopFirst = page.getByRole('button', { name: 'Stop PLC and Continue' })
  try {
    await stopFirst.waitFor({ state: 'visible', timeout: 5000 })
    await stopFirst.click()
  } catch {
    /* the PLC was not running */
  }
  try {
    await expect
      .poll(async () => occurrences(await page.locator('body').innerText(), UPLOAD_SETTLED), { timeout: 300000 })
      .toBeGreaterThan(before)
  } catch (error) {
    writeFileSync(join(ROOT, 'page-at-failure.txt'), await page.locator('body').innerText())
    throw error
  }
  const text = await page.locator('body').innerText()
  expect(text.slice(text.lastIndexOf('Generated conf/mqtt.json'))).toContain('Upload complete.')
  return text
}

const expectRuntimeState = async (page: Page, state: string, category?: string) => {
  await openTelemetry(page)
  await openTab(page, 'Status')
  await expect(page.getByTestId('mqtt-runtime-state')).toHaveAttribute('data-state', state, { timeout: 90000 })
  if (category === undefined) await expect(page.getByTestId('mqtt-runtime-error-category')).toHaveCount(0)
  else await expect(page.getByTestId('mqtt-runtime-error-category')).toHaveAttribute('data-category', category)
}

const enterPassword = async (page: Page, password: string) => {
  await openTelemetry(page)
  await openTab(page, 'Security')
  const replace = page.getByRole('button', { name: 'Replace credential' })
  if (await replace.isVisible()) await replace.click()
  else await page.getByRole('button', { name: 'Enter credential' }).click()
  await editor(page).getByLabel('Username', { exact: true }).fill(BROKER_USER)
  await editor(page).getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Save credential' }).click()
  await expect(page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'local')
}

const enterCertificate = async (page: Page, certificatePem: string, keyPem: string) => {
  await openTelemetry(page)
  await openTab(page, 'Security')
  const replace = page.getByRole('button', { name: 'Replace credential' })
  if (await replace.isVisible()) await replace.click()
  else await page.getByRole('button', { name: 'Enter credential' }).click()
  await editor(page).getByLabel('Client certificate (PEM)', { exact: true }).fill(certificatePem)
  await editor(page).getByLabel('Private key (PEM)', { exact: true }).fill(keyPem)
  await page.getByRole('button', { name: 'Save credential' }).click()
  await expect(page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'local')
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) return []
    return stat.isDirectory() ? filesUnder(full) : [full]
  })

test.describe.configure({ mode: 'serial' })

test('publishes to a real broker in both modes from the desktop app, survives failures and keeps secrets out', async () => {
  test.skip(IMAGE === '' || SPARKPLUG_PROTO === '', 'needs MQTT_DEPLOY_RUNTIME_IMAGE and MQTT_DEPLOY_SPARKPLUG_PROTO')
  test.setTimeout(1800000)
  cleanup()
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(ROOT, { recursive: true })
  const pki = writePki()
  const markers = [BROKER_USER, BROKER_PASSWORD, WRONG_PASSWORD, ...keyMarkers(pki.clientKeyPem)]
  writeFixture()

  let app: ElectronApplication | null = null
  try {
    const fingerprint = await startEnvironment()
    expect(fingerprint).toMatch(/^sha256 Fingerprint=([0-9A-F]{2}:){31}[0-9A-F]{2}$/i)

    const first = await launch()
    app = first.app
    const page = first.page
    await page.getByText('mqtt-gate', { exact: true }).first().click({ timeout: 30000 })
    await expect(page.getByText('Main', { exact: true }).first()).toBeVisible({ timeout: 30000 })

    // Generic mode, created through the protocol flow like a user would.
    await page.locator('#create-plc-element-trigger').click()
    await page.locator('#create-server-trigger').hover()
    const card = page.locator('#create-server-content')
    await card.locator('#server-name').fill('Telemetry')
    await card.getByLabel('server-protocol').click()
    await page.getByRole('option', { name: 'MQTT client' }).click()
    await card.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { name: 'MQTT client: Telemetry' })).toBeVisible()
    await commit(page, 'Broker host', BROKER)
    await commit(page, 'Client ID', CLIENT_ID)
    await openTab(page, 'Security')
    await editor(page).getByLabel('Private CA (PEM)').check()
    const caField = editor(page).getByLabel('CA certificate (PEM, not secret)', { exact: true })
    await caField.fill(pki.caPem)
    await caField.blur()
    await editor(page).getByLabel('Authentication', { exact: true }).selectOption('username_password')
    await openTab(page, 'Variables')
    await page.getByRole('button', { name: 'Expand Line1.Main', exact: true }).click()
    for (const name of ['Counter', 'Toggle', 'Big', 'Huge'])
      await page.getByRole('checkbox', { name: `Select Line1.Main.${name}` }).check()
    await expect(page.getByTestId('mqtt-selected-count')).toHaveText('4')
    await editor(page).locator('label[for="mqtt-enabled"]').click()
    await expect(editor(page).getByRole('checkbox', { name: 'Enable MQTT integration' })).toBeChecked()
    await save(app)

    await connectRuntime(page)
    await openTelemetry(page)
    await openTab(page, 'Security')
    await editor(page).getByLabel('Runtime certificate SHA-256 fingerprint').fill(fingerprint)
    await page.getByRole('button', { name: 'Trust this runtime' }).click()
    await expect(page.getByTestId('runtime-identity-state')).toHaveAttribute('data-state', 'trusted')

    // 1. A wrong broker password: the program runs, the integration reports an authentication error.
    await enterPassword(page, WRONG_PASSWORD)
    let text = await buildAndUpload(page)
    expect(text).toMatch(/Generated conf\/mqtt\.json for "Telemetry": 4 leaves, mode generic/)
    await expectRuntimeState(page, 'retry_wait', 'authentication')
    expect(await plcStatus()).toContain('RUNNING')

    // 2. The right password replaces it: an independent consumer sees every selected leaf, exactly.
    await enterPassword(page, BROKER_PASSWORD)
    const prefix = `openplc/${CLIENT_ID}/Line1/Main`
    const leafTopics = ['Big', 'Counter', 'Huge', 'Toggle'].map((name) => `${prefix}/${name}`)
    const generic = capture(`openplc/${CLIENT_ID}/#`, '%t %p')
    try {
      text = await buildAndUpload(page)
      await expectRuntimeState(page, 'connected')
      await expect
        .poll(() => messages(generic.lines()).filter((m) => m.topic === `${prefix}/Counter`).length, {
          timeout: 60000,
        })
        .toBeGreaterThan(3)
    } finally {
      generic.stop()
    }
    const received = messages(generic.lines())
    writeFileSync(join(ROOT, 'generic-capture.txt'), generic.lines().join('\n'))
    const firstOf = (topic: string) => received.find((m) => m.topic === topic)?.payload
    expect(firstOf(`${prefix}/Big`)).toBe(`{"value":"${LINT_MAX}"}`)
    expect(firstOf(`${prefix}/Huge`)).toBe(`{"value":"${ULINT_MAX}"}`)
    expect(firstOf(`${prefix}/Toggle`)).toMatch(/^\{"value":(true|false)\}$/)
    const counters = received.filter((m) => m.topic === `${prefix}/Counter`).map((m) => counterValue(m.payload))
    expect(new Set(counters).size).toBe(counters.length)
    expect([...new Set(received.map((m) => m.topic))].sort()).toEqual(leafTopics)

    // 3. Without the local copy the editor shows the credential the runtime holds for this broker.
    await openTab(page, 'Security')
    await page.getByRole('button', { name: 'Remove credential' }).click()
    await expect(page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'runtime', { timeout: 30000 })

    // 4. Broker outage and return: the PLC keeps running and every current value is published again.
    const beforeOutage = Math.max(...counters)
    docker('stop', BROKER)
    await expectRuntimeState(page, 'retry_wait', 'network')
    expect(await plcStatus()).toContain('RUNNING')
    const resumed = capture(`openplc/${CLIENT_ID}/#`, '%t %p')
    try {
      docker('start', BROKER)
      await expectRuntimeState(page, 'connected')
      await expect
        .poll(() => new Set(messages(resumed.lines()).map((m) => m.topic)).size, { timeout: 60000 })
        .toBe(leafTopics.length)
    } finally {
      resumed.stop()
    }
    writeFileSync(join(ROOT, 'generic-resumed.txt'), resumed.lines().join('\n'))
    const afterOutage = messages(resumed.lines())
    expect(afterOutage.find((m) => m.topic === `${prefix}/Big`)?.payload).toBe(`{"value":"${LINT_MAX}"}`)
    const resumedCounters = afterOutage
      .filter((m) => m.topic === `${prefix}/Counter`)
      .map((m) => counterValue(m.payload))
    expect(Math.min(...resumedCounters)).toBeGreaterThan(beforeOutage)

    // 5. Sparkplug B with a client certificate on the listener that requires one.
    await openTelemetry(page)
    await openTab(page, 'Publication')
    await editor(page).getByLabel('Mode', { exact: true }).selectOption('sparkplug_b')
    await commit(page, 'Edge Node ID', CLIENT_ID)
    await openTab(page, 'Connection')
    await commit(page, 'Broker port', '8884')
    await openTab(page, 'Security')
    await editor(page).getByLabel('Authentication', { exact: true }).selectOption('client_certificate')
    await save(app)

    // 5a. A certificate from another authority is refused by the broker.
    await enterCertificate(page, pki.rogueCertPem, pki.rogueKeyPem)
    text = await buildAndUpload(page)
    expect(text).toMatch(/Generated conf\/mqtt\.json for "Telemetry": 4 leaves, mode sparkplug_b/)
    await expectRuntimeState(page, 'retry_wait', 'certificate')
    const refused = await runtimeMqttStatus()
    writeFileSync(join(ROOT, 'rogue-certificate-status.json'), JSON.stringify(refused, null, 2))
    expect(refused.error?.code).toBe('client_certificate_rejected')
    expect(await plcStatus()).toContain('RUNNING')

    // 5b. The right certificate: birth first, then data, decoded with the official schema.
    await enterCertificate(page, pki.clientCertPem, pki.clientKeyPem)
    const sparkplug = capture(`spBv1.0/${GROUP_ID}/#`, '%t %x')
    try {
      text = await buildAndUpload(page)
      await expectRuntimeState(page, 'connected')
      await expect
        .poll(() => sparkplug.lines().filter((l) => l.includes('/NDATA/')).length, { timeout: 60000 })
        .toBeGreaterThan(2)
    } finally {
      sparkplug.stop()
    }
    const seen = sparkplug.lines().map((line) => ({
      topic: line.slice(0, line.indexOf(' ')),
      hex: line.slice(line.indexOf(' ') + 1),
    }))
    writeFileSync(join(ROOT, 'sparkplug-capture.txt'), seen.map((m) => `${m.topic} ${m.hex}`).join('\n'))
    const firstBirth = seen.findIndex((m) => m.topic === `spBv1.0/${GROUP_ID}/NBIRTH/${CLIENT_ID}`)
    const firstData = seen.findIndex((m) => m.topic === `spBv1.0/${GROUP_ID}/NDATA/${CLIENT_ID}`)
    expect(firstBirth).toBeGreaterThanOrEqual(0)
    expect(firstBirth).toBeLessThan(firstData)
    const birth = decodeSparkplug(seen[firstBirth].hex)
    writeFileSync(join(ROOT, 'nbirth.txt'), birth)
    for (const metric of ['bdSeq', 'Node Control/Rebirth', 'Line1.Main.Counter', 'Line1.Main.Big', 'Line1.Main.Huge'])
      expect(birth).toContain(`name: "${metric}"`)
    expect(birth).toMatch(/seq: 0/)
    expect(birth).toContain(`long_value: ${LINT_MAX}`)
    expect(birth).toContain(`long_value: ${ULINT_MAX}`)
    expect(birth).toMatch(/string_value: "ULINT"/)
    const data = seen
      .filter((m) => m.topic === `spBv1.0/${GROUP_ID}/NDATA/${CLIENT_ID}`)
      .map((m) => decodeSparkplug(m.hex))
    writeFileSync(join(ROOT, 'ndata.txt'), data.join('\n----\n'))
    const seqs = data.map((d) => Number(/^seq: (\d+)/m.exec(d)?.[1]))
    expect(seqs[0]).toBe(1)
    expect(seqs.slice(1)).toEqual(seqs.slice(1).map((_, i) => (seqs[0] + i + 1) % 256))
    expect(data.some((d) => d.includes('name: "Line1.Main.Counter"'))).toBe(true)

    // 6. Stop from the editor: the node announces its death and the integration reports the stopped PLC.
    const death = capture(`spBv1.0/${GROUP_ID}/NDEATH/${CLIENT_ID}`, '%t %x')
    try {
      await page.getByRole('button', { name: 'Play' }).click()
      await expect.poll(async () => plcStatus(), { timeout: 60000 }).toContain('STOPPED')
      await expect.poll(() => death.lines().length, { timeout: 30000 }).toBeGreaterThan(0)
    } finally {
      death.stop()
    }
    await expectRuntimeState(page, 'plc_stopped')
    const deathPayload = decodeSparkplug(death.lines()[0].slice(death.lines()[0].indexOf(' ') + 1))
    writeFileSync(join(ROOT, 'ndeath.txt'), deathPayload)
    const bdSeqOf = (payload: string) => /name: "bdSeq"[^}]*long_value: (\d+)/.exec(payload)?.[1]
    expect(bdSeqOf(deathPayload)).toBe(bdSeqOf(birth))

    // 7. Reopen from disk: the Sparkplug configuration is back and the certificate is still in the local vault.
    await save(app)
    await shutdown(app)
    app = null
    const second = await launch()
    app = second.app
    await second.page.getByText('mqtt-gate', { exact: true }).first().click({ timeout: 30000 })
    await expect(second.page.getByText('Main', { exact: true }).first()).toBeVisible({ timeout: 30000 })
    await openTelemetry(second.page)
    await openTab(second.page, 'Publication')
    await expect(editor(second.page).getByLabel('Mode', { exact: true })).toHaveValue('sparkplug_b')
    await openTab(second.page, 'Security')
    await expect(second.page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'local')
    await expect(second.page.getByTestId('mqtt-selected-count')).toHaveCount(0)
    await openTab(second.page, 'Variables')
    await expect(second.page.getByTestId('mqtt-selected-count')).toHaveText('4')
    await shutdown(app)
    app = null

    // 8. Secrets: project and build output, editor profile and logs, stored project, runtime disk and logs.
    const leaks: string[] = []
    const scan = (label: string, content: string) => {
      for (const marker of markers) {
        if (content.includes(marker) || content.includes(Buffer.from(marker).toString('base64'))) leaks.push(label)
      }
    }
    for (const file of [...filesUnder(FIXTURE), ...filesUnder(USER_DATA)]) scan(file, readFileSync(file, 'latin1'))
    const snapshot: { contentBase64: string } = JSON.parse(
      (await runtimeCall('GET', '/api/project-snapshot', await runtimeToken())).body,
    )
    const archive = await JSZip.loadAsync(Buffer.from(snapshot.contentBase64, 'base64'))
    for (const name of Object.keys(archive.files)) {
      if (!archive.files[name].dir) scan(`snapshot:${name}`, await archive.files[name].async('string'))
    }
    const runtimeHits = docker(
      'exec',
      RUNTIME,
      'sh',
      '-c',
      `grep -rlaF ${markers.map((m) => `-e '${m}'`).join(' ')} /workdir /var/run/runtime /tmp 2>/dev/null || true`,
    ).trim()
    if (runtimeHits !== '') leaks.push(`runtime:${runtimeHits}`)
    scan('runtime docker logs', run('sh', ['-c', `docker logs ${RUNTIME} 2>&1`]))
    expect(leaks).toEqual([])
  } finally {
    if (app) await shutdown(app)
    writeFileSync(join(ROOT, 'runtime.log'), run('sh', ['-c', `docker logs ${RUNTIME} 2>&1 || true`]))
    writeFileSync(join(ROOT, 'broker.log'), run('sh', ['-c', `docker logs ${BROKER} 2>&1 || true`]))
    cleanup()
  }
})
