/**
 * Assembling the archive that travels with a program upload.
 *
 * The two things that matter: `build/` never travels (it is the bulk of a
 * project and the device already has the artifacts), and a project that
 * references a library the machine cannot supply is still worth storing.
 * Refusing to store anything because one library is missing would lose the
 * whole project to protect a detail the opening client can warn about.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { parseProjectSnapshot } from '../../../shared/project/project-snapshot-archive'
import {
  buildUploadSnapshot,
  readProjectDirectory,
  referencedLibraryNames,
} from '../build-upload-snapshot'

let projectPath: string

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'openplc-snapshot-'))
})

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true })
})

function write(relativePath: string, content: string): void {
  const absolute = join(projectPath, relativePath)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content, 'utf-8')
}

function seedProject(projectJson = '{"meta":{"name":"Traffic Light"},"data":{}}'): void {
  write('project.json', projectJson)
  write('devices/configuration.json', '{"board":"rpi"}')
  write('pous/programs/MAIN.st', 'PROGRAM MAIN END_PROGRAM')
  write('datatypes/Color.dt', 'TYPE Color END_TYPE')
}

// --- the disk walk -------------------------------------------------------

describe('readProjectDirectory', () => {
  it('collects the project tree by root-relative path', async () => {
    seedProject()
    const files = await readProjectDirectory(projectPath)
    expect([...files.keys()].sort()).toEqual([
      'datatypes/Color.dt',
      'devices/configuration.json',
      'pous/programs/MAIN.st',
      'project.json',
    ])
  })

  it('never carries build/', async () => {
    // The whole point. It is the bulk of a project, and the device already has
    // the artifacts -- it is what the upload beside this one is made of.
    seedProject()
    write('build/rpi/src/pou_MAIN.cpp', 'generated')
    write('build/rpi/src/configuration.cpp', 'generated')
    const files = await readProjectDirectory(projectPath)
    expect([...files.keys()].some((path) => path.startsWith('build/'))).toBe(false)
  })

  it('skips local noise that would otherwise travel to a device and back', async () => {
    seedProject()
    write('.DS_Store', 'junk')
    write('.git/config', '[core]')
    write('node_modules/pkg/index.js', 'module.exports = {}')
    const files = await readProjectDirectory(projectPath)
    expect([...files.keys()].sort()).toEqual([
      'datatypes/Color.dt',
      'devices/configuration.json',
      'pous/programs/MAIN.st',
      'project.json',
    ])
  })

  it('uses forward slashes so an archive reads the same on every host', async () => {
    seedProject()
    const files = await readProjectDirectory(projectPath)
    expect([...files.keys()].every((path) => !path.includes('\\'))).toBe(true)
  })
})

// --- library references --------------------------------------------------

describe('referencedLibraryNames', () => {
  it('reads the names a project declares', () => {
    const json = '{"data":{"libraries":[{"name":"Motion","version":"1.0"},{"name":"Vision"}]}}'
    expect(referencedLibraryNames(json)).toEqual(['Motion', 'Vision'])
  })

  it('treats an unparseable project.json as declaring none', () => {
    // A project.json that will not parse is a project that will not open. Still
    // worth storing; just without libraries we cannot identify.
    expect(referencedLibraryNames('not json')).toEqual([])
  })

  it('ignores entries with no usable name', () => {
    expect(referencedLibraryNames('{"data":{"libraries":[{"version":"1"},{"name":""}]}}')).toEqual([])
  })
})

// --- the assembled archive ----------------------------------------------

describe('buildUploadSnapshot', () => {
  it('produces an archive the shared reader accepts', async () => {
    seedProject()
    const snapshot = await buildUploadSnapshot({
      projectPath,
      editorVersion: '4.2.0',
      uploadedBy: 'op',
      timestamp: '2026-08-31T12:00:00.000Z',
    })

    const parsed = await parseProjectSnapshot(new Uint8Array(snapshot.archive))
    expect(parsed.metadata.projectName).toBe('Traffic Light')
    expect(parsed.metadata.editorVersion).toBe('4.2.0')
    expect(parsed.metadata.uploadedBy).toBe('op')
    expect(parsed.files.get('pous/programs/MAIN.st')).toBe('PROGRAM MAIN END_PROGRAM')
  })

  it('hands back metadata matching the archive, as one JSON string', async () => {
    // The device stores these separately and never opens the archive, so they
    // are the only description of the stored project that exists.
    seedProject()
    const snapshot = await buildUploadSnapshot({
      projectPath,
      editorVersion: '4.2.0',
      uploadedBy: 'op',
    })
    const metadata = JSON.parse(snapshot.metadata) as { projectName: string; formatVersion: number }
    expect(metadata.projectName).toBe('Traffic Light')
    expect(metadata.formatVersion).toBe(1)
  })

  it('bundles the libraries the project references', async () => {
    seedProject('{"meta":{"name":"P"},"data":{"libraries":[{"name":"Motion","version":"1.2.0"}]}}')
    const archiveText = JSON.stringify({ manifest: { name: 'Motion', version: '1.2.0' } })

    const snapshot = await buildUploadSnapshot({
      projectPath,
      editorVersion: '4.2.0',
      uploadedBy: 'op',
      readLibraryArchive: () => archiveText,
    })

    expect(snapshot.missingLibraries).toEqual([])
    const parsed = await parseProjectSnapshot(new Uint8Array(snapshot.archive))
    expect(parsed.libraries).toHaveLength(1)
    expect(parsed.libraries[0].archive).toBe(archiveText)
    expect(parsed.metadata.libraries[0]).toEqual({
      name: 'Motion',
      version: '1.2.0',
      hash: expect.any(String),
    })
  })

  it('still stores the project when a library cannot be read', async () => {
    // Losing the whole project to protect a detail the opening client can warn
    // about would be the wrong trade.
    seedProject('{"meta":{"name":"P"},"data":{"libraries":[{"name":"Gone"}]}}')
    const snapshot = await buildUploadSnapshot({
      projectPath,
      editorVersion: '4.2.0',
      uploadedBy: 'op',
      readLibraryArchive: () => null,
    })

    expect(snapshot.missingLibraries).toEqual(['Gone'])
    const parsed = await parseProjectSnapshot(new Uint8Array(snapshot.archive))
    expect(parsed.files.get('project.json')).toBeDefined()
    expect(parsed.libraries).toHaveLength(0)
  })

  it('falls back to the directory name when the project has no name', async () => {
    // The device shows this in its discovery reply and in the retrieve picker.
    // An empty name there reads as a broken device.
    seedProject('{"meta":{},"data":{}}')
    const snapshot = await buildUploadSnapshot({
      projectPath,
      editorVersion: '4.2.0',
      uploadedBy: 'op',
    })
    const metadata = JSON.parse(snapshot.metadata) as { projectName: string }
    expect(metadata.projectName).toBe(projectPath.split(/[\\/]/).pop())
  })
})
