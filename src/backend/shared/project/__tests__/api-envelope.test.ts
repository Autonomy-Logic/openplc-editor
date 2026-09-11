/**
 * Tests for the Edge API envelope helpers.
 *
 * These functions own the web-only path↔slot mapping.  Both the
 * full-project saveProject path (`envelopeFromWriteProjectFiles` ->
 * POST) and the single-file saveFile path (`getInEnvelope` /
 * `setInEnvelope` for load-patch-save) dispatch through them, so
 * the same cases must round-trip cleanly in both directions.
 */

import { describe, expect, it } from '@jest/globals'

import type { WriteProjectFiles } from '../../../../middleware/shared/ports/project-port'
import {
  apiFilesToRaw,
  type ApiProjectFiles,
  ApiProjectFilesSchema,
  envelopeFromWriteProjectFiles,
  getInEnvelope,
  type IncomingApiProjectFiles,
  setInEnvelope,
} from '../api-envelope'

function makeEnvelope(overrides?: Partial<ApiProjectFiles>): ApiProjectFiles {
  return {
    'project.json': '{}',
    devices: {},
    pous: {},
    ...overrides,
  }
}

/**
 * `devices` is a flat map of file contents that also carries nested slots, and no
 * object literal satisfies both at once: the index signature demands a string for
 * every key while `remote` and `servers` are maps. Filling the slots after the fact
 * builds the value the API actually sends without loosening the type.
 */
const devicesWith = (nested: {
  remote?: Record<string, string>
  servers?: Record<string, string>
}): ApiProjectFiles['devices'] => {
  const devices: ApiProjectFiles['devices'] = {}
  if (nested.remote) devices.remote = nested.remote
  if (nested.servers) devices.servers = nested.servers
  return devices
}

describe('getInEnvelope', () => {
  it('reads project.json at the root', () => {
    const env = makeEnvelope({ 'project.json': '{"name":"x"}' })
    expect(getInEnvelope(env, 'project.json')).toBe('{"name":"x"}')
  })

  it('reads library.json at the root when present', () => {
    const env = makeEnvelope({ 'library.json': '{"name":"mylib"}' })
    expect(getInEnvelope(env, 'library.json')).toBe('{"name":"mylib"}')
  })

  it('returns undefined for library.json when absent (PLC project)', () => {
    expect(getInEnvelope(makeEnvelope(), 'library.json')).toBeUndefined()
  })

  it('reads devices/configuration.json from envelope.devices', () => {
    const env = makeEnvelope({
      devices: { 'configuration.json': '{"board":"uno"}' },
    })
    expect(getInEnvelope(env, 'devices/configuration.json')).toBe('{"board":"uno"}')
  })

  it('reads devices/pin-mapping.json from envelope.devices', () => {
    const env = makeEnvelope({
      devices: { 'pin-mapping.json': '[]' },
    })
    expect(getInEnvelope(env, 'devices/pin-mapping.json')).toBe('[]')
  })

  it('reads devices/remote/* from envelope.devices.remote', () => {
    const env = makeEnvelope({
      devices: devicesWith({ remote: { 'bus0.json': '{"id":0}' } }),
    })
    expect(getInEnvelope(env, 'devices/remote/bus0.json')).toBe('{"id":0}')
  })

  it('reads devices/servers/* from envelope.devices.servers', () => {
    // Edge nests by path, so `devices/servers/x.json` arrives under `devices`, not at
    // the top level.
    const env = makeEnvelope({ devices: devicesWith({ servers: { 'modbus.json': '{"port":502}' } }) })
    expect(getInEnvelope(env, 'devices/servers/modbus.json')).toBe('{"port":502}')
  })

  it('falls back to the legacy top-level servers slot', () => {
    const env = makeEnvelope({ servers: { 'modbus.json': '{"port":502}' } })
    expect(getInEnvelope(env, 'devices/servers/modbus.json')).toBe('{"port":502}')
  })

  it('prefers the canonical slot when both name the file', () => {
    const env = makeEnvelope({
      devices: devicesWith({ servers: { 'modbus.json': 'NEW' } }),
      servers: { 'modbus.json': 'OLD' },
    })
    expect(getInEnvelope(env, 'devices/servers/modbus.json')).toBe('NEW')
  })

  it('reads pous/{category}/{filename} from envelope.pous', () => {
    const env = makeEnvelope({
      pous: {
        programs: { 'main.st': 'PROGRAM main' },
        'function-blocks': { 'timer.st': 'FB timer' },
      },
    })
    expect(getInEnvelope(env, 'pous/programs/main.st')).toBe('PROGRAM main')
    expect(getInEnvelope(env, 'pous/function-blocks/timer.st')).toBe('FB timer')
  })

  it('returns undefined for unknown paths', () => {
    expect(getInEnvelope(makeEnvelope(), 'unknown/path')).toBeUndefined()
    expect(getInEnvelope(makeEnvelope(), 'devices/unknown')).toBeUndefined()
    expect(getInEnvelope(makeEnvelope(), 'pous/programs')).toBeUndefined()
  })

  it('returns undefined when intermediate containers are missing', () => {
    const env = makeEnvelope()
    expect(getInEnvelope(env, 'devices/remote/anything.json')).toBeUndefined()
    expect(getInEnvelope(env, 'devices/servers/anything.json')).toBeUndefined()
    expect(getInEnvelope(env, 'pous/programs/missing.st')).toBeUndefined()
  })
})

describe('setInEnvelope', () => {
  it('writes project.json at the root', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'project.json', '{"name":"x"}')
    expect(env['project.json']).toBe('{"name":"x"}')
  })

  it('writes library.json at the root', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'library.json', '{"name":"mylib","version":"0.1.0"}')
    expect(env['library.json']).toBe('{"name":"mylib","version":"0.1.0"}')
  })

  it('writes devices/configuration.json', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'devices/configuration.json', '{"board":"uno"}')
    expect(env.devices?.['configuration.json']).toBe('{"board":"uno"}')
  })

  it('writes devices/pin-mapping.json', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'devices/pin-mapping.json', '[]')
    expect(env.devices?.['pin-mapping.json']).toBe('[]')
  })

  it('lazily initialises devices.remote container when writing first remote device', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'devices/remote/bus0.json', '{"id":0}')
    expect(env.devices?.remote).toEqual({ 'bus0.json': '{"id":0}' })
  })

  it('appends to existing devices.remote', () => {
    const env = makeEnvelope({
      devices: devicesWith({ remote: { 'bus0.json': '{"id":0}' } }),
    })
    setInEnvelope(env, 'devices/remote/bus1.json', '{"id":1}')
    expect(env.devices.remote).toEqual({ 'bus0.json': '{"id":0}', 'bus1.json': '{"id":1}' })
  })

  it('lazily initialises devices.servers container when writing first server', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'devices/servers/modbus.json', '{"port":502}')
    expect(env.devices.servers).toEqual({ 'modbus.json': '{"port":502}' })
    expect(env.servers).toBeUndefined()
  })

  it('appends to existing devices.servers', () => {
    const env = makeEnvelope({ devices: devicesWith({ servers: { 'modbus.json': '{"port":502}' } }) })
    setInEnvelope(env, 'devices/servers/opcua.json', '{"port":4840}')
    expect(env.devices.servers).toEqual({ 'modbus.json': '{"port":502}', 'opcua.json': '{"port":4840}' })
  })

  it('retires the legacy top-level copy of a server it rewrites', () => {
    const env = makeEnvelope({ servers: { 'modbus.json': 'OLD', 'opcua.json': 'KEEP' } })
    setInEnvelope(env, 'devices/servers/modbus.json', 'NEW')
    expect(env.devices.servers).toEqual({ 'modbus.json': 'NEW' })
    // Only the file that was rewritten moves; the other legacy entry is untouched.
    expect(env.servers).toEqual({ 'opcua.json': 'KEEP' })
  })

  it('lazily initialises envelope.pous[category] when writing first POU of that category', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'pous/programs/main.st', 'PROGRAM main')
    expect(env.pous.programs).toEqual({ 'main.st': 'PROGRAM main' })
  })

  it('handles all three POU categories', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'pous/programs/main.st', 'P')
    setInEnvelope(env, 'pous/functions/add.st', 'F')
    setInEnvelope(env, 'pous/function-blocks/timer.st', 'FB')
    expect(env.pous).toEqual({
      programs: { 'main.st': 'P' },
      functions: { 'add.st': 'F' },
      'function-blocks': { 'timer.st': 'FB' },
    })
  })

  it('is idempotent for the same path+content', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'project.json', 'X')
    setInEnvelope(env, 'project.json', 'X')
    expect(env['project.json']).toBe('X')
  })

  it('overwrites existing content', () => {
    const env = makeEnvelope({ 'project.json': 'OLD' })
    setInEnvelope(env, 'project.json', 'NEW')
    expect(env['project.json']).toBe('NEW')
  })

  it('silently no-ops on unknown paths', () => {
    const env = makeEnvelope()
    const snapshot = JSON.stringify(env)
    setInEnvelope(env, 'unknown/path/file', 'x')
    setInEnvelope(env, 'pous/programs', 'x') // wrong arity
    setInEnvelope(env, 'devices/random', 'x') // unknown sub-key
    setInEnvelope(env, 'pous/programs/nested/too/deep', 'x') // too many parts
    expect(JSON.stringify(env)).toBe(snapshot)
  })

  it('lazily initialises envelope.build container when writing first build artifact', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'build/test-lib.stlib', '{"manifest":{}}')
    expect(env.build).toEqual({ 'test-lib.stlib': '{"manifest":{}}' })
  })

  it('appends to existing envelope.build', () => {
    const env = makeEnvelope({ build: { 'first.stlib': '{}' } })
    setInEnvelope(env, 'build/.verify-cache-library.json', '{"md5":"x"}')
    expect(env.build).toEqual({
      'first.stlib': '{}',
      '.verify-cache-library.json': '{"md5":"x"}',
    })
  })

  it('round-trips via getInEnvelope for every supported category', () => {
    const env = makeEnvelope()
    const cases: Array<[string, string]> = [
      ['project.json', 'PJ'],
      ['library.json', 'LIB'],
      ['devices/configuration.json', 'DC'],
      ['devices/pin-mapping.json', 'PM'],
      ['devices/remote/bus.json', 'RD'],
      ['devices/servers/srv.json', 'SV'],
      ['pous/programs/main.st', 'PG'],
      ['pous/functions/add.st', 'FN'],
      ['pous/function-blocks/tmr.st', 'FB'],
      ['datatypes/Motor.dt', 'DT'],
      ['build/lib.stlib', 'STLIB'],
      ['build/.verify-cache-library.json', 'CACHE'],
    ]
    for (const [path, content] of cases) {
      setInEnvelope(env, path, content)
    }
    for (const [path, content] of cases) {
      expect(getInEnvelope(env, path)).toBe(content)
    }
  })
})

/**
 * The envelope a brand-new project actually comes back with.
 *
 * `GET /projects/:id/details` answers `files: {}` for a project that has never
 * been saved — no `pous`, no `devices`, not even `project.json`. `makeEnvelope`
 * above always supplies those containers, which is exactly why this went
 * unnoticed: `setInEnvelope` assumed they existed and threw a TypeError, so
 * `saveFile`'s load-patch-save round trip failed between the GET and the POST.
 * Ctrl+S issued the read, died on the patch, never wrote anything, and left the
 * file dirty behind a toast that faded. Full project saves were fine because
 * they build a complete envelope from scratch.
 */
describe('setInEnvelope on the envelope a new project really returns', () => {
  /**
   * `files: {}` — no containers at all, as the API sends it.
   *
   * Typed `IncomingApiProjectFiles` rather than asserted into `ApiProjectFiles`:
   * that IS the shape on the wire, and it is the shape `setInEnvelope` declares it
   * accepts. Asserting here used to hide the mismatch these tests exist to prove.
   */
  function emptyEnvelope(): IncomingApiProjectFiles {
    return {}
  }

  it('writes a POU without a pous container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'pous/programs/main.st', 'PROGRAM main END_PROGRAM')

    expect(env.pous).toEqual({ programs: { 'main.st': 'PROGRAM main END_PROGRAM' } })
  })

  it('writes the device config without a devices container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'devices/configuration.json', '{"board":"uno"}')

    expect(env.devices?.['configuration.json']).toBe('{"board":"uno"}')
  })

  it('writes the pin mapping without a devices container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'devices/pin-mapping.json', '[]')

    expect(env.devices?.['pin-mapping.json']).toBe('[]')
  })

  it('writes a remote device without a devices container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'devices/remote/bus0.json', '{"id":0}')

    expect(env.devices?.remote).toEqual({ 'bus0.json': '{"id":0}' })
  })

  it('writes project.json without any containers', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'project.json', '{"meta":{"name":"P"}}')

    expect(env['project.json']).toBe('{"meta":{"name":"P"}}')
  })

  // What the crash cost: the write never reached the transport at all.
  it('never throws, whatever container is missing', () => {
    const paths = [
      'project.json',
      'library.json',
      'devices/configuration.json',
      'devices/pin-mapping.json',
      'devices/remote/bus0.json',
      'devices/servers/opcua.json',
      'pous/programs/main.st',
      'pous/functions/f.st',
      'datatypes/MyType.dt',
      'build/lib.stlib',
      'totally/unknown/path.txt',
    ]

    for (const path of paths) {
      expect(() => setInEnvelope(emptyEnvelope(), path, 'X')).not.toThrow()
    }
  })

  // Symmetry with getInEnvelope is the actual invariant: what one writes into a
  // bare envelope, the other has to be able to read back out.
  it('round-trips through getInEnvelope from a bare envelope', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'pous/programs/main.st', 'CODE')
    setInEnvelope(env, 'devices/configuration.json', '{"board":"uno"}')
    setInEnvelope(env, 'devices/remote/bus0.json', '{"id":0}')

    expect(getInEnvelope(env, 'pous/programs/main.st')).toBe('CODE')
    expect(getInEnvelope(env, 'devices/configuration.json')).toBe('{"board":"uno"}')
    expect(getInEnvelope(env, 'devices/remote/bus0.json')).toBe('{"id":0}')
  })

  it('round-trips a server from a bare envelope', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'devices/servers/opcua.json', '{"port":4840}')

    expect(getInEnvelope(env, 'devices/servers/opcua.json')).toBe('{"port":4840}')
    expect(Object.keys(env)).toEqual(['devices'])
  })

  // A patch must not invent files the project does not have; the backend
  // deletes anything missing from the payload.
  it('adds only the container the path needs', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'pous/programs/main.st', 'CODE')

    expect(Object.keys(env)).toEqual(['pous'])
  })
})

describe('envelopeFromWriteProjectFiles', () => {
  function makeWriteFiles(overrides?: Partial<WriteProjectFiles>): WriteProjectFiles {
    return {
      projectPath: 'proj-1',
      projectJson: '{"meta":{}}',
      pouFiles: [],
      serverFiles: [],
      remoteDeviceFiles: [],
      dataTypeFiles: [],
      deletions: [],
      ...overrides,
    }
  }

  it('produces a minimal envelope with only project.json from an empty WriteProjectFiles', () => {
    const env = envelopeFromWriteProjectFiles(makeWriteFiles())
    expect(env).toEqual({
      'project.json': '{"meta":{}}',
      devices: {},
      pous: {},
    })
  })

  it('PLC project: emits project.json, devices.configuration, devices.pin-mapping, pous, devices.servers', () => {
    const env = envelopeFromWriteProjectFiles(
      makeWriteFiles({
        deviceConfig: '{"board":"uno"}',
        pinMapping: '[]',
        pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'PROGRAM main' }],
        serverFiles: [{ relativePath: 'devices/servers/modbus.json', content: '{"port":502}' }],
        remoteDeviceFiles: [{ relativePath: 'devices/remote/bus0.json', content: '{"id":0}' }],
      }),
    )
    expect(env).toEqual({
      'project.json': '{"meta":{}}',
      devices: {
        'configuration.json': '{"board":"uno"}',
        'pin-mapping.json': '[]',
        remote: { 'bus0.json': '{"id":0}' },
        servers: { 'modbus.json': '{"port":502}' },
      },
      pous: { programs: { 'main.st': 'PROGRAM main' } },
    })
  })

  it('library project: emits project.json + library.json, no device files, no servers', () => {
    const env = envelopeFromWriteProjectFiles(
      makeWriteFiles({
        libraryManifest: '{"name":"mylib","version":"0.1.0"}',
        pouFiles: [{ relativePath: 'pous/functions/add.st', content: 'FUNCTION add' }],
      }),
    )
    expect(env).toEqual({
      'project.json': '{"meta":{}}',
      'library.json': '{"name":"mylib","version":"0.1.0"}',
      devices: {},
      pous: { functions: { 'add.st': 'FUNCTION add' } },
    })
  })

  it('omits library.json when libraryManifest is undefined', () => {
    const env = envelopeFromWriteProjectFiles(makeWriteFiles())
    expect(env['library.json']).toBeUndefined()
  })

  it('slots data type files under envelope.datatypes and omits the container when empty', () => {
    const env = envelopeFromWriteProjectFiles(
      makeWriteFiles({
        dataTypeFiles: [
          { relativePath: 'datatypes/Motor.dt', content: 'TYPE\n  Motor : STRUCT\n  END_STRUCT;\nEND_TYPE\n' },
          { relativePath: 'datatypes/Color.dt', content: 'TYPE\n  Color : (Red);\nEND_TYPE\n' },
        ],
      }),
    )
    expect(env.datatypes).toEqual({
      'Motor.dt': 'TYPE\n  Motor : STRUCT\n  END_STRUCT;\nEND_TYPE\n',
      'Color.dt': 'TYPE\n  Color : (Red);\nEND_TYPE\n',
    })
    expect(envelopeFromWriteProjectFiles(makeWriteFiles()).datatypes).toBeUndefined()
  })

  it('groups multiple POUs by category', () => {
    const env = envelopeFromWriteProjectFiles(
      makeWriteFiles({
        pouFiles: [
          { relativePath: 'pous/programs/a.st', content: 'A' },
          { relativePath: 'pous/programs/b.st', content: 'B' },
          { relativePath: 'pous/functions/c.st', content: 'C' },
          { relativePath: 'pous/function-blocks/d.st', content: 'D' },
        ],
      }),
    )
    expect(env.pous).toEqual({
      programs: { 'a.st': 'A', 'b.st': 'B' },
      functions: { 'c.st': 'C' },
      'function-blocks': { 'd.st': 'D' },
    })
  })
})

/**
 * The schema is what stands between a response off the wire and the reader, so its
 * failure mode is not a type error — it is a project that opens with pieces missing
 * and no complaint. Each case here is a container that must survive the crossing.
 */
describe('ApiProjectFilesSchema', () => {
  it('keeps devices/remote AND the flat device files beside it', () => {
    // `devices` is the one container that is both a flat file map and a parent. A
    // schema that demands a string for every key rejects it whole the moment a project
    // owns a remote device.
    const parsed = ApiProjectFilesSchema.parse({
      'project.json': '{}',
      devices: { 'configuration.json': '{"board":"uno"}', 'pin-mapping.json': '[]', remote: { 'bus0.json': '{}' } },
      pous: { programs: { 'main.st': 'x;' } },
    })

    expect(parsed.devices?.['configuration.json']).toBe('{"board":"uno"}')
    expect(parsed.devices?.['pin-mapping.json']).toBe('[]')
    expect(parsed.devices?.remote).toEqual({ 'bus0.json': '{}' })
  })

  it('keeps devices/servers, which Edge nests under devices', () => {
    // This is the shape that used to fail the `devices` container whole — and the
    // tolerant branch then emptied it, taking the board configuration and the pin
    // mapping down with the servers, which the next save persisted as a deletion.
    const parsed = ApiProjectFilesSchema.parse({
      'project.json': '{}',
      devices: { 'configuration.json': '{"board":"uno"}', servers: { 'modbus.json': '{"port":502}' } },
    })

    expect(parsed.devices?.['configuration.json']).toBe('{"board":"uno"}')
    expect(parsed.devices?.servers).toEqual({ 'modbus.json': '{"port":502}' })
  })

  it('accepts the bare envelope a project that was never saved answers with, adding nothing', () => {
    // `GET /details` answers `files: {}` for a brand-new project. Rejecting that would
    // make the first save of every new project fail; inventing a `project.json` would
    // make the desktop post a key the web build does not.
    expect(ApiProjectFilesSchema.parse({})).toEqual({})
  })

  it.each([
    ['devices that is not an object', { devices: 'nope' }],
    ['a device file that is not a string', { devices: { 'configuration.json': { board: 'uno' } } }],
    ['a remote device that is not a string', { devices: { remote: { 'bus0.json': 5 } } }],
    ['pous that is not nested', { pous: { programs: 'PROGRAM main' } }],
    ['a project.json that is not a string', { 'project.json': { meta: {} } }],
  ])('FAILS on %s rather than emptying the container', (_label, files) => {
    // A malformed container used to be caught and replaced by `{}`. The project then
    // opened with defaults and the next save deleted every file the container had held.
    expect(ApiProjectFilesSchema.safeParse(files).success).toBe(false)
  })

  it('carries the optional containers through untouched', () => {
    const parsed = ApiProjectFilesSchema.parse({
      'project.json': '{}',
      'library.json': '{"lib":1}',
      devices: {},
      pous: {},
      datatypes: { 'colours.dt': 'TYPE' },
      servers: { 'modbus.json': '{}' },
      build: { 'lib.stlib': 'bytes' },
    })

    expect(parsed['library.json']).toBe('{"lib":1}')
    expect(parsed.datatypes).toEqual({ 'colours.dt': 'TYPE' })
    expect(parsed.servers).toEqual({ 'modbus.json': '{}' })
    expect(parsed.build).toEqual({ 'lib.stlib': 'bytes' })
  })

  it('carries the pending PLCopen marker, which is the whole signal for that flow', () => {
    const parsed = ApiProjectFilesSchema.parse({
      'project.json': '',
      'plcopen-pending-import.xml': '<project/>',
      devices: {},
      pous: {},
    })

    expect(parsed['plcopen-pending-import.xml']).toBe('<project/>')
  })

  it('survives a parse → patch → read round trip with servers in place', () => {
    const parsed = ApiProjectFilesSchema.parse({
      'project.json': '{}',
      devices: { 'configuration.json': '{}', servers: { 'modbus.json': '{"port":502}' } },
    })

    setInEnvelope(parsed, 'devices/servers/opcua.json', '{"port":4840}')

    expect(getInEnvelope(parsed, 'devices/servers/modbus.json')).toBe('{"port":502}')
    expect(getInEnvelope(parsed, 'devices/servers/opcua.json')).toBe('{"port":4840}')
    expect(getInEnvelope(parsed, 'devices/configuration.json')).toBe('{}')
  })
})

describe('apiFilesToRaw', () => {
  it('reads the servers from devices.servers', () => {
    const raw = apiFilesToRaw('p1', {
      'project.json': '{"meta":{}}',
      devices: devicesWith({ servers: { 'modbus.json': '{"port":502}' } }),
      pous: {},
    })

    expect(raw.serverFiles).toEqual([{ relativePath: 'devices/servers/modbus.json', content: '{"port":502}' }])
  })

  it('still reads the legacy top-level servers, letting the canonical slot win', () => {
    const raw = apiFilesToRaw('p1', {
      'project.json': '{}',
      devices: devicesWith({ servers: { 'modbus.json': 'NEW' } }),
      pous: {},
      servers: { 'modbus.json': 'OLD', 'opcua.json': 'LEGACY' },
    })

    expect(raw.serverFiles).toEqual([
      { relativePath: 'devices/servers/modbus.json', content: 'NEW' },
      { relativePath: 'devices/servers/opcua.json', content: 'LEGACY' },
    ])
  })

  it('reads a bare envelope into the documented sentinels', () => {
    const raw = apiFilesToRaw('p1', {})

    expect(raw).toEqual({
      projectPath: 'p1',
      projectJson: '',
      deviceConfig: '{}',
      pinMapping: '[]',
      libraryManifest: '',
      pouFiles: [],
      serverFiles: [],
      remoteDeviceFiles: [],
      dataTypeFiles: [],
      pendingPlcopenSource: undefined,
    })
  })

  it('walks every category', () => {
    const devices = devicesWith({ remote: { 'bus.json': 'RD' } })
    devices['configuration.json'] = 'DC'
    devices['pin-mapping.json'] = 'PM'

    const raw = apiFilesToRaw('p1', {
      'project.json': 'PJ',
      'library.json': 'LIB',
      'plcopen-pending-import.xml': '<x/>',
      devices,
      pous: { programs: { 'main.st': 'PG' } },
      datatypes: { 'Motor.dt': 'DT' },
    })

    expect(raw).toMatchObject({
      projectJson: 'PJ',
      libraryManifest: 'LIB',
      pendingPlcopenSource: '<x/>',
      deviceConfig: 'DC',
      pinMapping: 'PM',
      remoteDeviceFiles: [{ relativePath: 'devices/remote/bus.json', content: 'RD' }],
      pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'PG' }],
      dataTypeFiles: [{ relativePath: 'datatypes/Motor.dt', content: 'DT' }],
    })
  })
})
