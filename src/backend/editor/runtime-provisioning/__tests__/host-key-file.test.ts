/** @jest-environment node */

import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createHostKeyFileMechanism } from '../host-key-file'
import { temporaryFolder } from './fixtures/local-servers'

const FILE_NAME = 'ssh-known-hosts.json'
const REMEMBERED =
  '{\n  "version": 1,\n  "hosts": [\n    {\n      "host": "192.0.2.10",\n      "port": 22,\n      "keyType": "ssh-ed25519",\n      "key": "AAAAC3NzaC1lZDI1NTE5AAAAIKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",\n      "firstSeen": "2026-11-05T12:00:00.000Z"\n    }\n  ]\n}\n'
const NEXT = '{\n  "version": 1,\n  "hosts": []\n}\n'
const POSIX_NON_ROOT = process.platform !== 'win32' && process.getuid?.() !== 0
const itOnPosixAsUser = POSIX_NON_ROOT ? it : it.skip

const folders: string[] = []
const lockedFolders: string[] = []

function userData(): string {
  const folder = temporaryFolder('provisioning-host-keys-')
  folders.push(folder)
  return folder
}

function lock(folder: string, mode: number): void {
  chmodSync(folder, mode)
  lockedFolders.push(folder)
}

afterEach(() => {
  lockedFolders.splice(0).forEach((folder) => chmodSync(folder, 0o700))
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }))
})

describe('reading the host-key file (TC53)', () => {
  it('reports an absent file as absent', async () => {
    const file = path.join(userData(), FILE_NAME)

    await expect(createHostKeyFileMechanism(file).read()).resolves.toEqual({ kind: 'absent' })
  })

  it('returns a 0-byte file as empty text', async () => {
    const file = path.join(userData(), FILE_NAME)
    writeFileSync(file, '')

    await expect(createHostKeyFileMechanism(file).read()).resolves.toEqual({ kind: 'text', text: '' })
  })

  it('returns content that is not valid verbatim', async () => {
    const file = path.join(userData(), FILE_NAME)
    writeFileSync(file, 'not json {\n')

    await expect(createHostKeyFileMechanism(file).read()).resolves.toEqual({ kind: 'text', text: 'not json {\n' })
  })

  it('returns a valid file verbatim', async () => {
    const file = path.join(userData(), FILE_NAME)
    writeFileSync(file, REMEMBERED)

    await expect(createHostKeyFileMechanism(file).read()).resolves.toEqual({ kind: 'text', text: REMEMBERED })
  })

  itOnPosixAsUser('reports a file the editor cannot read as an error', async () => {
    const file = path.join(userData(), FILE_NAME)
    writeFileSync(file, REMEMBERED)
    chmodSync(file, 0o000)

    await expect(createHostKeyFileMechanism(file).read()).resolves.toEqual({
      kind: 'error',
      message: expect.any(String),
    })
  })

  it('reports a directory in place of the file as an error, not as absent', async () => {
    const file = path.join(userData(), FILE_NAME)
    mkdirSync(file)

    await expect(createHostKeyFileMechanism(file).read()).resolves.toEqual({
      kind: 'error',
      message: expect.any(String),
    })
  })
})

describe('replacing the host-key file (M4, D3)', () => {
  it('creates the file with the text exactly, leaving no other file behind', async () => {
    const folder = userData()
    const file = path.join(folder, FILE_NAME)

    await createHostKeyFileMechanism(file).replace(REMEMBERED)

    expect(readFileSync(file, 'utf8')).toBe(REMEMBERED)
    expect(readdirSync(folder)).toEqual([FILE_NAME])
  })

  it('replaces an existing file, leaving no other file behind', async () => {
    const folder = userData()
    const file = path.join(folder, FILE_NAME)
    writeFileSync(file, REMEMBERED)

    await createHostKeyFileMechanism(file).replace(NEXT)

    expect(readFileSync(file, 'utf8')).toBe(NEXT)
    expect(readdirSync(folder)).toEqual([FILE_NAME])
  })

  it('reads back what it wrote', async () => {
    const file = path.join(userData(), FILE_NAME)
    const mechanism = createHostKeyFileMechanism(file)

    await mechanism.replace(REMEMBERED)

    await expect(mechanism.read()).resolves.toEqual({ kind: 'text', text: REMEMBERED })
  })

  itOnPosixAsUser('leaves the file readable and writable by the owner only (0600)', async () => {
    const file = path.join(userData(), FILE_NAME)

    await createHostKeyFileMechanism(file).replace(REMEMBERED)

    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('rejects when the rename fails, keeping what was at the path and leaving no temporary file (AS-18)', async () => {
    const folder = userData()
    const file = path.join(folder, FILE_NAME)
    mkdirSync(file)
    writeFileSync(path.join(file, 'keep'), 'kept')

    await expect(createHostKeyFileMechanism(file).replace(NEXT)).rejects.toThrow()

    expect(readdirSync(folder)).toEqual([FILE_NAME])
    expect(readdirSync(file)).toEqual(['keep'])
    expect(readFileSync(path.join(file, 'keep'), 'utf8')).toBe('kept')
  })

  itOnPosixAsUser('rejects when the folder cannot be written, keeping the old file intact (AS-18)', async () => {
    const folder = userData()
    const file = path.join(folder, FILE_NAME)
    writeFileSync(file, REMEMBERED)
    lock(folder, 0o500)

    await expect(createHostKeyFileMechanism(file).replace(NEXT)).rejects.toThrow()

    expect(readFileSync(file, 'utf8')).toBe(REMEMBERED)
    expect(readdirSync(folder)).toEqual([FILE_NAME])
  })
})
