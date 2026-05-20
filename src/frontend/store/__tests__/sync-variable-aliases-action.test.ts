import { createStore } from 'zustand/vanilla'

import type { BoardInfo, PLCPou, PLCRemoteDevice, PLCVariable } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice } from '../slices/device'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot } from '../slices/project/types'

/**
 * Integration tests for projectActions.syncVariableAliases — the
 * store-level wiring that the pure `syncVariableAliases` function
 * sits behind. Pure-function tests already cover adoption / refresh /
 * orphan; this file asserts that the action correctly assembles the
 * pool from cross-slice state, honours target capabilities, surfaces
 * conflicts, and updates POU + global variables atomically.
 */

function makeStore() {
  return createStore<ProjectSliceRoot>()((...args) => ({
    ...createProjectSlice(...args),
    ...createDeviceSlice(...args),
    ...createConsoleSlice(...args),
  }))
}

const VPP_V4: BoardInfo = {
  compiler: 'openplc-compiler',
  core: 'rt-v4',
  preview: '',
  specs: {},
  capabilities: { vppIo: true },
  // Note: the `vpp` metadata block is optional on BoardInfo — only
  // its presence matters for the legacy compiler-string fallback.
  // The explicit capabilities block above is what drives the
  // resolver here.
}

const ARDUINO_BOARD: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'avr',
  preview: '',
  specs: {},
}

function variable(name: string, location: string, alias?: string): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'base-type', value: 'BOOL' },
    location,
    documentation: '',
    ...(alias ? { alias } : {}),
  }
}

function pou(name: string, vars: PLCVariable[]): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: vars },
    body: { language: 'st', value: '' },
    documentation: '',
  }
}

function withVppEntries(entries: Array<{ slot: number; channelName: string; iecAddress: string; alias?: string }>) {
  return {
    'io-mapping': {
      entries: entries.map((e) => ({
        slot: e.slot,
        moduleId: 'm',
        moduleName: 'M',
        channelName: e.channelName,
        channelType: 'digitalOutput',
        dataType: 'BOOL',
        iecAddress: e.iecAddress,
        alias: e.alias ?? '',
      })),
    },
  }
}

function seedProject(store: ReturnType<typeof makeStore>, pous: PLCPou[], globals: PLCVariable[] = []) {
  const current = store.getState().project
  store.setState({
    project: {
      ...current,
      data: {
        ...current.data,
        pous,
        configurations: {
          ...current.data.configurations,
          resource: {
            ...current.data.configurations.resource,
            globalVariables: globals,
          },
        },
      },
    },
  })
}

function seedRemoteDevices(store: ReturnType<typeof makeStore>, remoteDevices: PLCRemoteDevice[]) {
  const current = store.getState().project
  store.setState({
    project: {
      ...current,
      data: { ...current.data, remoteDevices },
    },
  })
}

function seedBoard(store: ReturnType<typeof makeStore>, boardName: string, boardInfo: BoardInfo) {
  store.getState().deviceActions.setAvailableOptions({
    availableBoards: new Map<string, BoardInfo>([[boardName, boardInfo]]),
  })
  store.getState().deviceActions.setDeviceBoard(boardName)
}

function seedVendorScreenData(store: ReturnType<typeof makeStore>, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    store.getState().deviceActions.setVendorScreenData(k, v as Record<string, unknown>)
  }
}

describe('projectActions.syncVariableAliases (store integration)', () => {
  it('adopts aliases from VPP entries on first sync (project-load self-upgrade path)', () => {
    const store = makeStore()
    seedBoard(store, 'SLM-RP4', VPP_V4)
    seedVendorScreenData(
      store,
      withVppEntries([
        { slot: 1, channelName: 'DO1', iecAddress: '%QX0.0', alias: 'conveyor_motor' },
      ]),
    )
    seedProject(store, [pou('main', [variable('motor', '%QX0.0')])])

    const report = store.getState().projectActions.syncVariableAliases()
    expect(report).toEqual({ adopted: 1, refreshed: 0, orphaned: 0 })

    const vars = store.getState().project.data.pous[0].interface!.variables
    expect(vars[0].alias).toBe('conveyor_motor')
    expect(vars[0].location).toBe('%QX0.0')
  })

  it('refreshes the variable location when the alias has moved', () => {
    const store = makeStore()
    seedBoard(store, 'SLM-RP4', VPP_V4)
    // Alias now points to a different address than the variable carries.
    seedVendorScreenData(
      store,
      withVppEntries([{ slot: 3, channelName: 'DO1', iecAddress: '%QX1.5', alias: 'conveyor_motor' }]),
    )
    seedProject(store, [pou('main', [variable('motor', '%QX0.0', 'conveyor_motor')])])

    const report = store.getState().projectActions.syncVariableAliases()
    expect(report).toEqual({ adopted: 0, refreshed: 1, orphaned: 0 })

    const vars = store.getState().project.data.pous[0].interface!.variables
    expect(vars[0].location).toBe('%QX1.5')
    expect(vars[0].alias).toBe('conveyor_motor')
  })

  it('reports orphans when the producer no longer exposes the alias', () => {
    const store = makeStore()
    seedBoard(store, 'SLM-RP4', VPP_V4)
    seedVendorScreenData(store, withVppEntries([])) // no VPP entries at all
    seedProject(store, [pou('main', [variable('motor', '%QX0.0', 'conveyor_motor')])])

    const report = store.getState().projectActions.syncVariableAliases()
    expect(report.orphaned).toBe(1)

    // Variable kept as-is so the user can re-bind manually.
    const vars = store.getState().project.data.pous[0].interface!.variables
    expect(vars[0].alias).toBe('conveyor_motor')
    expect(vars[0].location).toBe('%QX0.0')
  })

  it('honours target capabilities: switching to an arduino board orphans VPP-bound aliases', () => {
    const store = makeStore()
    store.getState().deviceActions.setAvailableOptions({
      availableBoards: new Map<string, BoardInfo>([
        ['SLM-RP4', VPP_V4],
        ['Arduino Mega', ARDUINO_BOARD],
      ]),
    })
    store.getState().deviceActions.setDeviceBoard('SLM-RP4')
    seedVendorScreenData(
      store,
      withVppEntries([{ slot: 1, channelName: 'DO1', iecAddress: '%QX0.0', alias: 'motor' }]),
    )
    seedProject(store, [pou('main', [variable('motor', '%QX0.0', 'motor')])])

    // On VPP-capable target the alias resolves.
    let report = store.getState().projectActions.syncVariableAliases()
    expect(report.orphaned).toBe(0)

    // Switch to Arduino — VPP capability is off, so the registry
    // no longer carries the alias.
    store.getState().deviceActions.setDeviceBoard('Arduino Mega')
    report = store.getState().projectActions.syncVariableAliases()
    expect(report.orphaned).toBe(1)
  })

  it('ignoreCapabilities bypasses target gating (project-load callers use this)', () => {
    const store = makeStore()
    seedBoard(store, 'Arduino Mega', ARDUINO_BOARD) // VPP NOT in caps
    seedVendorScreenData(
      store,
      withVppEntries([{ slot: 1, channelName: 'DO1', iecAddress: '%QX0.0', alias: 'motor' }]),
    )
    seedProject(store, [pou('main', [variable('motor', '%QX0.0')])])

    // Without bypass, the Arduino-target pool has no VPP claims and
    // no aliases get adopted.
    expect(store.getState().projectActions.syncVariableAliases()).toEqual({
      adopted: 0,
      refreshed: 0,
      orphaned: 0,
    })

    // With bypass (the load-time callsite) the alias IS adopted
    // despite VPP being off on the active target.
    const report = store.getState().projectActions.syncVariableAliases({ ignoreCapabilities: true })
    expect(report.adopted).toBe(1)
  })

  it('syncs POU-local and global variables in the same call', () => {
    const store = makeStore()
    seedBoard(store, 'SLM-RP4', VPP_V4)
    seedVendorScreenData(
      store,
      withVppEntries([
        { slot: 1, channelName: 'DO1', iecAddress: '%QX0.0', alias: 'motor' },
        { slot: 1, channelName: 'DO2', iecAddress: '%QX0.1', alias: 'valve' },
      ]),
    )
    seedProject(
      store,
      [pou('main', [variable('motor_var', '%QX0.0')])],
      [variable('valve_var', '%QX0.1')],
    )

    const report = store.getState().projectActions.syncVariableAliases()
    expect(report.adopted).toBe(2)

    expect(store.getState().project.data.pous[0].interface!.variables[0].alias).toBe('motor')
    expect(store.getState().project.data.configurations.resource.globalVariables[0].alias).toBe('valve')
  })

  it('surfaces pool conflicts via the console slice', () => {
    const store = makeStore()
    seedBoard(store, 'SLM-RP4', VPP_V4)
    seedVendorScreenData(
      store,
      withVppEntries([
        { slot: 1, channelName: 'DO1', iecAddress: '%QX0.0', alias: 'a' },
      ]),
    )

    // Inject a second producer claiming the same address — would only
    // happen if a project file was hand-edited. Both pin-mapping AND
    // VPP claim %QX0.0. Pin-mapping wins (reservation pass first);
    // VPP entry's source loses → conflict reported.
    const remoteDevices: PLCRemoteDevice[] = [
      {
        name: 'd',
        protocol: 'modbus-tcp',
        modbusTcpConfig: {
          timeout: 1000,
          ioGroups: [
            {
              id: 'g',
              name: 'g',
              functionCode: '5',
              cycleTime: 100,
              offset: '0',
              length: 1,
              errorHandling: 'keep-last-value',
              ioPoints: [{ id: 'p', name: 'p', type: '', iecLocation: '%QX0.0', alias: 'conflict' }],
            },
          ],
        },
      },
    ]
    seedProject(store, [])
    seedRemoteDevices(store, remoteDevices)

    store.getState().projectActions.syncVariableAliases()
    const logs = store.getState().logs
    expect(logs.some((log) => log.message.includes('Address pool reports'))).toBe(true)
  })
})
