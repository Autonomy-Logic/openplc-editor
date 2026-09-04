import { beforeEach, describe, expect, it } from '@jest/globals'

import { createDefaultSlaveConfig } from '../../../backend/shared/ethercat/device-config-defaults'
import { useOpenPLCStore } from '../index'

/**
 * Duplicating a server, a remote device or a global variable list.
 *
 * The tree offered Duplicate for all three and every one of them toasted "Only POU or
 * datatype files can be duplicated". These pin the behaviour they should have had:
 * the same shape as the POU and data type duplicates, plus the one thing those two
 * never had to think about — a remote device owns ids and IEC addresses, so a copy
 * that shared them would be a second claim rather than a duplicate.
 */
const resetProject = () => {
  useOpenPLCStore.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      dataTypes: [],
      globalVariableLists: [],
      pous: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  })
}

beforeEach(() => {
  resetProject()
})

describe('serverActions.duplicate', () => {
  it('copies the server under a new name', () => {
    useOpenPLCStore.getState().serverActions.create({ name: 'Srv', protocol: 'modbus-tcp' })

    const result = useOpenPLCStore.getState().serverActions.duplicate('Srv', 'Srv_copy')

    expect(result.ok).toBe(true)
    const names = useOpenPLCStore.getState().project.data.servers?.map((s) => s.name)
    expect(names).toEqual(['Srv', 'Srv_copy'])
  })

  it('registers the copy so it can be opened and saved', () => {
    useOpenPLCStore.getState().serverActions.create({ name: 'Srv', protocol: 'modbus-tcp' })
    useOpenPLCStore.getState().serverActions.duplicate('Srv', 'Srv_copy')

    const after = useOpenPLCStore.getState()
    expect(after.files['Srv_copy']).toBeDefined()
    // Persisted on the next save, like every other duplicate.
    expect(after.files['Srv_copy']?.saved).toBe(false)
  })

  it('does not share nested config with the original', () => {
    // A shallow copy would leave both servers pointing at one config object, so
    // editing the copy would silently edit the original.
    useOpenPLCStore.getState().serverActions.create({ name: 'Srv', protocol: 'modbus-tcp' })
    useOpenPLCStore.getState().serverActions.duplicate('Srv', 'Srv_copy')

    const servers = useOpenPLCStore.getState().project.data.servers ?? []
    const [original, copy] = servers
    expect(copy).not.toBe(original)
    for (const key of Object.keys(copy) as (keyof typeof copy)[]) {
      const value = copy[key]
      if (value !== null && typeof value === 'object') expect(value).not.toBe(original[key])
    }
  })

  it('refuses a name already taken', () => {
    useOpenPLCStore.getState().serverActions.create({ name: 'Srv', protocol: 'modbus-tcp' })
    useOpenPLCStore.getState().serverActions.create({ name: 'Other', protocol: 'modbus-tcp' })

    expect(useOpenPLCStore.getState().serverActions.duplicate('Srv', 'Other').ok).toBe(false)
  })

  it('reports a missing source instead of failing silently', () => {
    expect(useOpenPLCStore.getState().serverActions.duplicate('Nope', 'Nope_copy').ok).toBe(false)
  })
})

describe('remoteDeviceActions.duplicate', () => {
  const withModbusPoints = (name: string) => {
    const state = useOpenPLCStore.getState()
    state.remoteDeviceActions.create({ name, protocol: 'modbus-tcp' })
    const { project } = useOpenPLCStore.getState()
    state.projectActions.setProject({
      ...project,
      data: {
        ...project.data,
        remoteDevices: (project.data.remoteDevices ?? []).map((d) =>
          d.name === name
            ? {
                ...d,
                modbusTcpConfig: {
                  host: '127.0.0.1',
                  port: 502,
                  slaveId: 1,
                  timeout: 1000,
                  ioGroups: [
                    {
                      id: 'group-1',
                      name: 'Coils',
                      functionCode: '1' as const,
                      cycleTime: 100,
                      offset: '0',
                      length: 2,
                      errorHandling: 'keep-last-value' as const,
                      ioPoints: [{ id: 'point-1', name: 'P1', type: 'BOOL', iecLocation: '%IX0.0', alias: 'Pump' }],
                    },
                  ],
                },
              }
            : d,
        ),
      },
    })
  }

  it('copies the device under a new name', () => {
    withModbusPoints('Dev')

    expect(useOpenPLCStore.getState().remoteDeviceActions.duplicate('Dev', 'Dev_copy').ok).toBe(true)
    expect(useOpenPLCStore.getState().project.data.remoteDevices?.map((d) => d.name)).toEqual(['Dev', 'Dev_copy'])
  })

  it('gives the copy fresh ids, so editing it cannot land on the original', () => {
    withModbusPoints('Dev')
    useOpenPLCStore.getState().remoteDeviceActions.duplicate('Dev', 'Dev_copy')

    const devices = useOpenPLCStore.getState().project.data.remoteDevices ?? []
    const copy = devices.find((d) => d.name === 'Dev_copy')
    const group = copy?.modbusTcpConfig?.ioGroups[0]
    expect(group?.id).not.toBe('group-1')
    expect(group?.ioPoints?.[0].id).not.toBe('point-1')
  })

  it('starts the copy with no alias and no address', () => {
    // Aliases are unique system-wide and addresses are allocated from one pool, so a
    // copy carrying the original's would be a second claim on both.
    withModbusPoints('Dev')
    useOpenPLCStore.getState().remoteDeviceActions.duplicate('Dev', 'Dev_copy')

    const copy = (useOpenPLCStore.getState().project.data.remoteDevices ?? []).find((d) => d.name === 'Dev_copy')
    const point = copy?.modbusTcpConfig?.ioGroups[0].ioPoints?.[0]
    expect(point?.alias).toBeUndefined()
    expect(point?.iecLocation).toBe('')
  })

  it('keeps the settings the device was duplicated for', () => {
    withModbusPoints('Dev')
    useOpenPLCStore.getState().remoteDeviceActions.duplicate('Dev', 'Dev_copy')

    const copy = (useOpenPLCStore.getState().project.data.remoteDevices ?? []).find((d) => d.name === 'Dev_copy')
    expect(copy?.modbusTcpConfig?.port).toBe(502)
    expect(copy?.modbusTcpConfig?.ioGroups[0].name).toBe('Coils')
    expect(copy?.modbusTcpConfig?.ioGroups[0].ioPoints?.[0].name).toBe('P1')
  })

  it('leaves the original untouched', () => {
    withModbusPoints('Dev')
    useOpenPLCStore.getState().remoteDeviceActions.duplicate('Dev', 'Dev_copy')

    const original = (useOpenPLCStore.getState().project.data.remoteDevices ?? []).find((d) => d.name === 'Dev')
    const point = original?.modbusTcpConfig?.ioGroups[0].ioPoints?.[0]
    expect(point?.alias).toBe('Pump')
    expect(point?.iecLocation).toBe('%IX0.0')
  })

  it('refuses a name already taken', () => {
    withModbusPoints('Dev')
    useOpenPLCStore.getState().remoteDeviceActions.create({ name: 'Other', protocol: 'modbus-tcp' })

    expect(useOpenPLCStore.getState().remoteDeviceActions.duplicate('Dev', 'Other').ok).toBe(false)
  })
})

describe('remoteDeviceActions.duplicate — EtherCAT slaves', () => {
  const withSlaves = (name: string) => {
    const state = useOpenPLCStore.getState()
    state.remoteDeviceActions.create({ name, protocol: 'ethercat' })
    const { project } = useOpenPLCStore.getState()
    state.projectActions.setProject({
      ...project,
      data: {
        ...project.data,
        remoteDevices: (project.data.remoteDevices ?? []).map((d) =>
          d.name === name
            ? {
                ...d,
                ethercatConfig: {
                  devices: [
                    {
                      id: 'slave-1',
                      name: 'Coupler',
                      esiDeviceRef: { repositoryItemId: 'repo-1', deviceIndex: 0 },
                      vendorId: '0x2',
                      productCode: '0x3',
                      revisionNo: '0x1',
                      addedFrom: 'repository' as const,
                      config: createDefaultSlaveConfig(),
                      channelMappings: [{ channelId: 'ch1', iecLocation: '%IX1.0', alias: 'CouplerIn' }],
                    },
                  ],
                },
              }
            : d,
        ),
      },
    })
  }

  it('renames the duplicated slaves so they do not share a key', () => {
    // A slave's NAME keys its tab, editor model and file entry — not its id — so two
    // slaves sharing one means the second takes over the first's entries.
    withSlaves('Bus')

    expect(useOpenPLCStore.getState().remoteDeviceActions.duplicate('Bus', 'Bus_copy').ok).toBe(true)

    const devices = useOpenPLCStore.getState().project.data.remoteDevices ?? []
    const names = devices.flatMap((d) => (d.ethercatConfig?.devices ?? []).map((s) => s.name))
    expect(names).toEqual(['Coupler', 'Coupler_01'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('still gives the duplicated slave a fresh id and no bindings', () => {
    withSlaves('Bus')
    useOpenPLCStore.getState().remoteDeviceActions.duplicate('Bus', 'Bus_copy')

    const copy = (useOpenPLCStore.getState().project.data.remoteDevices ?? []).find((d) => d.name === 'Bus_copy')
    const slave = copy?.ethercatConfig?.devices[0]
    expect(slave?.id).not.toBe('slave-1')
    expect(slave?.channelMappings[0].iecLocation).toBe('')
    expect(slave?.channelMappings[0].alias).toBeUndefined()
  })

  it('leaves the original slave name alone', () => {
    withSlaves('Bus')
    useOpenPLCStore.getState().remoteDeviceActions.duplicate('Bus', 'Bus_copy')

    const original = (useOpenPLCStore.getState().project.data.remoteDevices ?? []).find((d) => d.name === 'Bus')
    expect(original?.ethercatConfig?.devices[0].name).toBe('Coupler')
    expect(original?.ethercatConfig?.devices[0].channelMappings[0].alias).toBe('CouplerIn')
  })
})

describe('globalVariableListActions.duplicate', () => {
  const listWithMember = (name: string) => {
    const state = useOpenPLCStore.getState()
    state.globalVariableListActions.create(name)
    state.projectActions.updateGlobalVariableList(name, [
      {
        name: 'Output1',
        class: 'global' as const,
        type: { definition: 'base-type' as const, value: 'BOOL' },
        location: '%QX0.0',
        initialValue: '',
        documentation: '',
      },
    ])
    state.projectActions.updateGlobalVariableListQualifier(name, 'CONSTANT')
  }

  it('copies the members and the qualifier', () => {
    listWithMember('GVL')

    expect(useOpenPLCStore.getState().globalVariableListActions.duplicate('GVL', 'GVL_copy').ok).toBe(true)

    const copy = (useOpenPLCStore.getState().project.data.globalVariableLists ?? []).find((l) => l.name === 'GVL_copy')
    expect(copy?.variables.map((v) => v.name)).toEqual(['Output1'])
    expect(copy?.qualifier).toBe('CONSTANT')
  })

  it('registers the copy so it can be opened and saved', () => {
    listWithMember('GVL')
    useOpenPLCStore.getState().globalVariableListActions.duplicate('GVL', 'GVL_copy')

    expect(useOpenPLCStore.getState().files['GVL_copy']?.saved).toBe(false)
  })

  it('refuses a name that collides across the namespace', () => {
    listWithMember('GVL')
    const { project } = useOpenPLCStore.getState()
    useOpenPLCStore.getState().projectActions.setProject({
      ...project,
      data: { ...project.data, dataTypes: [{ name: 'Taken', derivation: 'structure', variable: [] }] },
    })

    expect(useOpenPLCStore.getState().globalVariableListActions.duplicate('GVL', 'Taken').ok).toBe(false)
  })

  it('does not share member objects with the original', () => {
    listWithMember('GVL')
    useOpenPLCStore.getState().globalVariableListActions.duplicate('GVL', 'GVL_copy')

    const lists = useOpenPLCStore.getState().project.data.globalVariableLists ?? []
    const original = lists.find((l) => l.name === 'GVL')
    const copy = lists.find((l) => l.name === 'GVL_copy')
    expect(copy?.variables[0]).not.toBe(original?.variables[0])
  })

  it('carries documentation and preserved unparsed text into the copy', () => {
    // The duplicate clones the whole record for this reason: copying field by field is
    // what dropped both of these, the same omission already fixed once in reconcile.
    listWithMember('GVL')
    const { project } = useOpenPLCStore.getState()
    useOpenPLCStore.getState().projectActions.setProject({
      ...project,
      data: {
        ...project.data,
        globalVariableLists: (project.data.globalVariableLists ?? []).map((l) =>
          l.name === 'GVL'
            ? { ...l, documentation: 'why this list exists', text: 'VAR_GLOBAL\n  Half : \nEND_VAR\n' }
            : l,
        ),
      },
    })

    useOpenPLCStore.getState().globalVariableListActions.duplicate('GVL', 'GVL_copy')

    const copy = (useOpenPLCStore.getState().project.data.globalVariableLists ?? []).find((l) => l.name === 'GVL_copy')
    expect(copy?.documentation).toBe('why this list exists')
    expect(copy?.text).toBe('VAR_GLOBAL\n  Half : \nEND_VAR\n')
  })

  it('reports a missing source instead of failing silently', () => {
    expect(useOpenPLCStore.getState().globalVariableListActions.duplicate('Nope', 'Nope_copy').ok).toBe(false)
  })
})

/**
 * Duplicating a POU.
 *
 * `libraries.user` is what backs the "User-defined POUs" explorer tree, the FBD/LD
 * block pickers and Monaco's completion list. The create path registered the new POU
 * there; the duplicate path did not, so a duplicated function block existed in the
 * project but could not be placed in a diagram or completed in ST (DOPE-606).
 */
describe('pouActions.duplicate', () => {
  it('copies the POU under a new name', () => {
    useOpenPLCStore.getState().pouActions.create({ type: 'function-block', name: 'SetBit', language: 'st' })

    const result = useOpenPLCStore.getState().pouActions.duplicate('SetBit', 'SetBit_copy')

    expect(result.ok).toBe(true)
    const names = useOpenPLCStore.getState().project.data.pous.map((p) => p.name)
    expect(names).toEqual(['SetBit', 'SetBit_copy'])
  })

  it('registers the copy as a user library so it can be placed and completed', () => {
    useOpenPLCStore.getState().pouActions.create({ type: 'function-block', name: 'SetBit', language: 'st' })
    useOpenPLCStore.getState().pouActions.duplicate('SetBit', 'SetBit_copy')

    const userLibraries = useOpenPLCStore.getState().libraries.user
    expect(userLibraries.map((l) => l.name)).toContain('SetBit_copy')
    expect(userLibraries.find((l) => l.name === 'SetBit_copy')?.type).toBe('function-block')
  })

  it('registers a duplicated function as a function', () => {
    // Not `Scale`: the test harness seeds the real bundled libraries, and SCALE is a
    // function in oscat-basic and plcopen-softmotion, so the create is refused.
    useOpenPLCStore.getState().pouActions.create({ type: 'function', name: 'Scaler', language: 'st' })
    useOpenPLCStore.getState().pouActions.duplicate('Scaler', 'Scaler_copy')

    expect(useOpenPLCStore.getState().libraries.user.find((l) => l.name === 'Scaler_copy')?.type).toBe('function')
  })

  it('does not register a duplicated program as a library block', () => {
    // A program is instantiated by the Resource, never called from another POU,
    // so it is not a library block. Registering it put programs in the block
    // pickers, and project load drops them again, so a placed one referenced a
    // library entry that no longer existed after a reopen.
    useOpenPLCStore.getState().pouActions.create({ type: 'program', name: 'main', language: 'st' })
    useOpenPLCStore.getState().pouActions.duplicate('main', 'main_copy')

    const names = useOpenPLCStore.getState().libraries.user.map((l) => l.name)
    expect(names).not.toContain('main_copy')
    // The create path agrees, so a reopen cannot disagree with either.
    expect(names).not.toContain('main')
  })

  it('still copies a duplicated program into the project', () => {
    // Excluding it from the library must not stop the duplicate itself.
    useOpenPLCStore.getState().pouActions.create({ type: 'program', name: 'main', language: 'st' })
    useOpenPLCStore.getState().pouActions.duplicate('main', 'main_copy')

    expect(useOpenPLCStore.getState().project.data.pous.map((p) => p.name)).toContain('main_copy')
  })

  it('registers the copy so it can be opened and saved', () => {
    useOpenPLCStore.getState().pouActions.create({ type: 'function-block', name: 'SetBit', language: 'st' })
    useOpenPLCStore.getState().pouActions.duplicate('SetBit', 'SetBit_copy')

    const after = useOpenPLCStore.getState()
    expect(after.files['SetBit_copy']).toBeDefined()
    expect(after.files['SetBit_copy']?.saved).toBe(false)
  })

  it('reports a missing source instead of failing silently', () => {
    expect(useOpenPLCStore.getState().pouActions.duplicate('Nope', 'Nope_copy').ok).toBe(false)
  })
})
