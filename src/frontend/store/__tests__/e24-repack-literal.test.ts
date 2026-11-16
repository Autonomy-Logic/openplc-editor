/**
 * Bench case E24 — a literal location does not follow a repack.
 *
 * Two variables over the SAME channel: one bound by alias, one written as a
 * literal. A new producer arrives and triggers the repack. The contrast
 * between them is the evidence: if both follow, the model changed; if neither
 * does, the repack never ran and the scenario proved nothing.
 */
import { createStore } from 'zustand/vanilla'

import type { BoardInfo, ModbusIOGroup, PLCRemoteDevice, PLCVariable } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice } from '../slices/device'
import { createEditorSlice } from '../slices/editor'
import { createLibrarySlice } from '../slices/library'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot } from '../slices/project/types'

const makeStore = () =>
  createStore<ProjectSliceRoot>()((...a) => ({
    ...createProjectSlice(...a),
    ...createDeviceSlice(...a),
    ...createConsoleSlice(...a),
    ...createEditorSlice(...a),
    ...createLibrarySlice(...a),
  }))

const RUNTIME_V4: BoardInfo = {
  compiler: 'openplc-compiler',
  core: 'rt-v4',
  preview: '',
  specs: {},
  capabilities: {
    pinMapping: false,
    vppIo: true,
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

const device = (name: string): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: { host: '127.0.0.1', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] },
})
const group = (id: string, length: number): ModbusIOGroup => ({
  id,
  name: `g-${id}`,
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length,
  errorHandling: 'keep-last-value',
  ioPoints: [],
})
const intVar = (name: string, location: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: 'INT' },
  location,
  documentation: '',
})

const addDevice = (s: ReturnType<typeof makeStore>, d: PLCRemoteDevice) => {
  const cur = s.getState().project
  s.setState({ project: { ...cur, data: { ...cur.data, remoteDevices: [...(cur.data.remoteDevices ?? []), d] } } })
}
const setPous = (s: ReturnType<typeof makeStore>, pous: unknown[]) => {
  const cur = s.getState().project
  s.setState({ project: { ...cur, data: { ...cur.data, pous: pous as never } } })
}
const locOf = (s: ReturnType<typeof makeStore>, name: string) =>
  (
    s.getState().projectActions.getCompileReadyProjectData() as never as {
      pous: { interface: { variables: PLCVariable[] } }[]
    }
  ).pous[0].interface.variables.find((v) => v.name === name)?.location

describe('E24 — a literal does not follow the repack', () => {
  it('the alias follows and the literal stays behind', () => {
    const s = makeStore()
    s.getState().deviceActions.setAvailableOptions({
      availableBoards: new Map<string, BoardInfo>([['OpenPLC Runtime v4', RUNTIME_V4]]),
    })
    s.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')

    // Producer B first, so the repack has something to reorder when A arrives.
    addDevice(s, device('DevB'))
    s.getState().projectActions.addIOGroup('DevB', group('gb', 2))
    const pb = s.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
    s.getState().projectActions.updateIOPointAlias('DevB', 'gb', pb, 'signalB')

    const before = s.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].iecLocation
    // eslint-disable-next-line no-console
    console.log(`[E24] initial address of point B = ${before}`)

    setPous(s, [
      {
        name: 'main',
        pouType: 'program',
        interface: { variables: [intVar('byAlias', 'signalB'), intVar('byLiteral', before)] },
        body: { language: 'st', value: '' },
        documentation: '',
      },
    ])

    expect(locOf(s, 'byAlias')).toBe(before)
    expect(locOf(s, 'byLiteral')).toBe(before)

    // A VPP module arrives, and in the canonical order it comes BEFORE Modbus
    // (pins -> VPP -> Modbus), so it pushes the device's points along.
    s.getState().deviceActions.setVendorScreenData('io-mapping', {
      entries: [
        // A REAL address, colliding with the Modbus point: the registry
        // migrates existing state, so a channel with no address registers
        // nothing (seedChannel returns null). With VPP at %IW0 and Modbus at
        // %IW0 too, the canonical order (pins -> VPP -> Modbus) gives %IW0 to
        // the VPP and pushes Modbus along.
        { slot: 0, moduleId: 'mod', channelName: 'ch0', iecAddress: '%IW0', alias: '' },
        { slot: 0, moduleId: 'mod', channelName: 'ch1', iecAddress: '%IW1', alias: '' },
      ],
    })
    // The repack's own trigger — what every producer screen calls on save.
    s.getState().projectActions.recalculateIecAddresses()

    const after = s.getState().project.data.remoteDevices!.find((d) => d.name === 'DevB')!.modbusTcpConfig!.ioGroups[0]
      .ioPoints![0].iecLocation
    // eslint-disable-next-line no-console
    console.log(
      `[E24] after the repack: point B = ${after} | byAlias = ${locOf(s, 'byAlias')} | byLiteral = ${locOf(s, 'byLiteral')}`,
    )

    if (after === before) {
      throw new Error(`the repack never ran (the point is still at ${before}) — the scenario proved nothing`)
    }
    expect(locOf(s, 'byAlias')).toBe(after) // the alias follows
    expect(locOf(s, 'byLiteral')).toBe(before) // the literal stays behind
  })
})
