import { safeStorage } from 'electron'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDefaultMqttIntegration } from '../../../../frontend/utils/mqtt/project/model'

import { pinnedRuntimeRequest } from '../../../../backend/editor/runtime/pinned-runtime-request'
import { logger } from '../../../../backend/editor/services'
import MainProcessBridge from '../main'

jest.mock('electron', () => {
  const crypto = jest.requireActual<typeof import('crypto')>('crypto')
  const key = Uint8Array.from(crypto.randomBytes(32))
  return {
    app: { getPath: jest.fn(() => '/nonexistent'), quit: jest.fn() },
    dialog: {},
    nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
    shell: { openExternal: jest.fn() },
    safeStorage: {
      isEncryptionAvailable: jest.fn(() => true),
      getSelectedStorageBackend: jest.fn(() => 'gnome_libsecret'),
      encryptString: jest.fn((plain: string) => {
        const iv = crypto.randomBytes(12).toString('hex')
        const aes = crypto.createCipheriv('aes-256-gcm', key, Uint8Array.from(Buffer.from(iv, 'hex')))
        const body = aes.update(plain, 'utf-8', 'hex') + aes.final('hex')
        return Buffer.from(iv + aes.getAuthTag().toString('hex') + body, 'hex')
      }),
      decryptString: jest.fn((sealed: Buffer) => {
        const hex = sealed.toString('hex')
        const aes = crypto.createDecipheriv('aes-256-gcm', key, Uint8Array.from(Buffer.from(hex.slice(0, 24), 'hex')))
        aes.setAuthTag(Uint8Array.from(Buffer.from(hex.slice(24, 56), 'hex')))
        return aes.update(hex.slice(56), 'hex', 'utf-8') + aes.final('utf-8')
      }),
    },
  }
})

jest.mock('@root/backend/editor/ethercat', () => ({ ESIService: jest.fn() }))
jest.mock('@root/backend/editor/library-manager/desktop-catalog-transport', () => ({
  createDesktopCatalogTransport: jest.fn(() => ({})),
}))
jest.mock('@root/backend/editor/utils/runtime-https-config', () => ({ getRuntimeHttpsOptions: jest.fn(() => ({})) }))
jest.mock('@root/backend/shared/ethercat/esi-parser-main', () => ({ parseESIDeviceFull: jest.fn() }))
jest.mock('@root/backend/shared/library/public-catalog-client', () => ({ listPublicLibraries: jest.fn() }))
jest.mock('../../../../backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn(() => ({ loadEnabledArchives: jest.fn(() => ({ archives: [], missing: [] })) })),
}))
jest.mock('../../../../backend/editor/package-manager', () => ({ PackageManagerModule: jest.fn(() => ({})) }))
jest.mock('../../../../backend/editor/services', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('../../../../backend/editor/utils', () => ({ getOpenProjectPath: jest.fn(), getProjectPath: jest.fn() }))
jest.mock('../../../../backend/editor/runtime/pinned-runtime-request', () => ({
  ...jest.requireActual<typeof import('../../../../backend/editor/runtime/pinned-runtime-request')>(
    '../../../../backend/editor/runtime/pinned-runtime-request',
  ),
  pinnedRuntimeRequest: jest.fn(),
}))

const electron = jest.requireMock<{ app: { getPath: jest.Mock } }>('electron')
const storage = jest.mocked(safeStorage)
const log = jest.mocked(logger)

const PASSWORD = 'MARKER-PW-e5-ipc-6e2b'
const USERNAME = 'MARKER-USER-e5-ipc-1c9d'
const MARKERS = [PASSWORD, USERNAME]
const EVENT = {} as never
const PIN = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const ADDRESS = '10.1.2.3'
const TOKEN = 'TOKEN-e5-ipc-session'
const PROGRAM_MD5 = '3f2c9d0e8b7a6f5e4d3c2b1a09f8e7d6'
const API = join(__dirname, '..', '..', '..', '..', 'frontend', 'utils', 'mqtt', 'contract', 'fixtures', 'api')
const fixture = (file: string): Record<string, unknown> => JSON.parse(readFileSync(join(API, file), 'utf-8'))

const BINDING = {
  host: 'broker.example.net',
  port: 8883,
  tlsEnabled: true,
  clientId: 'plc-linha1',
  method: 'username_password',
} as const

const handles = new Map<string, (...args: unknown[]) => unknown>()
const pinned = jest.mocked(pinnedRuntimeRequest)

let root: string
let project: string
let bridge: MainProcessBridge

const createBridge = (): MainProcessBridge => {
  const instance = new MainProcessBridge({
    ipcMain: {
      on: jest.fn(),
      handle: jest.fn((channel: string, handler: (...args: unknown[]) => unknown) => handles.set(channel, handler)),
      removeHandler: jest.fn(),
      removeAllListeners: jest.fn(),
    },
    mainWindow: {
      isDestroyed: jest.fn(() => false),
      webContents: { send: jest.fn(), on: jest.fn(), isCrashed: jest.fn(() => false) },
    },
    projectService: {},
    store: { get: jest.fn(() => undefined) },
    menuBuilder: {},
    pouService: {},
    compilerModule: {},
    hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
    quitCoordinator: {},
  } as never)
  instance.setupMainIpcListener()
  return instance
}

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handles.get(channel)
  if (!handler) throw new Error(`nothing handles "${channel}"`)
  return handler(EVENT, ...args)
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return lstatSync(full).isDirectory() ? filesUnder(full) : [full]
  })

/** Log in the runtime session as the login handler would. */
const loginSession = (address: string) => {
  const runtimeApi = bridge['runtimeApi']
  runtimeApi.setAddress(address)
  runtimeApi.tokens.setSession(TOKEN, { username: 'operator', password: 'runtime-login-password' })
}

const integration = () => {
  const base = createDefaultMqttIntegration('plc-linha1')
  return {
    ...base,
    enabled: true,
    authMethod: 'username_password' as const,
    connection: { ...base.connection, host: 'broker.example.net' },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  handles.clear()
  storage.isEncryptionAvailable.mockReturnValue(true)
  root = mkdtempSync(join(tmpdir(), 'openplc-e5-ipc-'))
  project = join(root, 'projects', 'line-1')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'project.json'), '{}')
  electron.app.getPath.mockReturnValue(join(root, 'userdata'))
  bridge = createBridge()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('runtime identity channels', () => {
  it('pins a typed fingerprint per target in the profile, outside the project', async () => {
    await expect(invoke('runtime-identity:get', `address:${ADDRESS}`)).resolves.toBeNull()
    const set = await invoke('runtime-identity:set', `address:${ADDRESS}`, PIN.toUpperCase())
    expect(set).toMatchObject({ ok: true, pin: { sha256: PIN } })
    await expect(invoke('runtime-identity:get', `address:${ADDRESS}`)).resolves.toMatchObject({ sha256: PIN })
    expect(filesUnder(root).sort()).toEqual(
      [join(project, 'project.json'), join(root, 'userdata', 'runtime-identity', 'pins.json')].sort(),
    )
    await invoke('runtime-identity:remove', `address:${ADDRESS}`)
    await expect(invoke('runtime-identity:get', `address:${ADDRESS}`)).resolves.toBeNull()
  })

  it.each([
    ['a non-string target', 42, PIN],
    ['a non-string fingerprint', `address:${ADDRESS}`, { sha256: PIN }],
    ['an oversized fingerprint', `address:${ADDRESS}`, `${PIN}${' '.repeat(300)}`],
    ['a short fingerprint', `address:${ADDRESS}`, PIN.slice(4)],
  ])('refuses %s', async (_label, target, fingerprint) => {
    await expect(invoke('runtime-identity:set', target, fingerprint)).resolves.toMatchObject({
      ok: false,
      code: 'runtime_identity_invalid',
    })
    await expect(invoke('runtime-identity:get', 42)).resolves.toBeNull()
    await invoke('runtime-identity:remove', 42)
    expect(filesUnder(root)).toEqual([join(project, 'project.json')])
  })
})

describe('MQTT runtime body channels', () => {
  it('passes the raw status and credentials bodies with a bounded read, and hides failure bodies', async () => {
    const request = jest
      .spyOn(bridge['runtimeApi'], 'makeRuntimeApiRequest')
      .mockResolvedValueOnce({ success: true, data: fixture('status-disabled.json') })
      .mockResolvedValueOnce({ success: false, error: '<html>secret page</html>', statusCode: 404 })
      .mockResolvedValueOnce({ success: false, error: 'ECONNREFUSED' })
    await expect(invoke('runtime:get-mqtt-status', ADDRESS)).resolves.toEqual({
      success: true,
      data: fixture('status-disabled.json'),
    })
    await expect(invoke('runtime:get-mqtt-credentials', ADDRESS)).resolves.toEqual({
      success: false,
      error: 'HTTP 404',
    })
    await expect(invoke('runtime:get-mqtt-status', ADDRESS)).resolves.toEqual({
      success: false,
      error: 'The runtime could not be reached',
    })
    expect(request.mock.calls.map((call) => [call[0], call[1], call[3]])).toEqual([
      [ADDRESS, '/api/mqtt/status', 64 * 1024],
      [ADDRESS, '/api/mqtt/credentials', 64 * 1024],
      [ADDRESS, '/api/mqtt/status', 64 * 1024],
    ])
    await expect(invoke('runtime:get-mqtt-status', '')).resolves.toEqual({
      success: false,
      error: 'No runtime address',
    })
    expect(request).toHaveBeenCalledTimes(3)
  })
})

describe('deployer used by the compile', () => {
  const scope = () => ({ projectKey: project, targetKey: `address:${ADDRESS}`, serverName: 'broker' })

  const scriptRuntime = () => {
    const receipt: Record<string, unknown> = {
      ...fixture('staging-receipt.json'),
      method: 'username_password',
      programMd5: PROGRAM_MD5,
    }
    delete receipt.clientCertificate
    receipt.binding = { ...(receipt.binding as Record<string, unknown>), method: 'username_password' }
    pinned.mockImplementation((request) =>
      Promise.resolve(
        request.path === '/api/mqtt/capabilities'
          ? { statusCode: 200, body: JSON.stringify(fixture('capabilities.json')) }
          : { statusCode: 201, body: JSON.stringify(receipt) },
      ),
    )
    return receipt
  }

  it('stages the vault secret on the logged-in, pinned runtime with the session token', async () => {
    await invoke(
      'mqtt-credentials:put',
      scope(),
      { method: 'username_password', username: USERNAME, password: PASSWORD },
      BINDING,
    )
    await invoke('runtime-identity:set', `address:${ADDRESS}`, PIN)
    loginSession(ADDRESS)
    const receipt = scriptRuntime()
    let sentBody = ''
    pinned.mockImplementationOnce((request) => {
      expect(request.method).toBe('GET')
      return Promise.resolve({ statusCode: 200, body: JSON.stringify(fixture('capabilities.json')) })
    })
    pinned.mockImplementationOnce((request) => {
      sentBody = request.body?.toString('utf-8') ?? ''
      return Promise.resolve({ statusCode: 201, body: JSON.stringify(receipt) })
    })

    const result = await bridge.mqttCredentialDeployer.stage({
      address: ADDRESS,
      projectKey: project,
      serverName: 'broker',
      integration: integration(),
      programMd5: PROGRAM_MD5,
    })

    expect(result).toMatchObject({ ok: true, stagingId: receipt.stagingId })
    expect(
      pinned.mock.calls.map(([request]) => [request.host, request.port, request.sha256, request.method, request.path]),
    ).toEqual([
      [ADDRESS, 8443, PIN, 'GET', '/api/mqtt/capabilities'],
      [ADDRESS, 8443, PIN, 'POST', '/api/mqtt/credentials/staging'],
    ])
    expect(pinned.mock.calls.every(([request]) => request.headers?.Authorization === `Bearer ${TOKEN}`)).toBe(true)
    expect(sentBody).toContain(PASSWORD)
    expect(sentBody).toContain(USERNAME)

    const logged = [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].map((call) =>
      String(call[0]),
    )
    const texts = [
      JSON.stringify(result),
      logged.join('\n'),
      ...filesUnder(root).map((file) => readFileSync(file, 'latin1')),
    ]
    for (const text of texts) {
      for (const marker of MARKERS) {
        expect(text).not.toContain(marker)
        expect(text).not.toContain(Buffer.from(marker).toString('base64'))
      }
    }
  })

  it('sends nothing when the target has no pin or the session belongs to another runtime', async () => {
    await invoke(
      'mqtt-credentials:put',
      scope(),
      { method: 'username_password', username: USERNAME, password: PASSWORD },
      BINDING,
    )
    scriptRuntime()
    loginSession(ADDRESS)
    const input = {
      address: ADDRESS,
      projectKey: project,
      serverName: 'broker',
      integration: integration(),
      programMd5: PROGRAM_MD5,
    }
    await expect(bridge.mqttCredentialDeployer.stage(input)).resolves.toMatchObject({
      ok: false,
      code: 'runtime_trust_missing',
    })
    await invoke('runtime-identity:set', `address:${ADDRESS}`, PIN)
    loginSession('10.9.9.9')
    await expect(bridge.mqttCredentialDeployer.stage(input)).resolves.toMatchObject({ ok: false, code: 'forbidden' })
    loginSession(ADDRESS)
    bridge['runtimeApi'].clearSession()
    expect(bridge['runtimeApi'].getAddress()).toBe(ADDRESS)
    await expect(bridge.mqttCredentialDeployer.stage(input)).resolves.toMatchObject({ ok: false, code: 'forbidden' })
    expect(pinned).not.toHaveBeenCalled()
  })
})
