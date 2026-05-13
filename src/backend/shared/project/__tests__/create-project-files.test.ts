/**
 * Tests for the pure file-content authoring used by both the
 * Electron and (future) web editor backends when a new project or
 * library is created.
 *
 * Library coverage matters here because no UI test exercises the
 * library branch end-to-end yet (the New Project Library button
 * doesn't fully wire to the backend until Phase 2 lands the IPC
 * plumbing).  Pinning the shape now prevents regressions across
 * the remaining phases.
 */

import {
  buildLibraryManifestTemplate,
  buildProjectFileContent,
  toSnakeCaseNamespace,
} from '../create-project-files'

describe('toSnakeCaseNamespace', () => {
  it('normalises spaces to underscores', () => {
    expect(toSnakeCaseNamespace('My Cool Lib')).toBe('my_cool_lib')
  })

  it('collapses runs of non-alphanumerics into single underscores', () => {
    expect(toSnakeCaseNamespace('My   Cool---Lib')).toBe('my_cool_lib')
  })

  it('lowercases', () => {
    expect(toSnakeCaseNamespace('Sensor-Tools')).toBe('sensor_tools')
  })

  it('strips leading and trailing underscores', () => {
    expect(toSnakeCaseNamespace('  -- _ foo _ --  ')).toBe('foo')
  })

  it('prefixes a leading digit with an underscore (C++ identifier rule)', () => {
    expect(toSnakeCaseNamespace('123foo')).toBe('_123foo')
  })

  it('returns a safe fallback for empty / unrecognisable input', () => {
    expect(toSnakeCaseNamespace('')).toBe('lib')
    expect(toSnakeCaseNamespace('---')).toBe('lib')
  })
})

describe('buildLibraryManifestTemplate', () => {
  it('emits a strucpp-compatible manifest skeleton', () => {
    const raw = buildLibraryManifestTemplate('My Sensor Lib')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({
      name: 'My Sensor Lib',
      displayName: 'My Sensor Lib',
      version: '0.1.0',
      namespace: 'my_sensor_lib',
      description: '',
      functions: [],
      functionBlocks: [],
      types: [],
      headers: [],
    })
  })

  it('is JSON-formatted with a trailing newline', () => {
    const raw = buildLibraryManifestTemplate('lib')
    expect(raw.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})

describe('buildProjectFileContent', () => {
  describe('for plc-project', () => {
    const built = buildProjectFileContent({
      name: 'MyProject',
      type: 'plc-project',
      language: 'st',
      time: 'T#50ms',
    })

    it('seeds one cyclic task and one program instance', () => {
      const resource = built.project.data.configuration.resource
      expect(resource.tasks).toHaveLength(1)
      expect(resource.tasks[0]).toMatchObject({ name: 'task0', triggering: 'Cyclic', interval: 'T#50ms' })
      expect(resource.instances).toHaveLength(1)
      expect(resource.instances[0]).toMatchObject({ name: 'instance0', program: 'main', task: 'task0' })
    })

    it('seeds a default main program POU', () => {
      expect(built.pous).toHaveLength(1)
      expect(built.pous[0].data.name).toBe('main')
      expect(built.pous[0].type).toBe('program')
    })

    it('does not emit a library manifest', () => {
      expect(built.libraryManifest).toBeUndefined()
    })
  })

  describe('for plc-library', () => {
    const built = buildProjectFileContent({
      name: 'Sensor Tools',
      type: 'plc-library',
      language: 'st',
      time: 'T#20ms',
    })

    it('emits a degenerate configuration (no tasks, no instances)', () => {
      const resource = built.project.data.configuration.resource
      expect(resource.tasks).toEqual([])
      expect(resource.instances).toEqual([])
      expect(resource.globalVariables).toEqual([])
    })

    it('does not seed a default POU', () => {
      expect(built.pous).toEqual([])
    })

    it('tags the project meta as plc-library', () => {
      expect(built.project.meta.type).toBe('plc-library')
    })

    it('emits a library manifest with snake_case namespace auto-fill', () => {
      expect(built.libraryManifest).toBeDefined()
      const manifest = JSON.parse(built.libraryManifest as string) as Record<string, unknown>
      expect(manifest.name).toBe('Sensor Tools')
      expect(manifest.namespace).toBe('sensor_tools')
      expect(manifest.version).toBe('0.1.0')
      expect(manifest.functions).toEqual([])
      expect(manifest.functionBlocks).toEqual([])
      expect(manifest.types).toEqual([])
    })
  })
})
