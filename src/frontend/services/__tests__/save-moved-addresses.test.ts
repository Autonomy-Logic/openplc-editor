/** A per-file save also writes the device files whose IEC addresses a project-wide recompute moved. */

import { createDefaultSlaveConfig } from '../../../backend/shared/ethercat/device-config-defaults'
import { manifestModuleFromCapture } from '../../../__fixtures__/device-editor-datapoints/manifest-module'
import { UR20_16DI_16DO } from '../../../__fixtures__/device-editor-datapoints/ur20-16di-16do'
import CONFIGURATOR_SCREEN from '../../../__fixtures__/weidmuller-screens/io-configurator.json'
import MAPPING_SCREEN from '../../../__fixtures__/weidmuller-screens/io-mapping.json'
import type { PlatformCapabilities } from '../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import type {
  BoardInfo,
  IoMappingEntry,
  ModbusIOGroup,
  PLCRemoteDevice,
  VppModuleDefinition,
} from '../../../middleware/shared/ports/types'
import { buildAddressPool } from '../../../middleware/shared/utils/iec-address'
import { ALL_ADDRESS_PRODUCERS_ACTIVE } from '../../../middleware/shared/utils/target-capabilities'
import type { OpenPLCStore } from '../../store'
import { createTestStore } from '../../store/testing'
import { applyConfiguratorSnapshot } from '../apply-configurator-snapshot'
import { executeSaveFile, executeSaveProject, reloadFileFromDisk } from '../save-actions'

const capabilities = { isNativeApplication: true, hasEdgeAccount: true } as PlatformCapabilities
const BOARD = 'UC20-M3000'
const CONFIGURATOR = 'I/O Configurator'
const MAPPING = 'I/O Mapping'
const TARGET = { configuratorKey: 'configurator', controller: BOARD, bundleVersion: '3.5.22' }
const [DI_DEVICE, DO_DEVICE] = UR20_16DI_16DO.deviceSetup.devices
const MODULES: VppModuleDefinition[] = [
  manifestModuleFromCapture(UR20_16DI_16DO, 0, { id: 'ur20-16di-p', name: 'UR20-16DI-P' }),
  manifestModuleFromCapture(UR20_16DI_16DO, 1, { id: 'ur20-16do-p', name: 'UR20-16DO-P' }),
]

let store: OpenPLCStore
let port: ProjectPort

beforeEach(() => {
  store = createTestStore()
  store.getState().projectActions.updateMetaPath('/p')
  port = makePort()
})

function makePort(): ProjectPort {
  return {
    saveProject: jest.fn().mockResolvedValue({ success: true }),
    saveFile: jest.fn().mockResolvedValue({ success: true }),
    readFileContent: jest.fn().mockResolvedValue({ success: false }),
  } as unknown as ProjectPort
}

/** Path → content of every per-file write, the last write of a path winning. */
function written(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [path, content] of jest.mocked(port.saveFile).mock.calls) out.set(String(path), String(content))
  return out
}

const writtenPaths = () => [...written().keys()].map((path) => path.replace(/^\/p\//, ''))

function seedWeidmullerBoard() {
  const board = {
    compiler: 'openplc-compiler',
    core: 'openplc',
    preview: 'generic.png',
    specs: {},
    vpp: {
      packageId: 'com.weidmuller.ucontrol',
      vendor: 'Weidmuller',
      deviceId: 'uc20-m3000',
      packagePath: '/packages/com.weidmuller.ucontrol',
      screens: { [CONFIGURATOR]: CONFIGURATOR_SCREEN, [MAPPING]: MAPPING_SCREEN },
      moduleSystem: { enabled: true, maxSlots: 64, modules: MODULES },
    },
  } as BoardInfo
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD, board]]) })
  store.getState().deviceActions.setDeviceBoard(BOARD)
  for (const name of [CONFIGURATOR, MAPPING]) {
    store.getState().fileActions.addFile({ name, type: 'vendor-screen', filePath: '', cleanState: '{}' })
  }
}

function seedRuntimeBoard() {
  store.getState().deviceActions.setAvailableOptions({
    availableBoards: new Map([
      [
        'OpenPLC Runtime v4',
        {
          compiler: 'openplc-compiler',
          core: 'rt-v4',
          preview: '',
          specs: {},
          capabilities: { pinMapping: false, vppIo: false, modbusTcpRemote: true, ethercat: true },
        } as BoardInfo,
      ],
    ]),
  })
  store.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')
}

const group = (id: string, length: number): ModbusIOGroup => ({
  id,
  name: `group_${id}`,
  functionCode: '2',
  cycleTime: 100,
  offset: '0',
  length,
  errorHandling: 'keep-last-value',
  ioPoints: [],
})

/** A Modbus slave with one discrete-input group, its file entry saved as if just opened. */
function addSlave(name: string, length = 8) {
  store.getState().remoteDeviceActions.create({ name, protocol: 'modbus-tcp' })
  store.getState().projectActions.addIOGroup(name, group('g1', length))
  store.getState().fileActions.updateFile({ name, saved: true, isNew: false })
}

const device = (name: string): PLCRemoteDevice | undefined =>
  store.getState().project.data.remoteDevices?.find((d) => d.name === name)

const modbusAddresses = (name: string) =>
  device(name)?.modbusTcpConfig?.ioGroups.flatMap((g) => g.ioPoints?.map((p) => p.iecLocation) ?? []) ?? []

const isSaved = (name: string) => store.getState().fileActions.getFile({ name }).file?.saved

function markAllSaved() {
  for (const name of Object.keys(store.getState().files)) store.getState().fileActions.updateFile({ name, saved: true })
}

const vppEntries = (): IoMappingEntry[] =>
  (
    store.getState().deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
      | { entries?: IoMappingEntry[] }
      | undefined
  )?.entries ?? []

/** Double claims among what the per-file writes left on disk, reading untouched files from `disk`. */
function diskConflicts(disk: { vpp: IoMappingEntry[]; remote: Record<string, PLCRemoteDevice> }): string[] {
  const files = written()
  const config = files.get('/p/devices/configuration.json')
  const vpp = config
    ? ((JSON.parse(config) as { vendorScreenData?: { 'io-mapping'?: { entries?: IoMappingEntry[] } } })
        .vendorScreenData?.['io-mapping']?.entries ?? [])
    : disk.vpp
  const remoteDevices = Object.entries(disk.remote).map(([name, onDisk]) => {
    const content = files.get(`/p/devices/remote/${name}.json`)
    return content ? (JSON.parse(content) as PLCRemoteDevice) : onDisk
  })
  return buildAddressPool(
    { vendorIoMapping: { entries: vpp }, remoteDevices },
    ALL_ADDRESS_PRODUCERS_ACTIVE,
  ).conflicts.map((conflict) => conflict.address)
}

const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('saving one file after a recompute moved other devices', () => {
  it('writes the Modbus device the Weidmuller configurator moved when the I/O Mapping tab is saved', async () => {
    seedWeidmullerBoard()
    addSlave('Slave1')
    const disk = { vpp: [], remote: { Slave1: snapshot(device('Slave1')!) } }

    applyConfiguratorSnapshot(store, TARGET, { archive: 'a', deviceSetup: UR20_16DI_16DO.deviceSetup })
    const markedBeforeSave = isSaved('Slave1')
    await executeSaveFile(store, MAPPING, port, capabilities)

    expect({
      moved: modbusAddresses('Slave1')[0],
      markedBeforeSave,
      paths: writtenPaths().sort(),
      conflicts: diskConflicts(disk),
      savedAfter: isSaved('Slave1'),
    }).toEqual({
      moved: '%IX2.0',
      markedBeforeSave: false,
      paths: ['devices/configuration.json', 'devices/remote/Slave1.json'],
      conflicts: [],
      savedAfter: true,
    })
  })

  it('writes the next Modbus device when growing a group in the first one moves it', async () => {
    seedRuntimeBoard()
    addSlave('Slave1')
    addSlave('Slave2')
    const disk = { vpp: [], remote: { Slave1: snapshot(device('Slave1')!), Slave2: snapshot(device('Slave2')!) } }

    store.getState().projectActions.updateIOGroup('Slave1', 'g1', { length: 16 })
    store.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState('Slave1')
    const markedBeforeSave = isSaved('Slave2')
    await executeSaveFile(store, 'Slave1', port, capabilities)

    expect({
      moved: modbusAddresses('Slave2')[0],
      markedBeforeSave,
      paths: writtenPaths().sort(),
      conflicts: diskConflicts(disk),
    }).toEqual({
      moved: '%IX2.0',
      markedBeforeSave: false,
      paths: ['devices/remote/Slave1.json', 'devices/remote/Slave2.json'],
      conflicts: [],
    })
  })

  it('writes an EtherCAT bus whose channels a Modbus change moved', async () => {
    seedRuntimeBoard()
    addSlave('Slave1')
    store.getState().remoteDeviceActions.create({ name: 'Bus', protocol: 'ethercat' })
    store.getState().projectActions.updateEthercatConfig('Bus', {
      devices: [
        {
          id: 'c',
          name: 'Coupler',
          esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
          vendorId: '0x2',
          productCode: '0x1',
          revisionNo: '0x1',
          addedFrom: 'repository',
          config: createDefaultSlaveConfig(),
          channelMappings: [{ channelId: 'in1', iecLocation: '%IX1.0' }],
        },
      ],
    } as unknown as NonNullable<PLCRemoteDevice['ethercatConfig']>)
    markAllSaved()

    store.getState().projectActions.updateIOGroup('Slave1', 'g1', { length: 16 })
    await executeSaveFile(store, 'Slave1', port, capabilities)

    expect({
      moved: device('Bus')?.ethercatConfig?.devices[0]?.channelMappings[0]?.iecLocation,
      paths: writtenPaths().sort(),
    }).toEqual({ moved: '%IX2.0', paths: ['devices/remote/Bus.json', 'devices/remote/Slave1.json'] })
  })

  it('writes only the saved file when the recompute moved nothing else', async () => {
    seedRuntimeBoard()
    addSlave('Slave1')
    addSlave('Slave2')

    store
      .getState()
      .projectActions.updateIOPointAlias(
        'Slave2',
        'g1',
        device('Slave2')!.modbusTcpConfig!.ioGroups[0].ioPoints![0].id,
        'Door_Open',
      )
    store.getState().projectActions.recalculateIecAddresses()
    await executeSaveFile(store, 'Slave2', port, capabilities)

    expect({ paths: writtenPaths(), slave1Saved: isSaved('Slave1') }).toEqual({
      paths: ['devices/remote/Slave2.json'],
      slave1Saved: true,
    })
  })

  it('leaves the device files alone when the saved file holds no addresses', async () => {
    seedRuntimeBoard()
    addSlave('Slave1')
    addSlave('Slave2')
    store.getState().pouActions.create({ type: 'program', name: 'main', language: 'st' })

    store.getState().projectActions.updateIOGroup('Slave1', 'g1', { length: 16 })
    await executeSaveFile(store, 'main', port, capabilities)

    expect({ paths: writtenPaths(), slave2Saved: isSaved('Slave2') }).toEqual({
      paths: ['pous/programs/main.st'],
      slave2Saved: false,
    })
  })

  it('forgets the moved files once the whole project is saved', async () => {
    seedRuntimeBoard()
    addSlave('Slave1')
    addSlave('Slave2')

    store.getState().projectActions.updateIOGroup('Slave1', 'g1', { length: 16 })
    await executeSaveProject(store, makePort(), capabilities)
    store.getState().projectActions.updateIOGroup('Slave2', 'g1', { length: 4 })
    await executeSaveFile(store, 'Slave2', port, capabilities)

    expect(writtenPaths()).toEqual(['devices/remote/Slave2.json'])
  })
})

describe('discarding a configurator change', () => {
  it('leaves no address claimed twice in memory', async () => {
    seedWeidmullerBoard()
    addSlave('Slave1')
    applyConfiguratorSnapshot(store, TARGET, { archive: 'a', deviceSetup: UR20_16DI_16DO.deviceSetup })
    await executeSaveFile(store, MAPPING, makePort(), capabilities)

    applyConfiguratorSnapshot(store, TARGET, {
      archive: 'b',
      deviceSetup: { systembus: UR20_16DI_16DO.deviceSetup.systembus, devices: [DO_DEVICE] },
    })
    const modbusWhileDiOut = modbusAddresses('Slave1')[0]
    await reloadFileFromDisk(store, MAPPING, makePort())

    const { conflicts } = buildAddressPool(
      { vendorIoMapping: { entries: vppEntries() }, remoteDevices: store.getState().project.data.remoteDevices },
      ALL_ADDRESS_PRODUCERS_ACTIVE,
    )
    expect({
      modbusWhileDiOut,
      restoredDi: vppEntries().some((entry) => entry.moduleId === 'ur20-16di-p'),
      conflicts: conflicts.map((c) => c.address),
    }).toEqual({ modbusWhileDiOut: '%IX0.0', restoredDi: true, conflicts: [] })
    expect(DI_DEVICE).toBeDefined()
  })
})
