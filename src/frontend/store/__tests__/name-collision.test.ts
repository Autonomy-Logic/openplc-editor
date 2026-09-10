import { beforeEach, describe, expect, it } from '@jest/globals'

import { useOpenPLCStore } from '../index'
import { elementNameCollision, type NamedElementKind, newGlobalNameCollision } from '../slices/shared/name-collision'

/**
 * The gate on the real store, so the bundled library archives the test shim
 * seeds are in play. One element of each kind, then every kind asks for every
 * other kind's name.
 */
const seed = () => {
  useOpenPLCStore.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      dataTypes: [{ name: 'Speed', derivation: 'enumerated', values: [{ description: 'SLOW' }], initialValue: 'SLOW' }],
      globalVariableLists: [{ name: 'Plant', variables: [] }],
      pous: [{ name: 'Main', pouType: 'program', body: { language: 'st', value: '' }, interface: { variables: [] } }],
      configurations: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [
            {
              name: 'Setpoint',
              class: 'global',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
            },
          ],
        },
      },
      servers: [{ name: 'Modbus', protocol: 'modbus-tcp' }],
      remoteDevices: [
        { name: 'Drive', protocol: 'modbus-tcp' },
        {
          name: 'Bus',
          protocol: 'ethercat',
          ethercatConfig: {
            masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000, watchdogTimeoutCycles: 3 },
            devices: [{ id: 'slave-1', name: 'Axis1' }] as never,
          },
        },
      ],
      libraries: [],
    },
  })
  useOpenPLCStore.getState().projectActions.setUnparsedDataTypeFiles([])
}

const gate = (name: string, kind: NamedElementKind, ignoring?: string) =>
  elementNameCollision(useOpenPLCStore.getState(), name, kind, ignoring)

const KINDS: NamedElementKind[] = [
  'pou',
  'data-type',
  'global-variable-list',
  'server',
  'remote-device',
  'ethercat-slave',
  'resource-global',
]
const OWNER: Record<NamedElementKind, string> = {
  pou: 'Main',
  'data-type': 'Speed',
  'global-variable-list': 'Plant',
  server: 'Modbus',
  'remote-device': 'Drive',
  'ethercat-slave': 'Axis1',
  'resource-global': 'Setpoint',
}
const LABEL: Record<NamedElementKind, string> = {
  pou: 'a POU',
  'data-type': 'a data type',
  'global-variable-list': 'a global variable list',
  server: 'a server',
  'remote-device': 'a remote device',
  'ethercat-slave': 'an EtherCAT slave',
  'resource-global': 'a global variable',
}
// Compiler namespace: pou, data type, list, global. Workspace registry: pou, data type, list, server, device, slave.
const DISJOINT = new Set(['server:resource-global', 'remote-device:resource-global', 'ethercat-slave:resource-global'])
const shares = (a: NamedElementKind, b: NamedElementKind) => !DISJOINT.has(`${a}:${b}`) && !DISJOINT.has(`${b}:${a}`)

beforeEach(seed)

describe('elementNameCollision across kinds', () => {
  for (const kind of KINDS) {
    for (const owner of KINDS.filter((k) => k !== kind)) {
      const expected = shares(kind, owner)
        ? `"${OWNER[owner].toLowerCase()}" is already the name of ${LABEL[owner]}`
        : null
      it(`${kind} asking for the ${owner} name ${expected ? 'is refused' : 'is allowed'}`, () => {
        expect(gate(OWNER[owner].toLowerCase(), kind)).toBe(expected)
      })
    }
  }

  it('reports a same-kind duplicate with the message the forms already show', () => {
    expect(gate('main', 'pou')).toBe('POU name already exists')
    expect(gate('speed', 'data-type')).toBe('Data type name already exists')
    expect(gate('plant', 'global-variable-list')).toBe('Global variable list name already exists')
    expect(gate('modbus', 'server')).toBe('Server already exists')
    expect(gate('drive', 'remote-device')).toBe('Remote device already exists')
    expect(gate('axis1', 'ethercat-slave')).toBe('An EtherCAT slave named "axis1" already exists in this project')
  })

  it('leaves same-table duplicates of globals to the variables table', () => {
    expect(gate('setpoint', 'resource-global')).toBeNull()
  })

  it('accepts a free name for every kind', () => {
    for (const kind of KINDS) expect(gate('Fresh', kind)).toBeNull()
  })
})

describe('elementNameCollision and the element being renamed', () => {
  it('lets a file-owning kind keep its exact name and refuses a case-only rename', () => {
    expect(gate('Modbus', 'server', 'Modbus')).toBeNull()
    expect(gate('MODBUS', 'server', 'Modbus')).toBe('Server already exists')
    expect(gate('DRIVE', 'remote-device', 'Drive')).toBe('Remote device already exists')
  })

  it('lets a kind without a file rename case-only onto itself', () => {
    expect(gate('AXIS1', 'ethercat-slave', 'Axis1')).toBeNull()
    expect(gate('PLANT', 'global-variable-list', 'Plant')).toBeNull()
    expect(gate('SETPOINT', 'resource-global', 'Setpoint')).toBeNull()
  })

  it('still refuses a rename onto another element', () => {
    expect(gate('Main', 'server', 'Modbus')).toBe('"Main" is already the name of a POU')
    expect(gate('Speed', 'resource-global', 'Setpoint')).toBe('"Speed" is already the name of a data type')
  })
})

describe('elementNameCollision beyond the project elements', () => {
  it('refuses a library symbol for compiler-visible kinds only', () => {
    // SCALE is a function in oscat-basic; a server called that compiles fine.
    expect(gate('Scale', 'resource-global')).toMatch(/is a function in the .* library$/)
    expect(gate('Scale', 'pou')).toMatch(/is a function in the .* library$/)
    expect(gate('Scale', 'server')).toBeNull()
    expect(gate('Scale', 'remote-device')).toBeNull()
  })

  it("refuses an unreadable .dt file's name for workspace kinds only", () => {
    useOpenPLCStore
      .getState()
      .projectActions.setUnparsedDataTypeFiles([{ relativePath: 'datatypes/Broken.dt', content: 'TYPE' }])
    expect(gate('broken', 'server')).toMatch(/could not be read/)
    expect(gate('broken', 'ethercat-slave')).toMatch(/could not be read/)
    expect(gate('broken', 'pou')).toMatch(/could not be read/)
    expect(gate('broken', 'resource-global')).toBeNull()
  })

  it("refuses a list's type name for compiler-visible kinds", () => {
    expect(gate('Plant_TYPE', 'pou')).toBe('"Plant_TYPE" is the type name of global variable list "Plant"')
    expect(gate('Plant_TYPE', 'resource-global')).toBe('"Plant_TYPE" is the type name of global variable list "Plant"')
    expect(gate('Plant_TYPE', 'server')).toBeNull()
  })

  it('keeps the derived-name rules for a new list', () => {
    expect(gate('Speed', 'global-variable-list')).toBe('"Speed" is already the name of a data type')
    useOpenPLCStore.getState().projectActions.setProject({
      ...useOpenPLCStore.getState().project,
      data: {
        ...useOpenPLCStore.getState().project.data,
        dataTypes: [{ name: 'Tank_TYPE', derivation: 'enumerated', values: [{ description: 'A' }], initialValue: 'A' }],
      },
    })
    expect(gate('Tank', 'global-variable-list')).toBe(
      '"Tank" needs the type name "Tank_TYPE", which a data type already uses',
    )
  })

  it('refuses the list/global pair on the derived name whichever is created first', () => {
    expect(gate('Plant_TYPE', 'resource-global')).toBe('"Plant_TYPE" is the type name of global variable list "Plant"')
    holdGlobals('Tank_TYPE')
    expect(gate('Tank', 'global-variable-list')).toBe(
      '"Tank" needs the type name "Tank_TYPE", which a global variable already uses',
    )
  })

  it('does not stand in the way of opening a project that already carries a collision', () => {
    const { project } = useOpenPLCStore.getState()
    useOpenPLCStore.getState().projectActions.setProject({
      ...project,
      data: { ...project.data, servers: [{ name: 'Plant', protocol: 'modbus-tcp' }] },
    })
    const { data } = useOpenPLCStore.getState().project
    expect(data.servers?.map((s) => s.name)).toEqual(['Plant'])
    expect(data.globalVariableLists?.map((l) => l.name)).toEqual(['Plant'])
    expect(gate('Plant', 'server')).toBe('Server already exists')
  })
})

const holdGlobals = (...names: string[]) =>
  useOpenPLCStore.getState().projectActions.setGlobalVariables({
    variables: names.map((name) => ({
      name,
      class: 'global' as const,
      type: { definition: 'base-type' as const, value: 'INT' },
      location: '',
      documentation: '',
    })),
  })

describe('newGlobalNameCollision, the code view commit gate', () => {
  const check = (...names: string[]) => newGlobalNameCollision(useOpenPLCStore.getState(), names)

  it('leaves names the table already holds alone, even ones the gate would refuse today', () => {
    holdGlobals('Scale')
    expect(gate('Scale', 'resource-global')).not.toBeNull()
    expect(check('Scale', 'Level')).toBeNull()
  })

  it('gates only the names a commit introduces', () => {
    holdGlobals('Scale')
    expect(check('Scale', 'Main')).toBe('"Main" is already the name of a POU')
  })

  it('matches held names case-insensitively', () => {
    holdGlobals('Scale')
    expect(check('SCALE')).toBeNull()
  })

  it('accepts a commit that only renames onto free names', () => {
    expect(check('Setpoint', 'Level')).toBeNull()
  })
})
