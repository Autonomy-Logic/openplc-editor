import { safeStorage } from 'electron'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'

import type {
  MqttCredentialBinding,
  MqttCredentialScope,
  MqttCredentialSecret,
} from '../../../../middleware/shared/ports/mqtt-credential-port'
import { logger } from '../../services'
import {
  createElectronMqttCredentialVault,
  createMqttCredentialFileStorage,
  MQTT_CREDENTIAL_VAULT_MAX_BYTES,
  mqttCredentialVaultPath,
  safeStorageMqttCipher,
} from '../electron-vault'

jest.mock('electron', () => {
  const crypto = jest.requireActual<typeof import('crypto')>('crypto')
  const key = Uint8Array.from(crypto.randomBytes(32))
  return {
    app: { getPath: jest.fn(() => '/nonexistent') },
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

jest.mock('../../../../main/modules/store', () => ({
  store: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}))

jest.mock('../../services', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))

const storage = jest.mocked(safeStorage)
const log = jest.mocked(logger)

const PASSWORD = 'MARKER-PW-e4-electron-41b0'
const USERNAME = 'MARKER-USER-e4-electron-c7d2'
const KEY_BODY = 'MARKERKEYBODYe4electron88e1'
const PASSPHRASE = 'MARKER-PASS-e4-electron-0f3c'
const MARKERS = [PASSWORD, USERNAME, KEY_BODY, PASSPHRASE]

const PASSWORD_SECRET: MqttCredentialSecret = { method: 'username_password', username: USERNAME, password: PASSWORD }
const CERT_SECRET: MqttCredentialSecret = {
  method: 'client_certificate',
  certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBcert\n-----END CERTIFICATE-----\n',
  privateKeyPem: `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${KEY_BODY}\n-----END ENCRYPTED PRIVATE KEY-----\n`,
  privateKeyPassphrase: PASSPHRASE,
}
const BINDING: MqttCredentialBinding = {
  host: 'broker.plant.local',
  port: 8883,
  tlsEnabled: true,
  clientId: 'line-1',
  method: 'username_password',
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const pretendPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })

let root: string
let userData: string
let project: string
let scope: MqttCredentialScope

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return lstatSync(full).isDirectory() ? filesUnder(full) : [full]
  })

const expectNoMarkerOnDisk = () => {
  for (const file of filesUnder(root)) {
    const content = readFileSync(file)
    for (const marker of MARKERS) {
      expect({ file, plain: content.includes(marker) }).toEqual({ file, plain: false })
      expect(content.includes(Buffer.from(marker).toString('base64'))).toBe(false)
    }
  }
}

const loggedText = () =>
  [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].map((call) => String(call[0])).join('\n')

beforeEach(() => {
  jest.clearAllMocks()
  pretendPlatform('darwin')
  storage.isEncryptionAvailable.mockReturnValue(true)
  storage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
  root = mkdtempSync(join(tmpdir(), 'openplc-e4-vault-'))
  userData = join(root, 'userdata')
  project = join(root, 'projects', 'line-1')
  mkdirSync(join(project, 'devices', 'servers'), { recursive: true })
  writeFileSync(join(project, 'project.json'), '{}')
  scope = { projectKey: project, targetKey: 'address:192.168.1.50', serverName: 'Telemetry' }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

afterAll(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
})

describe('safeStorage protection rule', () => {
  it('is protected when the OS encrypts', () => {
    expect(safeStorageMqttCipher.canEncrypt()).toBe(true)
    expect(createElectronMqttCredentialVault(userData).persistence()).toBe('protected')
  })

  it('is session-only when safeStorage is unavailable', () => {
    storage.isEncryptionAvailable.mockReturnValue(false)
    expect(createElectronMqttCredentialVault(userData).persistence()).toBe('session')
  })

  it('refuses the Linux basic_text backend and accepts a real keyring', () => {
    pretendPlatform('linux')
    storage.getSelectedStorageBackend.mockReturnValue('basic_text')
    expect(createElectronMqttCredentialVault(userData).persistence()).toBe('session')
    storage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
    expect(createElectronMqttCredentialVault(userData).persistence()).toBe('protected')
  })
})

describe('vault on disk', () => {
  it('writes one owner-only file under userData, outside the project, with no secret in it', async () => {
    const vault = createElectronMqttCredentialVault(userData)
    await vault.put(scope, PASSWORD_SECRET, BINDING)
    await vault.put({ ...scope, serverName: 'Cert' }, CERT_SECRET, { ...BINDING, method: 'client_certificate' })

    const file = mqttCredentialVaultPath(userData)
    expect(relative(userData, file)).toBe(join('mqtt-credentials', 'credentials.json'))
    expect(relative(project, file).startsWith('..')).toBe(true)
    expect(filesUnder(project)).toEqual([join(project, 'project.json')])
    expect(readdirSync(join(userData, 'mqtt-credentials'))).toEqual(['credentials.json'])
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(statSync(join(userData, 'mqtt-credentials')).mode & 0o777).toBe(0o700)
    }
    expectNoMarkerOnDisk()
    expect(loggedText()).not.toContain(PASSWORD)

    const restarted = createElectronMqttCredentialVault(userData)
    expect(await restarted.readSecret(scope, BINDING)).toEqual({ ok: true, secret: PASSWORD_SECRET })
  })

  it('writes nothing at all when the OS cannot encrypt', async () => {
    pretendPlatform('linux')
    storage.getSelectedStorageBackend.mockReturnValue('basic_text')
    const vault = createElectronMqttCredentialVault(userData)

    expect(await vault.put(scope, PASSWORD_SECRET, BINDING)).toMatchObject({ ok: true })
    expect(await vault.getPresence(scope)).toMatchObject({ present: true })
    expect(storage.encryptString).not.toHaveBeenCalled()
    expect(filesUnder(root)).toEqual([join(project, 'project.json')])
    expect(await createElectronMqttCredentialVault(userData).getPresence(scope)).toEqual({ present: false })
  })

  it('removes the sealed entry on removal and leaves no temporary file behind', async () => {
    const vault = createElectronMqttCredentialVault(userData)
    await vault.put(scope, PASSWORD_SECRET, BINDING)
    await vault.put(scope, { ...PASSWORD_SECRET, password: `${PASSWORD}-2` }, BINDING)
    await vault.remove(scope)

    const document: { entries: unknown[] } = JSON.parse(readFileSync(mqttCredentialVaultPath(userData), 'utf-8'))
    expect(document.entries).toEqual([])
    expect(readdirSync(join(userData, 'mqtt-credentials'))).toEqual(['credentials.json'])
    expectNoMarkerOnDisk()
  })
})

describe('file storage', () => {
  it('reads null for a missing file and the content after a write', async () => {
    const file = createMqttCredentialFileStorage(userData)
    expect(await file.read()).toBeNull()
    await file.write('{"a":1}\n')
    expect(await file.read()).toBe('{"a":1}\n')
  })

  it('refuses an oversized file before reading it', async () => {
    mkdirSync(join(userData, 'mqtt-credentials'), { recursive: true })
    writeFileSync(mqttCredentialVaultPath(userData), ' '.repeat(MQTT_CREDENTIAL_VAULT_MAX_BYTES + 1))
    // Mapped to a short outcome: on failure, a diff of the 4 MiB content would stall the reporter.
    const outcome = await createMqttCredentialFileStorage(userData)
      .read()
      .then(
        (content) => `read ${content?.length ?? 0} chars`,
        (error: unknown) => String(error),
      )
    expect(outcome).toBe('Error: vault file too large')
  })

  it('surfaces an unreadable path and cleans its temporary file when the swap fails', async () => {
    mkdirSync(mqttCredentialVaultPath(userData), { recursive: true })
    writeFileSync(join(mqttCredentialVaultPath(userData), 'blocker'), 'x')
    const file = createMqttCredentialFileStorage(userData)

    await expect(file.read()).rejects.toThrow()
    await expect(file.write('{}')).rejects.toThrow()
    expect(readdirSync(join(userData, 'mqtt-credentials'))).toEqual(['credentials.json'])
  })

  it('treats a vault file it cannot open as empty and reports it without secrets', async () => {
    mkdirSync(mqttCredentialVaultPath(userData), { recursive: true })
    const vault = createElectronMqttCredentialVault(userData)
    expect(await vault.getPresence(scope)).toEqual({ present: false })
    expect(log.warn).toHaveBeenCalledWith('MQTT credential store: event=read result=unreadable')
  })
})
