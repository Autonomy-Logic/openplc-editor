/** Opening a project whose saved devices claim the same IEC address twice reassigns them before anything else runs. */

import { parseProjectFiles } from '../../../backend/shared/utils/parse-project-files'
import type { ModbusIOGroup, PLCRemoteDevice } from '../../../middleware/shared/ports/types'
import { buildAddressPool } from '../../../middleware/shared/utils/iec-address'
import { ALL_ADDRESS_PRODUCERS_ACTIVE } from '../../../middleware/shared/utils/target-capabilities'
import { buildAllProjectFileContentsPure } from '../../services/save-actions'
import type { OpenPLCStore } from '../index'
import { createTestStore } from '../testing'

const PROJECT_JSON = JSON.stringify({
  meta: { name: 'P', type: 'plc-project' },
  data: { dataTypes: [], pous: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
})
const DEVICE_CONFIG = JSON.stringify({ deviceBoard: 'OpenPLC Runtime v4', communicationPort: '', compileOnly: false })

const group = (length: number): ModbusIOGroup => ({
  id: 'g1',
  name: 'inputs',
  functionCode: '2',
  cycleTime: 100,
  offset: '0',
  length,
  errorHandling: 'keep-last-value',
  ioPoints: [],
})

/** The `devices/remote/<name>.json` of each slave, as an editor would have saved them. */
function savedSlaves(names: string[]): Record<string, PLCRemoteDevice> {
  const source = createTestStore()
  for (const name of names) {
    source.getState().remoteDeviceActions.create({ name, protocol: 'modbus-tcp' })
    source.getState().projectActions.addIOGroup(name, group(8))
  }
  const files = buildAllProjectFileContentsPure(source)
  return Object.fromEntries(
    names.map((name) => [name, JSON.parse(files[`devices/remote/${name}.json`]) as PLCRemoteDevice]),
  )
}

/** Rewrites every point of `device` to start at `%IX<byte>.0`. */
function movedTo(device: PLCRemoteDevice, byte: number): PLCRemoteDevice {
  const copy = JSON.parse(JSON.stringify(device)) as PLCRemoteDevice
  copy.modbusTcpConfig!.ioGroups[0].ioPoints!.forEach((point, index) => {
    point.iecLocation = `%IX${byte}.${index}`
  })
  return copy
}

let store: OpenPLCStore

function open(devices: PLCRemoteDevice[]) {
  store = createTestStore()
  store.getState().sharedWorkspaceActions.handleOpenProjectResponse(
    parseProjectFiles(
      '/p',
      PROJECT_JSON,
      DEVICE_CONFIG,
      '[]',
      [
        {
          relativePath: 'pous/programs/main.st',
          content: 'PROGRAM main\nVAR\n  x : BOOL;\nEND_VAR\n\n;\n\nEND_PROGRAM',
        },
      ],
      [],
      devices.map((device) => ({
        relativePath: `devices/remote/${device.name}.json`,
        content: JSON.stringify(device),
      })),
    ),
  )
}

const addresses = (name: string) =>
  store
    .getState()
    .project.data.remoteDevices?.find((d) => d.name === name)
    ?.modbusTcpConfig?.ioGroups[0].ioPoints?.map((p) => p.iecLocation) ?? []

const conflicts = () =>
  buildAddressPool({ remoteDevices: store.getState().project.data.remoteDevices }, ALL_ADDRESS_PRODUCERS_ACTIVE)
    .conflicts

const warnings = () =>
  store
    .getState()
    .logs.filter((log) => log.level === 'warning')
    .map((log) => log.message)

const saved = (name: string) => store.getState().fileActions.getFile({ name }).file?.saved

describe('opening a project with colliding device addresses', () => {
  it('reassigns the second device and keeps the first where it was', () => {
    const { Slave1, Slave2 } = savedSlaves(['Slave1', 'Slave2'])
    open([movedTo(Slave1, 0), movedTo(Slave2, 0)])

    expect({
      first: addresses('Slave1')[0],
      second: addresses('Slave2')[0],
      conflicts: conflicts().length,
      firstSaved: saved('Slave1'),
      secondSaved: saved('Slave2'),
    }).toEqual({ first: '%IX0.0', second: '%IX1.0', conflicts: 0, firstSaved: true, secondSaved: false })
  })

  it('names the address and both devices in a console warning', () => {
    const { Slave1, Slave2 } = savedSlaves(['Slave1', 'Slave2'])
    open([movedTo(Slave1, 0), movedTo(Slave2, 0)])

    const [warning] = warnings()
    expect([warning?.includes('%IX0.0'), warning?.includes('Slave1'), warning?.includes('Slave2')]).toEqual([
      true,
      true,
      true,
    ])
  })

  it('leaves a project with no collision untouched and saved', () => {
    const { Slave1, Slave2 } = savedSlaves(['Slave1', 'Slave2'])
    open([movedTo(Slave1, 0), movedTo(Slave2, 4)])

    expect({
      second: addresses('Slave2')[0],
      warnings: warnings(),
      allSaved: Object.values(store.getState().files).every((file) => file.saved),
    }).toEqual({ second: '%IX4.0', warnings: [], allSaved: true })
  })
})
