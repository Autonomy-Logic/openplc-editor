import { createStore } from 'zustand/vanilla'

import type {
  BoardInfo,
  ModbusIOGroup,
  PLCPou,
  PLCRemoteDevice,
  PLCVariable,
} from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice } from '../slices/device'
import { createEditorSlice } from '../slices/editor'
import { createLibrarySlice } from '../slices/library'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot } from '../slices/project/types'

/**
 * Board-load contract under the single-field variable-location model.
 *
 * Replaces the old `syncVariableAliases` auto-adoption integration test: that
 * suite asserted boards landing (`setAvailableOptions`) would ADOPT a
 * producer's alias onto a variable that happened to sit at the same address.
 * The single-field model deliberately drops that behaviour — a manual `%addr`
 * is always manual, and an alias binding lives verbatim in `location`,
 * resolved to a concrete address only at compile time. This file locks in the
 * new contract:
 *   - board-load (`setAvailableOptions`) never mutates a variable's `location`;
 *   - a manual literal that collides with an alias's address stays literal;
 *   - an alias-bound `location` keeps the alias name in the store and resolves
 *     to the producer's address in the compile-ready snapshot (or to '' when
 *     the alias is no longer declared).
 */

function makeStore() {
  return createStore<ProjectSliceRoot>()((...args) => ({
    ...createProjectSlice(...args),
    ...createDeviceSlice(...args),
    ...createConsoleSlice(...args),
    ...createEditorSlice(...args),
    ...createLibrarySlice(...args),
  }))
}

const RUNTIME_V4: BoardInfo = {
  compiler: 'openplc-compiler',
  core: 'rt-v4',
  preview: '',
  specs: {},
  capabilities: {
    pinMapping: false,
    vppIo: false,
    modbusTcpRemote: true,
    ethercat: true,
    modbusTcpServer: true,
    opcuaServer: true,
    s7Server: true,
    debuggerTransports: ['websocket'],
    pythonFunctionBlocks: true,
    arduinoApiCompletions: false,
    hasRuntimeStats: true,
    isInProcessSimulator: false,
    directUsbUpload: false,
  },
}

/** Land the Runtime v4 board — the project-load "boards resolve" moment that
 *  used to trigger the alias auto-sync. */
function landBoards(store: ReturnType<typeof makeStore>) {
  store.getState().deviceActions.setAvailableOptions({
    availableBoards: new Map<string, BoardInfo>([['OpenPLC Runtime v4', RUNTIME_V4]]),
  })
  store.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')
}

function makeRemoteDevice(name: string): PLCRemoteDevice {
  return {
    name,
    protocol: 'modbus-tcp',
    modbusTcpConfig: { host: '127.0.0.1', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] },
  }
}

function makeIOGroup(id: string, functionCode: ModbusIOGroup['functionCode'] = '3', length = 2): ModbusIOGroup {
  return {
    id,
    name: `group-${id}`,
    functionCode,
    cycleTime: 100,
    offset: '0',
    length,
    errorHandling: 'keep-last-value',
    ioPoints: [],
  }
}

function intVar(name: string, location: string): PLCVariable {
  return { name, class: 'local', type: { definition: 'base-type', value: 'INT' }, location, documentation: '' }
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

/** Add a remote device to the store without clobbering the rest of the project. */
function addRemoteDevice(store: ReturnType<typeof makeStore>, device: PLCRemoteDevice) {
  const current = store.getState().project
  store.setState({
    project: { ...current, data: { ...current.data, remoteDevices: [...(current.data.remoteDevices ?? []), device] } },
  })
}

/** Replace the project's POUs, preserving remoteDevices/config. */
function setPous(store: ReturnType<typeof makeStore>, pous: PLCPou[]) {
  const current = store.getState().project
  store.setState({ project: { ...current, data: { ...current.data, pous } } })
}

/** Stand up a Modbus remote device whose first point (%IW0) is aliased "flow". */
function seedAliasedModbusPoint(store: ReturnType<typeof makeStore>): void {
  addRemoteDevice(store, makeRemoteDevice('Dev1'))
  store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2)) // %IW0, %IW1
  const pointId = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
  store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', pointId, 'flow') // flow → %IW0
}

describe('alias location on board load (single-field model)', () => {
  it('does NOT auto-adopt an alias onto a manually located variable when boards (re-)land', () => {
    const store = makeStore()
    landBoards(store)
    seedAliasedModbusPoint(store) // "flow" is a live alias at %IW0
    setPous(store, [pou('main', [intVar('reading', '%IW0')])]) // variable manually located at that same address

    // Re-land boards: the project-load resolve point that used to auto-sync.
    landBoards(store)

    // New contract: the manual literal is untouched — never promoted to "flow".
    expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('%IW0')
  })

  it('keeps an alias-bound location verbatim in the store and resolves it at compile time', () => {
    const store = makeStore()
    landBoards(store)
    seedAliasedModbusPoint(store)
    setPous(store, [pou('main', [intVar('reading', 'flow')])]) // bound by alias name

    landBoards(store)

    // The store holds the alias name verbatim (no mutation on board-load)...
    expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('flow')
    // ...and the compile-ready snapshot resolves it to the producer's address.
    const compileReady = store.getState().projectActions.getCompileReadyProjectData()
    expect(compileReady.pous[0].interface!.variables![0].location).toBe('%IW0')
  })

  it('resolves an alias-bound location to empty at compile time when no producer declares it', () => {
    const store = makeStore()
    landBoards(store)
    seedAliasedModbusPoint(store) // only "flow" exists; "ghost" does not
    setPous(store, [pou('main', [intVar('reading', 'ghost')])])

    landBoards(store)

    // Store keeps the (orphaned) alias name; compile resolution drops it to unlocated.
    expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('ghost')
    const compileReady = store.getState().projectActions.getCompileReadyProjectData()
    expect(compileReady.pous[0].interface!.variables![0].location).toBe('')
  })
})
