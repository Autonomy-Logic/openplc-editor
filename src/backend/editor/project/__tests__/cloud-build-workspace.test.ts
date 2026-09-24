/**
 * Where a build is allowed to write when the project has no directory.
 *
 * The bug this closes: a cloud project is an Edge id, so `join(projectPath,
 * 'build', …)` produced a relative path and the artifacts landed in
 * `process.cwd()` — the repository root in dev, where the file watcher then
 * reloaded the renderer and dropped the open project mid-build.
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let userData: string

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => userData) },
}))

import {
  clearCloudBuildRoot,
  cloudBuildRoot,
  isCloudBuild,
  resolveBuildWorkspace,
  writeCloudBuildDeviceFiles,
} from '../cloud-build-workspace'

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'openplc-userdata-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('resolveBuildWorkspace', () => {
  it('leaves a project on disk where it is, so local builds stay incremental', () => {
    const local = join(tmpdir(), 'some', 'project')

    expect(resolveBuildWorkspace(local)).toBe(local)
  })

  it('gives a cloud id an absolute directory under userData', () => {
    const resolved = resolveBuildWorkspace('cmu37i2a503br06juf5gim9ub')

    expect(resolved).toBe(join(cloudBuildRoot(), 'cmu37i2a503br06juf5gim9ub'))
    expect(join(resolved, 'build', 'Uno')).not.toBe(join('cmu37i2a503br06juf5gim9ub', 'build', 'Uno'))
  })

  it('never resolves outside the scratch root, whatever the id says', () => {
    for (const hostile of ['../../etc', 'a/b', '..', '.', 'x\\y']) {
      const resolved = resolveBuildWorkspace(hostile)

      expect(resolved.startsWith(cloudBuildRoot() + '/')).toBe(true)
      expect(resolved).not.toContain('..')
    }
  })

  it('gives the same id the same directory every time', () => {
    expect(resolveBuildWorkspace('a/b')).toBe(resolveBuildWorkspace('a/b'))
    expect(resolveBuildWorkspace('a/b')).not.toBe(resolveBuildWorkspace('a/c'))
  })

  it('treats an empty path as a cloud project rather than joining onto nothing', () => {
    expect(resolveBuildWorkspace('').startsWith(cloudBuildRoot())).toBe(true)
  })
})

describe('clearCloudBuildRoot', () => {
  it('removes the builds left by the previous session', async () => {
    const { mkdirSync, existsSync, writeFileSync } = jest.requireActual<typeof import('fs')>('fs')
    const stale = join(cloudBuildRoot(), 'old-project', 'build')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'artifact.hex'), 'x')

    await clearCloudBuildRoot()

    expect(existsSync(cloudBuildRoot())).toBe(false)
  })

  it('is fine when nothing was ever built', async () => {
    await expect(clearCloudBuildRoot()).resolves.toBeUndefined()
  })
})

describe('writeCloudBuildDeviceFiles', () => {
  const files = { configuration: '{"deviceBoard":"ESP32-DOIT DEVKIT V1"}', pinMapping: '{"ESP32-DOIT DEVKIT V1":[]}' }

  it('writes both device files where the compiler reads them for a cloud project', async () => {
    const { readFileSync } = jest.requireActual<typeof import('fs')>('fs')
    const id = 'cmufky1xt03of06oe9747hv68'

    await expect(writeCloudBuildDeviceFiles(id, files)).resolves.toBe(true)

    const devices = join(resolveBuildWorkspace(id), 'devices')
    expect(readFileSync(join(devices, 'configuration.json'), 'utf-8')).toBe(files.configuration)
    expect(readFileSync(join(devices, 'pin-mapping.json'), 'utf-8')).toBe(files.pinMapping)
  })

  it('never touches a local project, even when handed device files', async () => {
    const { existsSync, mkdtempSync: makeTemp } = jest.requireActual<typeof import('fs')>('fs')
    const local = makeTemp(join(tmpdir(), 'openplc-local-project-'))

    try {
      await expect(writeCloudBuildDeviceFiles(local, files)).resolves.toBe(false)
      expect(existsSync(join(local, 'devices'))).toBe(false)
      expect(existsSync(cloudBuildRoot())).toBe(false)
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })
})

describe('isCloudBuild', () => {
  it('matches the workspace resolveBuildWorkspace picks', () => {
    expect(isCloudBuild('cmufky1xt03of06oe9747hv68')).toBe(true)
    expect(isCloudBuild('')).toBe(true)
    expect(isCloudBuild(join(tmpdir(), 'some', 'project'))).toBe(false)
  })
})
