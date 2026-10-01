/**
 * Where a cloud project's local-only files land.
 *
 * The bug this closes: the EtherCAT ESI repository joined straight onto the
 * project path, which for a cloud project is an Edge id — so uploading an ESI
 * file wrote `<cwd>/<id>/devices/esi/` into the repository root in dev, and into
 * whatever directory the packaged app was launched from.
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { isAbsolute, join } from 'path'

let userData: string

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => userData) },
}))

import { cloudProjectDataRoot, resolveProjectDataDir } from '../cloud-project-data'

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'openplc-userdata-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('resolveProjectDataDir', () => {
  it('leaves a project on disk alone, so its files stay where the user can see them', () => {
    const local = join(tmpdir(), 'some', 'project')

    expect(resolveProjectDataDir(local)).toBe(local)
  })

  it('gives a cloud id an absolute directory under userData', () => {
    const resolved = resolveProjectDataDir('cmu37i2a503br06juf5gim9ub')

    expect(resolved).toBe(join(cloudProjectDataRoot(), 'cmu37i2a503br06juf5gim9ub'))
    expect(isAbsolute(resolved)).toBe(true)
  })

  it('never resolves outside the root, whatever the id says', () => {
    for (const hostile of ['../../etc', 'a/b', '..', '.', 'x\\y']) {
      const resolved = resolveProjectDataDir(hostile)

      expect(resolved.startsWith(cloudProjectDataRoot() + '/')).toBe(true)
      expect(resolved).not.toContain('..')
    }
  })

  it('is stable for the same id and distinct between ids', () => {
    expect(resolveProjectDataDir('a/b')).toBe(resolveProjectDataDir('a/b'))
    expect(resolveProjectDataDir('a/b')).not.toBe(resolveProjectDataDir('a/c'))
  })

  it('keeps cloud data apart from the build scratch, which is wiped at boot', () => {
    expect(cloudProjectDataRoot()).not.toBe(join(userData, 'cloud-builds'))
    expect(cloudProjectDataRoot()).toBe(join(userData, 'cloud-projects'))
  })
})
