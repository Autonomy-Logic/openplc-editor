/** @jest-environment node */

import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import type {
  RawServer,
  TestSshServer,
} from '../../../../backend/editor/runtime-provisioning/__tests__/fixtures/local-servers'
import {
  LOOPBACK,
  OPENSSH_GREETING,
  publicKeyOnly,
  receivedByteCount,
  SERVER_PASSWORD,
  SERVER_USERNAME,
  startRawServer,
  startSshServer,
  temporaryFolder,
} from '../../../../backend/editor/runtime-provisioning/__tests__/fixtures/local-servers'
import { logger } from '../../../../backend/editor/services/logger-service'
import { parseHostKeyFile } from '../../../../backend/shared/runtime-provisioning/host-key-file'
import { createDesktopRuntimeProvisioningService } from '../index'

jest.mock('electron', () => {
  const fs = jest.requireActual<typeof import('node:fs')>('node:fs')
  const os = jest.requireActual<typeof import('node:os')>('node:os')
  const nodePath = jest.requireActual<typeof import('node:path')>('node:path')
  const userData = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'provisioning-electron-'))
  return { app: { getPath: () => userData } }
})

const folders: string[] = []
const sshServers: TestSshServer[] = []
const rawServers: RawServer[] = []

function userData(): string {
  const folder = temporaryFolder('provisioning-desktop-')
  folders.push(folder)
  return folder
}

afterEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(sshServers.splice(0).map((server) => server.stop()))
  await Promise.all(rawServers.splice(0).map((server) => server.stop()))
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }))
})

describe('the desktop runtime provisioning service', () => {
  it('probes with a banner read that sends no byte to the SSH port', async () => {
    const server = await startRawServer((socket) => socket.write(OPENSSH_GREETING))
    rawServers.push(server)
    const service = createDesktopRuntimeProvisioningService(userData())

    await expect(service.probeSsh({ host: LOOPBACK, port: server.port })).resolves.toEqual({ answered: true })

    const connection = await server.firstConnection()
    await connection.closed
    expect(receivedByteCount(connection)).toBe(0)
  })

  it('remembers the host key in ssh-known-hosts.json under the user data folder', async () => {
    const folder = userData()
    const server = await startSshServer({ authenticate: publicKeyOnly })
    sshServers.push(server)
    const service = createDesktopRuntimeProvisioningService(folder)

    await service.run({ host: LOOPBACK, port: server.port, username: SERVER_USERNAME, password: SERVER_PASSWORD })

    const saved = parseHostKeyFile({
      kind: 'text',
      text: readFileSync(path.join(folder, 'ssh-known-hosts.json'), 'utf8'),
    })
    expect(saved.kind === 'valid' ? saved.entries : []).toEqual([
      expect.objectContaining({ host: LOOPBACK, port: server.port, key: server.hostKey.publicBlob }),
    ])
  })

  it('writes the audit line to the Winston log exactly as the service formatted it, and nothing with the password (M13)', async () => {
    const logged: unknown[][] = []
    jest.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args)
      return logger
    })
    const server = await startSshServer({ authenticate: publicKeyOnly })
    sshServers.push(server)
    const service = createDesktopRuntimeProvisioningService(userData())
    const auditLines: string[] = []
    service.onEvent((event) => {
      if (event.type === 'audit') auditLines.push(event.line)
    })

    await expect(
      service.run({ host: LOOPBACK, port: server.port, username: SERVER_USERNAME, password: SERVER_PASSWORD }),
    ).resolves.toEqual({ kind: 'password-auth-not-accepted' })

    expect(auditLines).toHaveLength(1)
    expect(logged).toEqual([[auditLines[0]]])
    expect(JSON.stringify(logged)).not.toContain(SERVER_PASSWORD)
  })
})
