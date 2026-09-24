import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let userData: string

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => userData) },
}))

import { resolveBuildWorkspace } from '../cloud-build-workspace'
import {
  applyCloudFileSave,
  applyCloudProjectSave,
  beginCloudProjectRead,
  type CloudProjectFiles,
  materializeCloudProject,
} from '../cloud-working-copy'

const ID = 'cmufky1xt03of06oe9747hv68'

const project = (overrides: Partial<CloudProjectFiles> = {}): CloudProjectFiles => ({
  projectPath: ID,
  projectJson: '{"meta":{"name":"semaphore","type":"plc-project"}}',
  deviceConfig: '{"deviceBoard":"ESP32-DOIT DEVKIT V1"}',
  pinMapping: '{"ESP32-DOIT DEVKIT V1":[{"pin":"05","address":"%IX0.0"}]}',
  libraryManifest: '',
  pouFiles: [{ relativePath: 'pous/programs/main.ld', content: 'PROGRAM main' }],
  serverFiles: [{ relativePath: 'devices/servers/modbus.json', content: '{}' }],
  remoteDeviceFiles: [{ relativePath: 'devices/remote/io.json', content: '{}' }],
  dataTypeFiles: [{ relativePath: 'datatypes/TANK.dt', content: 'TYPE TANK' }],
  ...overrides,
})

const copy = () => resolveBuildWorkspace(ID)
const read = (relativePath: string) => readFileSync(join(copy(), relativePath), 'utf-8')

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'openplc-userdata-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('materializeCloudProject', () => {
  it('lays the project out like a local one, device files included', async () => {
    await materializeCloudProject(project())

    expect(read('project.json')).toBe(project().projectJson)
    expect(read('devices/configuration.json')).toBe(project().deviceConfig)
    expect(read('devices/pin-mapping.json')).toBe(project().pinMapping)
    expect(read('pous/programs/main.ld')).toBe('PROGRAM main')
    expect(read('devices/servers/modbus.json')).toBe('{}')
    expect(read('devices/remote/io.json')).toBe('{}')
    expect(read('datatypes/TANK.dt')).toBe('TYPE TANK')
    expect(existsSync(join(copy(), 'library.json'))).toBe(false)
  })

  it('drops files Edge no longer has, but keeps the build output', async () => {
    await materializeCloudProject(project())
    mkdirSync(join(copy(), 'build', 'ESP32'), { recursive: true })
    writeFileSync(join(copy(), 'build', 'ESP32', 'defines.h'), 'x')

    await materializeCloudProject(project({ pouFiles: [{ relativePath: 'pous/programs/other.st', content: 'y' }] }))

    expect(existsSync(join(copy(), 'pous/programs/main.ld'))).toBe(false)
    expect(read('pous/programs/other.st')).toBe('y')
    expect(read('build/ESP32/defines.h')).toBe('x')
  })

  it('refuses a path that escapes the copy and leaves the previous copy intact', async () => {
    await materializeCloudProject(project())

    await expect(
      materializeCloudProject(project({ pouFiles: [{ relativePath: '../../escaped.st', content: 'x' }] })),
    ).rejects.toThrow(/outside its place in the working copy/)

    expect(read('pous/programs/main.ld')).toBe('PROGRAM main')
    expect(existsSync(join(copy(), '..', '..', 'escaped.st'))).toBe(false)
  })

  it('refuses a path that stays inside the copy but leaves its own folder', async () => {
    await expect(
      materializeCloudProject(
        project({ remoteDeviceFiles: [{ relativePath: 'devices/remote/../pin-mapping.json', content: '[]' }] }),
      ),
    ).rejects.toThrow(/outside its place/)
  })

  it('keeps the previous copy when writing the new one fails', async () => {
    await materializeCloudProject(project())

    // Passes validation, then fails on disk: `pous/programs/main.ld` cannot be both a file and a folder.
    const broken = project({
      pouFiles: [
        { relativePath: 'pous/programs/main.ld', content: 'new' },
        { relativePath: 'pous/programs/main.ld/inner.st', content: 'x' },
      ],
    })
    await expect(materializeCloudProject(broken)).rejects.toThrow()

    expect(read('pous/programs/main.ld')).toBe('PROGRAM main')
    expect(read('devices/pin-mapping.json')).toBe(project().pinMapping)
    expect(readdirSync(join(copy(), '..')).filter((name) => name.includes('.staging-'))).toEqual([])
  })

  it('drops a read that started before a save it would overwrite', async () => {
    await materializeCloudProject(project())
    const staleRead = beginCloudProjectRead()
    await applyCloudFileSave(ID, 'devices/pin-mapping.json', 'saved')

    await expect(materializeCloudProject(project(), staleRead)).resolves.toBe(false)
    expect(read('devices/pin-mapping.json')).toBe('saved')

    await expect(materializeCloudProject(project(), beginCloudProjectRead())).resolves.toBe(true)
    expect(read('devices/pin-mapping.json')).toBe(project().pinMapping)
  })

  it('runs a save that arrives mid-refresh after the refresh, not inside it', async () => {
    const refresh = materializeCloudProject(project())
    const save = applyCloudFileSave(ID, 'pous/programs/main.ld', 'PROGRAM main (saved)')

    await Promise.all([refresh, save])

    expect(read('pous/programs/main.ld')).toBe('PROGRAM main (saved)')
  })

  it('refuses a local project path, so it can never clear the user project', async () => {
    const local = mkdtempSync(join(tmpdir(), 'openplc-local-project-'))
    writeFileSync(join(local, 'project.json'), 'mine')

    try {
      await expect(materializeCloudProject(project({ projectPath: local }))).rejects.toThrow(/Not a cloud project/)
      expect(readdirSync(local)).toEqual(['project.json'])
      expect(readFileSync(join(local, 'project.json'), 'utf-8')).toBe('mine')
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })
})

describe('applyCloudProjectSave', () => {
  const save = (overrides: Record<string, unknown> = {}) => ({
    projectPath: ID,
    projectJson: '{"meta":{"name":"semaphore","type":"plc-project"}}',
    deviceConfig: '{"deviceBoard":"ESP32-DOIT DEVKIT V1"}',
    pinMapping: '{"ESP32-DOIT DEVKIT V1":[{"pin":"12","address":"%QX0.0"}]}',
    pouFiles: [{ relativePath: 'pous/programs/main.ld', content: 'PROGRAM main (edited)' }],
    serverFiles: [],
    remoteDeviceFiles: [],
    dataTypeFiles: [],
    deletions: ['datatypes/TANK.dt'],
    ...overrides,
  })

  it('writes what was saved and removes what was deleted', async () => {
    await materializeCloudProject(project())

    await applyCloudProjectSave(save())

    expect(read('pous/programs/main.ld')).toBe('PROGRAM main (edited)')
    expect(read('devices/pin-mapping.json')).toBe(save().pinMapping)
    expect(existsSync(join(copy(), 'datatypes/TANK.dt'))).toBe(false)
  })

  it('refuses a deletion outside the copy before writing anything', async () => {
    await materializeCloudProject(project())

    await expect(applyCloudProjectSave(save({ deletions: ['../../../victim'] }))).rejects.toThrow(
      /outside its place in the working copy/,
    )
    expect(read('pous/programs/main.ld')).toBe('PROGRAM main')
  })

  it('checks every write before the first one, so a bad path leaves the copy untouched', async () => {
    await materializeCloudProject(project())

    await expect(
      applyCloudProjectSave(
        save({
          deletions: [],
          dataTypeFiles: [{ relativePath: 'datatypes/../../escaped.dt', content: 'x' }],
        }),
      ),
    ).rejects.toThrow(/outside its place/)

    expect(read('pous/programs/main.ld')).toBe('PROGRAM main')
    expect(read('devices/pin-mapping.json')).toBe(project().pinMapping)
  })

  it('refuses a local project path', async () => {
    await expect(applyCloudProjectSave(save({ projectPath: join(tmpdir(), 'local') }))).rejects.toThrow(
      /Not a cloud project/,
    )
  })
})

describe('applyCloudFileSave', () => {
  it('writes the one file that was saved', async () => {
    await materializeCloudProject(project())

    await applyCloudFileSave(ID, 'devices/pin-mapping.json', '{"ESP32-DOIT DEVKIT V1":[]}')

    expect(read('devices/pin-mapping.json')).toBe('{"ESP32-DOIT DEVKIT V1":[]}')
    expect(read('pous/programs/main.ld')).toBe('PROGRAM main')
  })

  it('refuses a path that escapes the copy', async () => {
    await expect(applyCloudFileSave(ID, '../outside.json', '{}')).rejects.toThrow(
      /outside its place in the working copy/,
    )
  })
})
