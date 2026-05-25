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

import { buildLibraryManifestTemplate, buildProjectFileContent, toSnakeCaseNamespace } from '../create-project-files'

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
  it('emits a strucpp-compatible metadata-only manifest skeleton', () => {
    const raw = buildLibraryManifestTemplate('My Sensor Lib')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({
      name: 'My Sensor Lib',
      displayName: 'My Sensor Lib',
      version: '0.1.0',
      namespace: 'my_sensor_lib',
      description: '',
    })
  })

  it('omits the auto-computed symbol arrays', () => {
    // functions / functionBlocks / types / headers are produced by
    // strucpp at build time — surfacing them as empty arrays in the
    // template would invite drift between the editor view and the
    // user-edited manifest.
    const raw = buildLibraryManifestTemplate('My Sensor Lib')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('functions')
    expect(parsed).not.toHaveProperty('functionBlocks')
    expect(parsed).not.toHaveProperty('types')
    expect(parsed).not.toHaveProperty('headers')
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

    describe('default POU body per language', () => {
      it('seeds a ladder rung container for LD projects', () => {
        const ld = buildProjectFileContent({ name: 'P', type: 'plc-project', language: 'ld', time: 'T#20ms' })
        expect(ld.pous[0].data.body).toEqual({ language: 'ld', value: { name: 'main', rungs: [] } })
      })

      it('seeds an empty flow graph for FBD projects', () => {
        const fbd = buildProjectFileContent({ name: 'P', type: 'plc-project', language: 'fbd', time: 'T#20ms' })
        expect(fbd.pous[0].data.body).toEqual({
          language: 'fbd',
          value: { name: 'main', rung: { comment: '', edges: [], nodes: [] } },
        })
      })

      it('seeds an empty textual body for ST/IL/SFC projects', () => {
        const il = buildProjectFileContent({ name: 'P', type: 'plc-project', language: 'il', time: 'T#20ms' })
        expect(il.pous[0].data.body).toEqual({ language: 'il', value: '' })
      })
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
      expect(manifest.displayName).toBe('Sensor Tools')
      expect(manifest.namespace).toBe('sensor_tools')
      expect(manifest.version).toBe('0.1.0')
      expect(manifest.description).toBe('')
    })

    it('does not seed the auto-computed symbol arrays in the template', () => {
      // `functions`, `functionBlocks`, `types`, `headers` are
      // populated by strucpp at build time from the project's
      // POUs / data types — surfacing them as empty arrays in the
      // user-editable manifest would invite manual maintenance of
      // a list the editor already owns.
      const manifest = JSON.parse(built.libraryManifest as string) as Record<string, unknown>
      expect(manifest).not.toHaveProperty('functions')
      expect(manifest).not.toHaveProperty('functionBlocks')
      expect(manifest).not.toHaveProperty('types')
      expect(manifest).not.toHaveProperty('headers')
    })
  })
})
