/** @jest-environment node */

import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { RuntimeProvisioningRunRequest } from '../../../../middleware/shared/ports/runtime-provisioning-port'
import type { HostKeyEntry } from '../../../shared/runtime-provisioning/host-key-file'
import { parseHostKeyFile, serializeHostKeyFile } from '../../../shared/runtime-provisioning/host-key-file'
import type { RuntimeProvisioningService } from '../../../shared/runtime-provisioning/service'
import { createRuntimeProvisioningService } from '../../../shared/runtime-provisioning/service'
import { createFakeDevice } from '../../../shared/runtime-provisioning/__tests__/fixtures/in-memory-mechanisms'
import { createHostKeyFileMechanism } from '../host-key-file'
import { createSshSessionMechanism } from '../ssh-session'
import type { HostKeyPair, SshServerBehaviour, TestSshServer } from './fixtures/local-servers'
import {
  ecdsaHostKey,
  ed25519HostKey,
  LOOPBACK,
  publicKeyOnly,
  SERVER_PASSWORD,
  SERVER_USERNAME,
  startSshServer,
  temporaryFolder,
} from './fixtures/local-servers'

const FILE_NAME = 'ssh-known-hosts.json'
const POSIX_NON_ROOT = process.platform !== 'win32' && process.getuid?.() !== 0
const itOnPosixAsUser = POSIX_NON_ROOT ? it : it.skip

const servers: TestSshServer[] = []
const folders: string[] = []
const lockedFolders: string[] = []

interface Desk {
  folder: string
  file: string
  service: RuntimeProvisioningService
}

async function serve(behaviour: SshServerBehaviour = {}): Promise<TestSshServer> {
  const server = await startSshServer(behaviour)
  servers.push(server)
  return server
}

function desk(): Desk {
  const folder = temporaryFolder('provisioning-user-data-')
  folders.push(folder)
  const file = path.join(folder, FILE_NAME)
  const device = createFakeDevice()
  const service = createRuntimeProvisioningService({
    ...device.mechanisms,
    sshSession: createSshSessionMechanism(),
    hostKeyFile: createHostKeyFileMechanism(file),
  })
  return { folder, file, service }
}

function runRequest(port: number, password = SERVER_PASSWORD): RuntimeProvisioningRunRequest {
  return { host: LOOPBACK, port, username: SERVER_USERNAME, password }
}

function remember(file: string, port: number, key: HostKeyPair): Buffer {
  const entry: HostKeyEntry = {
    host: LOOPBACK,
    port,
    keyType: key.keyType,
    key: key.publicBlob,
    firstSeen: '2026-11-05T12:00:00.000Z',
  }
  writeFileSync(file, serializeHostKeyFile([entry]))
  return readFileSync(file)
}

function entriesIn(file: string): HostKeyEntry[] {
  const state = parseHostKeyFile({ kind: 'text', text: readFileSync(file, 'utf8') })
  return state.kind === 'valid' ? state.entries : []
}

afterEach(async () => {
  lockedFolders.splice(0).forEach((folder) => chmodSync(folder, 0o700))
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }))
})

describe('host keys through the real SSH session and host-key file mechanisms', () => {
  it('trusts the first key, saving it before the password is sent, and the login proceeds (TC25, AC08.1)', async () => {
    const { file, service } = desk()
    const atPassword: HostKeyEntry[][] = []
    const server = await serve({
      beforeAuthentication: (attempt) => {
        if (attempt.method === 'password') atPassword.push(existsSync(file) ? entriesIn(file) : [])
      },
    })

    await service.run(runRequest(server.port))

    expect(atPassword).toEqual([
      [
        expect.objectContaining({
          host: LOOPBACK,
          port: server.port,
          keyType: 'ssh-ed25519',
          key: server.hostKey.publicBlob,
        }),
      ],
    ])
    expect(server.authAttempts.map((attempt) => attempt.method)).toEqual(['none', 'password'])
    expect(server.commands).toHaveLength(1)
    expect(entriesIn(file)).toHaveLength(1)
  })

  it('stops on a changed key before any authentication, naming the target and keeping the file (AS-01, AC08.2)', async () => {
    const { folder, file, service } = desk()
    const server = await serve()
    const before = remember(file, server.port, ed25519HostKey())

    await expect(service.run(runRequest(server.port))).resolves.toEqual({
      kind: 'host-key-changed',
      target: `${LOOPBACK}:${server.port}`,
    })
    expect(server.authAttempts).toEqual([])
    expect(server.commands).toEqual([])
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(folder)).toEqual([FILE_NAME])
  })

  it('stops on an ECDSA key where an Ed25519 key is remembered, adding no second key (AS-02)', async () => {
    const { folder, file, service } = desk()
    const server = await serve({ hostKey: ecdsaHostKey() })
    const before = remember(file, server.port, ed25519HostKey())

    await expect(service.run(runRequest(server.port))).resolves.toEqual({
      kind: 'host-key-changed',
      target: `${LOOPBACK}:${server.port}`,
    })
    expect(server.authAttempts).toEqual([])
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(folder)).toEqual([FILE_NAME])
  })

  it('proceeds with the remembered key and leaves the file byte for byte unchanged', async () => {
    const { file, service } = desk()
    const server = await serve()
    const before = remember(file, server.port, server.hostKey)

    await service.run(runRequest(server.port))

    expect(server.authAttempts.map((attempt) => attempt.method)).toEqual(['none', 'password'])
    expect(readFileSync(file)).toEqual(before)
  })

  itOnPosixAsUser(
    'stops a first contact whose key cannot be saved, then still stops on a changed key with the old file (AS-18)',
    async () => {
      const { folder, file, service } = desk()
      const unknown = await serve()
      const changed = await serve()
      const before = remember(file, changed.port, ed25519HostKey())
      chmodSync(folder, 0o500)
      lockedFolders.push(folder)

      await expect(service.run(runRequest(unknown.port))).resolves.toEqual({ kind: 'host-key-not-saved' })
      expect(unknown.authAttempts).toEqual([])
      expect(readFileSync(file)).toEqual(before)
      expect(readdirSync(folder)).toEqual([FILE_NAME])

      await expect(service.run(runRequest(changed.port))).resolves.toEqual({
        kind: 'host-key-changed',
        target: `${LOOPBACK}:${changed.port}`,
      })
      expect(changed.authAttempts).toEqual([])
      expect(readFileSync(file)).toEqual(before)
    },
  )

  it('stops on an empty host-key file with no SSH connection (AC12.1)', async () => {
    const { file, service } = desk()
    const server = await serve()
    writeFileSync(file, '')

    await expect(service.run(runRequest(server.port))).resolves.toEqual({ kind: 'host-key-file-unusable' })
    expect(server.connectionCount()).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('')
  })
})

describe('authentication through the real SSH session mechanism', () => {
  it('reports a server that accepts only public keys, never sending the password (TC57)', async () => {
    const { service } = desk()
    const server = await serve({ authenticate: publicKeyOnly })

    await expect(service.run(runRequest(server.port))).resolves.toEqual({ kind: 'password-auth-not-accepted' })
    expect(server.authAttempts).toEqual([{ method: 'none', username: SERVER_USERNAME }])
    expect(server.commands).toEqual([])
  })

  it('reports a rejected password after exactly one password attempt, running no command (TC30)', async () => {
    const { service } = desk()
    const server = await serve()

    await expect(service.run(runRequest(server.port, 'wrong-pass'))).resolves.toEqual({ kind: 'auth-rejected' })
    expect(server.authAttempts.filter((attempt) => attempt.method === 'password')).toEqual([
      { method: 'password', username: SERVER_USERNAME, password: 'wrong-pass' },
    ])
    expect(server.commands).toEqual([])
  })
})
