/**
 * `resources/` management, against a real temp filesystem — the guarantees
 * here are about what lands on disk, so stubbing `fs` would test nothing.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { addLibraryResource, listLibraryResources, removeLibraryResource } from '..'

/**
 * Creating a symlink needs Developer Mode or elevation on Windows. The editor
 * ships there, so the symlink case skips where the platform refuses rather
 * than failing — a red suite on Windows would be noise, not a finding.
 */
const canCreateSymlinks = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'symlink-probe-'))
  try {
    writeFileSync(join(probe, 'target'), '')
    symlinkSync(join(probe, 'target'), join(probe, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()
const itWithSymlinks = canCreateSymlinks ? it : it.skip

let projectPath: string
let sourceRoot: string

/** A minimal Arduino library folder: `library.properties` beside `src/`. */
function makeLibrary(root: string, name: string): string {
  const dir = join(root, name)
  mkdirSync(join(dir, 'src', 'transport'), { recursive: true })
  writeFileSync(join(dir, 'library.properties'), `name=${name}\nversion=1.0.0\n`)
  writeFileSync(join(dir, 'src', `${name}.h`), '#pragma once\n')
  writeFileSync(join(dir, 'src', 'transport', 'udp.cpp'), '// udp\n')
  return dir
}

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'library-project-'))
  sourceRoot = mkdtempSync(join(tmpdir(), 'library-source-'))
})

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true })
  rmSync(sourceRoot, { recursive: true, force: true })
})

describe('listLibraryResources', () => {
  it('returns nothing when the project has no resources directory', async () => {
    expect(await listLibraryResources(projectPath)).toEqual([])
  })

  it('lists each folder with its files, relative and sorted', async () => {
    makeLibrary(join(projectPath, 'resources'), 'SensorKit')
    expect(await listLibraryResources(projectPath)).toEqual([
      { name: 'SensorKit', files: ['library.properties', 'src/SensorKit.h', 'src/transport/udp.cpp'] },
    ])
  })

  it('ignores loose files: they belong to no library and the build skips them', async () => {
    mkdirSync(join(projectPath, 'resources'), { recursive: true })
    writeFileSync(join(projectPath, 'resources', 'README.md'), '# Resources\n')
    makeLibrary(join(projectPath, 'resources'), 'SensorKit')
    expect((await listLibraryResources(projectPath)).map((f) => f.name)).toEqual(['SensorKit'])
  })
})

describe('addLibraryResource', () => {
  it('copies the folder in under its own name, structure intact', async () => {
    const source = makeLibrary(sourceRoot, 'DisplayKit')
    const result = await addLibraryResource(projectPath, source)

    expect(result.success).toBe(true)
    expect(result.folder).toEqual({
      name: 'DisplayKit',
      files: ['library.properties', 'src/DisplayKit.h', 'src/transport/udp.cpp'],
    })
    expect(await listLibraryResources(projectPath)).toHaveLength(1)
  })

  it('refuses rather than merges when the name is already taken', async () => {
    const source = makeLibrary(sourceRoot, 'SensorKit')
    await addLibraryResource(projectPath, source)
    // Merging would silently lose edits the author made in place.
    const second = await addLibraryResource(projectPath, source)
    expect(second.success).toBe(false)
    expect(second.error).toMatch(/already in resources/)
  })

  it('takes only library.properties and src/, whatever else the folder holds', async () => {
    // The author points this at a checkout, not a curated directory. A real
    // one measured 2725 files, 43 of which were the library.
    const source = makeLibrary(sourceRoot, 'SensorKit')
    for (const dir of ['.git', 'node_modules', 'build', 'build-asan', 'docker', 'docs', 'examples', 'test']) {
      mkdirSync(join(source, dir), { recursive: true })
      writeFileSync(join(source, dir, 'thing'), 'not part of the library\n')
    }
    writeFileSync(join(source, 'CMakeLists.txt'), 'project(demo)\n')
    writeFileSync(join(source, 'README.md'), '# demo\n')

    const result = await addLibraryResource(projectPath, source)
    expect(result.success).toBe(true)
    expect(result.folder?.files).toEqual(['library.properties', 'src/SensorKit.h', 'src/transport/udp.cpp'])
  })

  it('carries a precompiled binary that sits under src/', async () => {
    // `precompiled=true` libraries ship a `.a` beside their headers, and it is
    // as much part of the library as they are.
    const source = makeLibrary(sourceRoot, 'SensorKit')
    mkdirSync(join(source, 'src', 'esp32'), { recursive: true })
    writeFileSync(join(source, 'src', 'esp32', 'libsensor.a'), new Uint8Array([0, 1, 2, 255]))

    const result = await addLibraryResource(projectPath, source)
    expect(result.success).toBe(true)
    expect(result.folder?.files).toContain('src/esp32/libsensor.a')
  })

  it('refuses a folder that is not a library', async () => {
    // Copying it in would land an empty library whose failure surfaces at the
    // consumer's link step, a long way from the folder that caused it.
    const source = join(sourceRoot, 'NotALibrary')
    mkdirSync(join(source, 'include'), { recursive: true })
    writeFileSync(join(source, 'include', 'thing.h'), '#pragma once\n')

    const result = await addLibraryResource(projectPath, source)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/library\.properties/)
    expect(result.error).toMatch(/src\//)
  })

  itWithSymlinks('does not follow a symlink out of the tree', async () => {
    const source = makeLibrary(sourceRoot, 'SensorKit')
    const outside = join(sourceRoot, 'outside.txt')
    writeFileSync(outside, 'secret\n')
    symlinkSync(outside, join(source, 'link.txt'))

    const result = await addLibraryResource(projectPath, source)
    expect(result.success).toBe(true)
    // The link is copied as a link, so the file it points at is not published.
    expect(await listLibraryResources(projectPath)).toEqual([
      { name: 'SensorKit', files: ['library.properties', 'src/SensorKit.h', 'src/transport/udp.cpp'] },
    ])
  })
})

describe('removeLibraryResource', () => {
  it('removes the folder', async () => {
    await addLibraryResource(projectPath, makeLibrary(sourceRoot, 'SensorKit'))
    expect(await removeLibraryResource(projectPath, 'SensorKit')).toEqual({ success: true })
    expect(await listLibraryResources(projectPath)).toEqual([])
  })

  it('refuses a name that would escape resources/', async () => {
    makeLibrary(join(projectPath, 'resources'), 'SensorKit')
    for (const name of ['..', '../..', 'a/b', '/etc']) {
      const result = await removeLibraryResource(projectPath, name)
      expect(result.success).toBe(false)
    }
    expect(await listLibraryResources(projectPath)).toHaveLength(1)
  })
})
