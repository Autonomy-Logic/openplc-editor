/**
 * Tests for the Edge API envelope helpers.
 *
 * These functions own the web-only path↔slot mapping.  Both the
 * full-project saveProject path (`envelopeFromWriteProjectFiles` ->
 * POST) and the single-file saveFile path (`getInEnvelope` /
 * `setInEnvelope` for load-patch-save) dispatch through them, so
 * the same cases must round-trip cleanly in both directions.
 */

import type { WriteProjectFiles } from '../../../../middleware/shared/ports/project-port'
import { type ApiProjectFiles, envelopeFromWriteProjectFiles, getInEnvelope, setInEnvelope } from '../api-envelope'

function makeEnvelope(overrides?: Partial<ApiProjectFiles>): ApiProjectFiles {
  return {
    'project.json': '{}',
    devices: {} as ApiProjectFiles['devices'],
    pous: {},
    ...overrides,
  }
}

/**
 * `devices` is a flat map of file contents that also carries one nested slot,
 * and no object literal satisfies both at once: the index signature demands a
 * string for every key while `remote` is a map. Filling the slot after the fact
 * builds the value the API actually sends without loosening the type.
 */
const devicesWithRemote = (remote: Record<string, string>): ApiProjectFiles['devices'] => {
  const devices: ApiProjectFiles['devices'] = {}
  devices.remote = remote
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
      devices: { 'configuration.json': '{"board":"uno"}' } as ApiProjectFiles['devices'],
    })
    expect(getInEnvelope(env, 'devices/configuration.json')).toBe('{"board":"uno"}')
  })

  it('reads devices/pin-mapping.json from envelope.devices', () => {
    const env = makeEnvelope({
      devices: { 'pin-mapping.json': '[]' } as ApiProjectFiles['devices'],
    })
    expect(getInEnvelope(env, 'devices/pin-mapping.json')).toBe('[]')
  })

  it('reads devices/remote/* from envelope.devices.remote', () => {
    const env = makeEnvelope({
      devices: devicesWithRemote({ 'bus0.json': '{"id":0}' }),
    })
    expect(getInEnvelope(env, 'devices/remote/bus0.json')).toBe('{"id":0}')
  })

  it('reads devices/servers/* from envelope.servers', () => {
    const env = makeEnvelope({ servers: { 'modbus.json': '{"port":502}' } })
    expect(getInEnvelope(env, 'devices/servers/modbus.json')).toBe('{"port":502}')
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
    expect(env.devices['configuration.json']).toBe('{"board":"uno"}')
  })

  it('writes devices/pin-mapping.json', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'devices/pin-mapping.json', '[]')
    expect(env.devices['pin-mapping.json']).toBe('[]')
  })

  it('lazily initialises devices.remote container when writing first remote device', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'devices/remote/bus0.json', '{"id":0}')
    expect(env.devices.remote).toEqual({ 'bus0.json': '{"id":0}' })
  })

  it('appends to existing devices.remote', () => {
    const env = makeEnvelope({
      devices: devicesWithRemote({ 'bus0.json': '{"id":0}' }),
    })
    setInEnvelope(env, 'devices/remote/bus1.json', '{"id":1}')
    expect(env.devices.remote).toEqual({ 'bus0.json': '{"id":0}', 'bus1.json': '{"id":1}' })
  })

  it('lazily initialises envelope.servers container when writing first server', () => {
    const env = makeEnvelope()
    setInEnvelope(env, 'devices/servers/modbus.json', '{"port":502}')
    expect(env.servers).toEqual({ 'modbus.json': '{"port":502}' })
  })

  it('appends to existing envelope.servers', () => {
    const env = makeEnvelope({ servers: { 'modbus.json': '{"port":502}' } })
    setInEnvelope(env, 'devices/servers/opcua.json', '{"port":4840}')
    expect(env.servers).toEqual({ 'modbus.json': '{"port":502}', 'opcua.json': '{"port":4840}' })
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
  /** `files: {}` — no containers at all, as the API sends it. */
  function emptyEnvelope(): ApiProjectFiles {
    return {} as unknown as ApiProjectFiles
  }

  it('writes a POU without a pous container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'pous/programs/main.st', 'PROGRAM main END_PROGRAM')

    expect(env.pous).toEqual({ programs: { 'main.st': 'PROGRAM main END_PROGRAM' } })
  })

  it('writes the device config without a devices container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'devices/configuration.json', '{"board":"uno"}')

    expect(env.devices['configuration.json']).toBe('{"board":"uno"}')
  })

  it('writes the pin mapping without a devices container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'devices/pin-mapping.json', '[]')

    expect(env.devices['pin-mapping.json']).toBe('[]')
  })

  it('writes a remote device without a devices container', () => {
    const env = emptyEnvelope()

    setInEnvelope(env, 'devices/remote/bus0.json', '{"id":0}')

    expect(env.devices.remote).toEqual({ 'bus0.json': '{"id":0}' })
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

  it('PLC project: emits project.json, devices.configuration, devices.pin-mapping, pous, servers', () => {
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
      },
      pous: { programs: { 'main.st': 'PROGRAM main' } },
      servers: { 'modbus.json': '{"port":502}' },
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
