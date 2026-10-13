import { safeStorage } from 'electron'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const electron = jest.requireMock<{ app: { getPath: jest.Mock } }>('electron')
const storage = jest.mocked(safeStorage)
const log = jest.mocked(logger)

const PASSWORD = 'MARKER-PW-e4-ipc-2d6a'
const USERNAME = 'MARKER-USER-e4-ipc-9f13'
const KEY_BODY = 'MARKERKEYBODYe4ipc77c0'
const MARKERS = [PASSWORD, USERNAME, KEY_BODY]

const EVENT = {} as never

const BINDING = {
  host: 'broker.plant.local',
  port: 8883,
  tlsEnabled: true,
  clientId: 'line-1',
  method: 'username_password',
} as const
const SECRET = { method: 'username_password', username: USERNAME, password: PASSWORD } as const
const CERT_SECRET = {
  method: 'client_certificate',
  certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBcert\n-----END CERTIFICATE-----\n',
  privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\n-----END PRIVATE KEY-----\n`,
} as const
const BAD_REQUEST = { ok: false, code: 'credential_invalid_format', message: 'The credential request is malformed.' }

const handles = new Map<string, (...args: unknown[]) => unknown>()
const deleteProject = jest.fn((_path: string) => Promise.resolve({ success: true }))

let root: string
let project: string
let scope: { projectKey: string; targetKey: string; serverName: string }

const createBridge = (): MainProcessBridge => {
  const bridge = new MainProcessBridge({
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
    projectService: { deleteProject },
    store: { get: jest.fn(() => undefined) },
    menuBuilder: {},
    pouService: {},
    compilerModule: {},
    hardwareModule: { isSerialPortPresent: jest.fn(() => true) },
    quitCoordinator: {},
  } as never)
  bridge.setupMainIpcListener()
  return bridge
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

const expectNoMarkerAnywhere = (replies: unknown[]) => {
  const logged = [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]
    .map((call) => String(call[0]))
    .join('\n')
  const texts = [JSON.stringify(replies), logged, ...filesUnder(root).map((file) => readFileSync(file, 'latin1'))]
  for (const text of texts) {
    for (const marker of MARKERS) {
      expect(text).not.toContain(marker)
      expect(text).not.toContain(Buffer.from(marker).toString('base64'))
    }
  }
}

let bridge: MainProcessBridge

beforeEach(() => {
  jest.clearAllMocks()
  handles.clear()
  storage.isEncryptionAvailable.mockReturnValue(true)
  root = mkdtempSync(join(tmpdir(), 'openplc-e4-ipc-'))
  project = join(root, 'projects', 'line-1')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'project.json'), '{}')
  electron.app.getPath.mockReturnValue(join(root, 'userdata'))
  scope = { projectKey: project, targetKey: 'address:192.168.1.50', serverName: 'Telemetry' }
  bridge = createBridge()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('channel surface', () => {
  it('registers four write-only channels and nothing that reads a secret or a path', () => {
    const channels = [...handles.keys()].filter((channel) => channel.startsWith('mqtt-credentials:'))
    expect(channels.sort()).toEqual([
      'mqtt-credentials:get-presence',
      'mqtt-credentials:persistence',
      'mqtt-credentials:put',
      'mqtt-credentials:remove',
    ])
  })

  it('reports the persistence the OS allows', async () => {
    await expect(invoke('mqtt-credentials:persistence')).resolves.toBe('protected')
    storage.isEncryptionAvailable.mockReturnValue(false)
    await expect(invoke('mqtt-credentials:persistence')).resolves.toBe('session')
  })
})

describe('malformed input', () => {
  it.each([
    ['no scope', undefined],
    ['a string', 'project'],
    ['a missing server', { projectKey: 'p', targetKey: 't' }],
    ['an extra path', { projectKey: 'p', targetKey: 't', serverName: 's', path: '/etc/passwd' }],
    ['a number', { projectKey: 1, targetKey: 't', serverName: 's' }],
    ['an empty key', { projectKey: '', targetKey: 't', serverName: 's' }],
    ['a control character', { projectKey: 'p', targetKey: 't\n', serverName: 's' }],
    ['padding', { projectKey: 'p', targetKey: ' t', serverName: 's' }],
    ['an oversized key', { projectKey: 'p'.repeat(4097), targetKey: 't', serverName: 's' }],
  ])('refuses a scope with %s on every channel', async (_label, badScope) => {
    await expect(invoke('mqtt-credentials:get-presence', badScope)).resolves.toEqual(BAD_REQUEST)
    await expect(invoke('mqtt-credentials:put', badScope, SECRET, BINDING)).resolves.toEqual(BAD_REQUEST)
    await expect(invoke('mqtt-credentials:remove', badScope)).resolves.toEqual(BAD_REQUEST)
    expect(filesUnder(root)).toEqual([join(project, 'project.json')])
  })

  it.each([
    ['a key file path instead of its content', { ...CERT_SECRET, privateKeyPath: '/home/ada/.ssh/id_rsa' }],
    ['a path field', { ...SECRET, path: '/etc/shadow' }],
    ['an unknown method', { method: 'anonymous' }],
    ['a non-string password', { ...SECRET, password: 42 }],
    ['no secret', null],
    ['an oversized field', { ...SECRET, password: 'x'.repeat(65537) }],
  ])('refuses a secret with %s before touching the vault', async (_label, badSecret) => {
    await expect(invoke('mqtt-credentials:put', scope, badSecret, BINDING)).resolves.toEqual(BAD_REQUEST)
    expect(filesUnder(root)).toEqual([join(project, 'project.json')])
    expect(log.warn).toHaveBeenCalledWith('MQTT credential store: event=put result=malformed_request')
  })

  it.each([
    ['port 0', { ...BINDING, port: 0 }],
    ['a string port', { ...BINDING, port: '8883' }],
    ['the anonymous method', { ...BINDING, method: 'anonymous' }],
    ['an extra field', { ...BINDING, caPath: '/etc/ssl/ca.pem' }],
    ['a control character in the host', { ...BINDING, host: 'broker\u0000.local' }],
  ])('refuses a binding with %s', async (_label, badBinding) => {
    await expect(invoke('mqtt-credentials:put', scope, SECRET, badBinding)).resolves.toEqual(BAD_REQUEST)
    expect(filesUnder(root)).toEqual([join(project, 'project.json')])
  })

  it('returns the validation error of a well-formed but invalid secret without echoing it', async () => {
    const reply = await invoke('mqtt-credentials:put', scope, { ...SECRET, password: '' }, BINDING)
    expect(reply).toEqual({
      ok: false,
      code: 'credential_invalid_format',
      message: 'Enter a password.',
      persistence: 'protected',
    })
    expectNoMarkerAnywhere([reply])
  })
})

describe('write-only lifecycle', () => {
  it('stores, reports presence, replaces and removes without ever replying with the secret', async () => {
    const replies: unknown[] = []
    replies.push(await invoke('mqtt-credentials:put', scope, SECRET, BINDING))
    expect(replies[0]).toMatchObject({
      ok: true,
      persistence: 'protected',
      presence: { present: true, usernameSet: true },
    })

    replies.push(await invoke('mqtt-credentials:get-presence', scope))
    expect(replies[1]).toEqual({
      ok: true,
      persistence: 'protected',
      presence: expect.objectContaining({ present: true, method: 'username_password', binding: BINDING }),
    })

    replies.push(await invoke('mqtt-credentials:put', scope, CERT_SECRET, { ...BINDING, method: 'client_certificate' }))
    expect(replies[2]).toMatchObject({ ok: true, presence: { method: 'client_certificate' } })
    await expect(bridge.mqttCredentials.readSecret(scope, BINDING)).resolves.toEqual({
      ok: false,
      reason: 'binding_mismatch',
    })

    replies.push(await invoke('mqtt-credentials:remove', scope))
    expect(replies[3]).toEqual({ ok: true, persistence: 'protected' })
    replies.push(await invoke('mqtt-credentials:get-presence', scope))
    expect(replies[4]).toMatchObject({ ok: true, presence: { present: false } })

    expect(filesUnder(project)).toEqual([join(project, 'project.json')])
    expectNoMarkerAnywhere(replies)
  })

  it('does not answer for another target, project or server', async () => {
    await invoke('mqtt-credentials:put', scope, SECRET, BINDING)

    for (const other of [
      { ...scope, targetKey: 'address:192.168.1.51' },
      { ...scope, projectKey: join(root, 'projects', 'line-2') },
      { ...scope, serverName: 'Other' },
    ]) {
      await expect(invoke('mqtt-credentials:get-presence', other)).resolves.toMatchObject({
        ok: true,
        presence: { present: false },
      })
      await expect(bridge.mqttCredentials.readSecret(other, BINDING)).resolves.toEqual({ ok: false, reason: 'missing' })
    }
    await expect(bridge.mqttCredentials.readSecret(scope, BINDING)).resolves.toEqual({ ok: true, secret: SECRET })
  })

  it('keeps the secret in main-process memory only when safeStorage is unavailable', async () => {
    storage.isEncryptionAvailable.mockReturnValue(false)

    await expect(invoke('mqtt-credentials:put', scope, SECRET, BINDING)).resolves.toMatchObject({
      ok: true,
      persistence: 'session',
    })
    expect(filesUnder(root)).toEqual([join(project, 'project.json')])

    handles.clear()
    createBridge()
    await expect(invoke('mqtt-credentials:get-presence', scope)).resolves.toMatchObject({
      presence: { present: false },
    })
  })

  it('reports a failing store as unavailable instead of throwing across IPC', async () => {
    jest.spyOn(bridge.mqttCredentials, 'getPresence').mockRejectedValueOnce(new Error(PASSWORD))
    jest.spyOn(bridge.mqttCredentials, 'put').mockRejectedValueOnce(new Error(PASSWORD))
    jest.spyOn(bridge.mqttCredentials, 'remove').mockRejectedValueOnce(new Error(PASSWORD))
    const failure = {
      ok: false,
      code: 'credential_store_unavailable',
      message: 'The local credential store could not be used.',
    }

    const replies = [
      await invoke('mqtt-credentials:get-presence', scope),
      await invoke('mqtt-credentials:put', scope, SECRET, BINDING),
      await invoke('mqtt-credentials:remove', scope),
    ]
    expect(replies).toEqual([failure, failure, failure])
    expectNoMarkerAnywhere(replies)
  })
})

describe('project deletion', () => {
  it('forgets the credentials of a project that was deleted', async () => {
    await invoke('mqtt-credentials:put', scope, SECRET, BINDING)
    await invoke('mqtt-credentials:put', { ...scope, projectKey: 'other' }, SECRET, BINDING)

    await bridge.handleDeleteProject(EVENT, project)

    await expect(bridge.mqttCredentials.readSecret(scope, BINDING)).resolves.toEqual({ ok: false, reason: 'missing' })
    await expect(bridge.mqttCredentials.readSecret({ ...scope, projectKey: 'other' }, BINDING)).resolves.toMatchObject({
      ok: true,
    })
  })

  it('keeps them when the deletion failed, and never fails a deletion over cleanup', async () => {
    await invoke('mqtt-credentials:put', scope, SECRET, BINDING)
    deleteProject.mockResolvedValueOnce({ success: false })
    await bridge.handleDeleteProject(EVENT, project)
    await expect(bridge.mqttCredentials.readSecret(scope, BINDING)).resolves.toMatchObject({ ok: true })

    jest.spyOn(bridge.mqttCredentials, 'forgetProject').mockRejectedValueOnce(new Error('disk'))
    await expect(bridge.handleDeleteProject(EVENT, project)).resolves.toEqual({ success: true })
    expect(log.warn).toHaveBeenCalledWith('MQTT credential store: event=forget_project result=failed')
  })
})
