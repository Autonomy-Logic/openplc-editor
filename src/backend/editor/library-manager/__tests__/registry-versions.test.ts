import { REGISTRY_FORMAT_VERSION, migrateRegistry, resolveVersion, versionsNewestFirst } from '../registry-versions'
import type { LibraryVersionEntry } from '../types'

const entry = (stlibPath: string): LibraryVersionEntry => ({
  installedAt: '2026-01-01T00:00:00.000Z',
  stlibPath,
  origin: 'stlib',
})

describe('migrateRegistry', () => {
  it('lifts a v1 row into a versions map without moving the file', () => {
    const migrated = migrateRegistry({
      formatVersion: '1.0',
      libraries: {
        'node-uio': {
          version: '0.0.1',
          installedAt: '2026-09-08T04:18:21.694Z',
          stlibPath: '/libs/node-uio/node-uio.stlib',
          origin: 'stlib',
        },
      },
    })

    expect(migrated.formatVersion).toBe(REGISTRY_FORMAT_VERSION)
    expect(migrated.libraries['node-uio'].versions).toEqual({
      '0.0.1': {
        installedAt: '2026-09-08T04:18:21.694Z',
        // The path it already had: migration touches no files.
        stlibPath: '/libs/node-uio/node-uio.stlib',
        origin: 'stlib',
      },
    })
  })

  it('passes a v2 registry through unchanged', () => {
    const v2 = { formatVersion: '2.0', libraries: { foo: { versions: { '1.0.0': entry('/libs/a') } } } }
    expect(migrateRegistry(v2).libraries.foo.versions['1.0.0']).toEqual(entry('/libs/a'))
  })

  it('drops rows that are neither shape rather than throwing', () => {
    const migrated = migrateRegistry({
      formatVersion: '1.0',
      libraries: { good: { version: '1.0.0', installedAt: '', stlibPath: '/a', origin: 'stlib' }, bad: 'nonsense' },
    })
    expect(Object.keys(migrated.libraries)).toEqual(['good'])
  })

  it('treats anything that is not a registry as empty', () => {
    expect(migrateRegistry(null).libraries).toEqual({})
    expect(migrateRegistry('{}').libraries).toEqual({})
    expect(migrateRegistry({ libraries: 7 }).libraries).toEqual({})
  })
})

describe('versionsNewestFirst', () => {
  it('orders by semver, not lexically', () => {
    const versions = { '0.9.0': entry('/a'), '0.10.0': entry('/b'), '1.0.0': entry('/c') }
    expect(versionsNewestFirst(versions)).toEqual(['1.0.0', '0.10.0', '0.9.0'])
  })
})

describe('resolveVersion', () => {
  const versions = { '0.0.1': entry('/one'), '0.0.2': entry('/two') }

  it('returns the exact version when it is installed', () => {
    expect(resolveVersion(versions, '0.0.1')).toEqual({ version: '0.0.1', entry: entry('/one'), substituted: false })
  })

  it('falls back to the newest and flags the substitution', () => {
    expect(resolveVersion(versions, '0.1.0')).toEqual({ version: '0.0.2', entry: entry('/two'), substituted: true })
  })

  it('returns the newest unflagged when no version is asked for', () => {
    expect(resolveVersion(versions)).toEqual({ version: '0.0.2', entry: entry('/two'), substituted: false })
  })

  it('returns null when nothing is installed', () => {
    expect(resolveVersion({}, '1.0.0')).toBeNull()
  })
})
