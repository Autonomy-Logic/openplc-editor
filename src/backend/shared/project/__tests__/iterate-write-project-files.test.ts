/**
 * Tests for the single-source-of-truth iterator over a
 * `WriteProjectFiles` payload.  Adapter sides on both the editor
 * (filesystem writer) and the web (Edge API envelope packer) iterate
 * this generator to learn "which relative paths exist in a save
 * request" — keeping the category list in one place is the whole
 * point.  Pinning the shape with tests means a future contributor
 * who adds a new file category can't ship a half-wired change that
 * works on one platform but silently drops the file on the other.
 */

import type { WriteProjectFiles } from '../../../../middleware/shared/ports/project-port'
import { iterateWriteProjectFiles } from '../iterate-write-project-files'

const baseFiles: WriteProjectFiles = {
  projectPath: '/p',
  projectJson: '{"meta":{}}',
  pouFiles: [],
  serverFiles: [],
  remoteDeviceFiles: [],
  deletions: [],
}

function collect(files: WriteProjectFiles) {
  return Array.from(iterateWriteProjectFiles(files))
}

describe('iterateWriteProjectFiles', () => {
  it('always yields project.json first', () => {
    const entries = collect(baseFiles)
    expect(entries[0]).toEqual({ category: 'project-json', relativePath: 'project.json', content: '{"meta":{}}' })
  })

  it('yields nothing else for an empty PLC project (no optionals, no arrays)', () => {
    expect(collect(baseFiles)).toHaveLength(1)
  })

  describe('optional top-level files', () => {
    it('yields deviceConfig when defined', () => {
      const entries = collect({ ...baseFiles, deviceConfig: '{"board":"x"}' })
      expect(entries).toContainEqual({
        category: 'device-config',
        relativePath: 'devices/configuration.json',
        content: '{"board":"x"}',
      })
    })

    it('omits deviceConfig when undefined', () => {
      const categories = collect(baseFiles).map((e) => e.category)
      expect(categories).not.toContain('device-config')
    })

    it('yields deviceConfig even when empty string (caller opted in to an empty file)', () => {
      const entries = collect({ ...baseFiles, deviceConfig: '' })
      expect(entries).toContainEqual({
        category: 'device-config',
        relativePath: 'devices/configuration.json',
        content: '',
      })
    })

    it('yields pinMapping when defined', () => {
      const entries = collect({ ...baseFiles, pinMapping: '[]' })
      expect(entries).toContainEqual({
        category: 'pin-mapping',
        relativePath: 'devices/pin-mapping.json',
        content: '[]',
      })
    })

    it('omits pinMapping when undefined', () => {
      const categories = collect(baseFiles).map((e) => e.category)
      expect(categories).not.toContain('pin-mapping')
    })

    it('yields libraryManifest when defined', () => {
      const entries = collect({ ...baseFiles, libraryManifest: '{"name":"foo"}' })
      expect(entries).toContainEqual({
        category: 'library-manifest',
        relativePath: 'library.json',
        content: '{"name":"foo"}',
      })
    })

    it('omits libraryManifest when undefined', () => {
      const categories = collect(baseFiles).map((e) => e.category)
      expect(categories).not.toContain('library-manifest')
    })
  })

  describe('file arrays', () => {
    it('yields each POU file preserving relativePath verbatim', () => {
      const entries = collect({
        ...baseFiles,
        pouFiles: [
          { relativePath: 'pous/programs/main.st', content: 'PROGRAM main\nEND_PROGRAM' },
          { relativePath: 'pous/function-blocks/counter.fbd', content: '<fbd/>' },
        ],
      })
      expect(entries.filter((e) => e.category === 'pou')).toEqual([
        { category: 'pou', relativePath: 'pous/programs/main.st', content: 'PROGRAM main\nEND_PROGRAM' },
        { category: 'pou', relativePath: 'pous/function-blocks/counter.fbd', content: '<fbd/>' },
      ])
    })

    it('yields each server file preserving relativePath verbatim', () => {
      const entries = collect({
        ...baseFiles,
        serverFiles: [
          { relativePath: 'devices/servers/modbus.json', content: '{"port":502}' },
          { relativePath: 'devices/servers/opcua.json', content: '{"port":4840}' },
        ],
      })
      expect(entries.filter((e) => e.category === 'server')).toEqual([
        { category: 'server', relativePath: 'devices/servers/modbus.json', content: '{"port":502}' },
        { category: 'server', relativePath: 'devices/servers/opcua.json', content: '{"port":4840}' },
      ])
    })

    it('yields each remote device file preserving relativePath verbatim', () => {
      const entries = collect({
        ...baseFiles,
        remoteDeviceFiles: [{ relativePath: 'devices/remote/bus0.json', content: '{"id":"bus0"}' }],
      })
      expect(entries.filter((e) => e.category === 'remote-device')).toEqual([
        { category: 'remote-device', relativePath: 'devices/remote/bus0.json', content: '{"id":"bus0"}' },
      ])
    })
  })

  describe('whole-project shapes', () => {
    it('PLC project: project.json + device-config + pin-mapping + POUs, no library-manifest', () => {
      const entries = collect({
        ...baseFiles,
        deviceConfig: '{"board":"uno"}',
        pinMapping: '[]',
        pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'PROGRAM main\nEND_PROGRAM' }],
      })
      expect(entries.map((e) => e.category)).toEqual(['project-json', 'device-config', 'pin-mapping', 'pou'])
    })

    it('library project: project.json + library-manifest, no device files, no POUs', () => {
      const entries = collect({ ...baseFiles, libraryManifest: '{"name":"mylib","version":"0.1.0"}' })
      expect(entries.map((e) => e.category)).toEqual(['project-json', 'library-manifest'])
    })

    it('library project with content: project.json + library-manifest + POUs', () => {
      const entries = collect({
        ...baseFiles,
        libraryManifest: '{"name":"mylib"}',
        pouFiles: [
          { relativePath: 'pous/functions/add.st', content: 'FUNCTION add' },
          { relativePath: 'pous/function-blocks/timer.st', content: 'FUNCTION_BLOCK timer' },
        ],
      })
      expect(entries.map((e) => e.category)).toEqual(['project-json', 'library-manifest', 'pou', 'pou'])
    })
  })

  describe('ordering', () => {
    it('emits in a stable order: project.json, device-config, pin-mapping, library-manifest, pous, servers, remote-devices', () => {
      const entries = collect({
        ...baseFiles,
        deviceConfig: 'D',
        pinMapping: 'P',
        libraryManifest: 'L',
        pouFiles: [{ relativePath: 'pous/programs/a.st', content: 'A' }],
        serverFiles: [{ relativePath: 'devices/servers/s.json', content: 'S' }],
        remoteDeviceFiles: [{ relativePath: 'devices/remote/r.json', content: 'R' }],
      })
      expect(entries.map((e) => e.category)).toEqual([
        'project-json',
        'device-config',
        'pin-mapping',
        'library-manifest',
        'pou',
        'server',
        'remote-device',
      ])
    })
  })
})
