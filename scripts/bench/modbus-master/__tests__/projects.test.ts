import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

import { channelKey } from '../../../../src/middleware/shared/utils/iec-address/registry/allocate'
import {
  modbusConsumerId,
  recalculateFromLegacy,
} from '../../../../src/middleware/shared/utils/iec-address/registry/migrate'
import { buildAliasIndex } from '../../../../src/middleware/shared/utils/iec-address/registry/resolve'

/** The bench folder of the Modbus master, one level above this test's folder. */
const BENCH_DIR = path.resolve(__dirname, '..')
const PROJECTS_DIR = path.join(BENCH_DIR, 'projects')

type IoPoint = { id: string; name?: string; iecLocation: string; alias?: string }

type IoGroup = {
  id?: string
  functionCode?: string
  cycleTime?: number
  offset?: string
  length?: number
  errorHandling?: string
  ioPoints?: IoPoint[]
}

type RemoteDevice = {
  name: string
  deviceName?: string
  protocol: string
  modbusTcpConfig?: {
    transport?: string
    host?: string
    port?: number
    reconnect?: boolean
    timeout?: number
    slaveId?: number
    ioGroups?: IoGroup[]
  }
}

type DeviceConfiguration = {
  deviceBoard: string
  vendorScreenData?: { 'io-mapping'?: { entries?: VppEntry[] } }
}

type Pin = { address: string; alias?: string; pinType?: string }

type VppEntry = {
  iecAddress: string
  alias?: string
  slot: number
  channelName: string
  moduleName?: string
  moduleId?: string
}

/** One bench project as the editor loads it: its board, the board's pins, its VPP entries and its remote devices. */
type BenchProject = {
  name: string
  dir: string
  board: string
  pins: Pin[]
  vppEntries: VppEntry[]
  devices: RemoteDevice[]
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf-8'))

/** The remote device files of a project, in the order `readdirSync` returns them, as the editor's loader reads them. */
function remoteDevices(dir: string): RemoteDevice[] {
  const remoteDir = path.join(dir, 'devices', 'remote')
  if (!existsSync(remoteDir)) return []
  return readdirSync(remoteDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson<RemoteDevice>(path.join(remoteDir, file)))
}

function loadProject(name: string): BenchProject {
  const dir = path.join(PROJECTS_DIR, name)
  const configuration = readJson<DeviceConfiguration>(path.join(dir, 'devices', 'configuration.json'))
  const pinMappingFile = path.join(dir, 'devices', 'pin-mapping.json')
  const pinsByBoard = existsSync(pinMappingFile) ? readJson<Record<string, Pin[]>>(pinMappingFile) : {}
  return {
    name,
    dir,
    board: configuration.deviceBoard,
    pins: pinsByBoard[configuration.deviceBoard] ?? [],
    vppEntries: configuration.vendorScreenData?.['io-mapping']?.entries ?? [],
    devices: remoteDevices(dir),
  }
}

const PROJECTS: BenchProject[] = readdirSync(PROJECTS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => loadProject(entry.name))

const WITH_REMOTE_DEVICES = PROJECTS.filter((project) => project.devices.length > 0)

const deviceNameOf = (device: RemoteDevice): string => device.deviceName || device.name || 'device'

/** Every IO point of a project's remote devices, with the device and group it belongs to. */
function pointsOf(project: BenchProject): Array<{ device: RemoteDevice; groupId: string; point: IoPoint }> {
  return project.devices.flatMap((device) =>
    (device.modbusTcpConfig?.ioGroups ?? []).flatMap((group, index) =>
      (group.ioPoints ?? []).map((point) => ({ device, groupId: group.id ?? String(index), point })),
    ),
  )
}

/** The registry the editor builds when it opens the project: every producer kind active, gapless after the pins. */
const allocationOf = (project: BenchProject) =>
  recalculateFromLegacy({
    pinMapping: { pins: project.pins },
    vendorIoMapping: { entries: project.vppEntries },
    remoteDevices: project.devices,
  }).registry

describe('MT-4: the bench fixtures store the addresses the editor allocates on open', () => {
  test('finds bench projects with remote devices', () => {
    assert.ok(WITH_REMOTE_DEVICES.length > 0, `no project with remote devices under ${PROJECTS_DIR}`)
  })

  for (const project of WITH_REMOTE_DEVICES) {
    test(`${project.name}: every IO point stores the address the allocation gives its channel`, () => {
      const registry = allocationOf(project)
      const mismatches = pointsOf(project).flatMap(({ device, groupId, point }) => {
        const expected =
          registry.assignments[channelKey(modbusConsumerId(deviceNameOf(device), groupId), point.id)] ?? '<none>'
        return point.iecLocation === expected
          ? []
          : [
              `${project.name} / ${deviceNameOf(device)} / ${point.name ?? point.id}: stored ${point.iecLocation}, expected ${expected}`,
            ]
      })
      assert.deepEqual(mismatches, [])
    })

    test(`${project.name}: every point alias resolves to the address stored on its point`, () => {
      const index = buildAliasIndex(allocationOf(project))
      const mismatches = pointsOf(project).flatMap(({ device, point }) => {
        if (!point.alias) return []
        const resolved = index.get(point.alias) ?? '<nothing produces it>'
        return resolved === point.iecLocation
          ? []
          : [
              `${project.name} / ${deviceNameOf(device)} / ${point.name ?? point.id}: alias ${point.alias} resolves to ${resolved}, stored ${point.iecLocation}`,
            ]
      })
      assert.deepEqual(mismatches, [])
    })
  }
})

describe('run sheet: TC10 and AS-02 run with Reconnect unchecked', () => {
  test('as02-sentinel has Reconnect unchecked on every device', () => {
    const devices = loadProject('as02-sentinel').devices
    assert.ok(devices.length > 0, 'as02-sentinel has no remote device')
    assert.deepEqual(
      devices.map((device) => ({ device: device.name, reconnect: device.modbusTcpConfig?.reconnect })),
      devices.map((device) => ({ device: device.name, reconnect: false })),
    )
  })
})

describe('run sheet: TC28 (a) bench project tc28-shared-timeout', () => {
  const NAME = 'tc28-shared-timeout'

  const project = (): BenchProject => {
    assert.ok(existsSync(path.join(PROJECTS_DIR, NAME, 'project.json')), `projects/${NAME} does not exist`)
    return loadProject(NAME)
  }

  test('targets ESP32 Generic', () => {
    assert.equal(project().board, 'ESP32 Generic')
  })

  test('has exactly two devices on one host and port, 192.168.1.50:502', () => {
    const endpoints = project().devices.map((device) => ({
      transport: device.modbusTcpConfig?.transport,
      host: device.modbusTcpConfig?.host,
      port: device.modbusTcpConfig?.port,
    }))
    assert.deepEqual(endpoints, [
      { transport: 'tcp', host: '192.168.1.50', port: 502 },
      { transport: 'tcp', host: '192.168.1.50', port: 502 },
    ])
  })

  test('has slave 1 with a 1000 ms timeout and slave 2 with a 300 ms timeout', () => {
    const devices = project()
      .devices.map((device) => ({
        slaveId: device.modbusTcpConfig?.slaveId,
        timeout: device.modbusTcpConfig?.timeout,
      }))
      .sort((a, b) => (a.slaveId ?? 0) - (b.slaveId ?? 0))
    assert.deepEqual(devices, [
      { slaveId: 1, timeout: 1000 },
      { slaveId: 2, timeout: 300 },
    ])
  })

  test('gives both devices the same Reconnect, checked as in tc02-shared-endpoint', () => {
    assert.deepEqual(
      project().devices.map((device) => device.modbusTcpConfig?.reconnect),
      [true, true],
    )
  })

  test('reads two holding registers from offset 0 every 100 ms on each device, zeroed on error', () => {
    const groups = project()
      .devices.sort((a, b) => (a.modbusTcpConfig?.slaveId ?? 0) - (b.modbusTcpConfig?.slaveId ?? 0))
      .map((device) =>
        (device.modbusTcpConfig?.ioGroups ?? []).map((group) => ({
          id: group.id,
          functionCode: group.functionCode,
          offset: group.offset,
          length: group.length,
          errorHandling: group.errorHandling,
          cycleTime: group.cycleTime,
          points: (group.ioPoints ?? []).map((point) => point.name),
        })),
      )
    const shape = { functionCode: '3', offset: '0', length: 2, errorHandling: 'set-to-zero', cycleTime: 100 }
    assert.deepEqual(groups, [
      [{ id: 'a', ...shape, points: ['a_0', 'a_1'] }],
      [{ id: 'b', ...shape, points: ['b_0', 'b_1'] }],
    ])
  })

  test("binds every point's alias in the program", () => {
    const loaded = project()
    const program = readFileSync(path.join(loaded.dir, 'pous', 'programs', 'main.st'), 'utf-8')
    const unbound = pointsOf(loaded)
      .map(({ point }) => point.alias ?? `<${point.name ?? point.id} has no alias>`)
      .filter((alias) => !new RegExp(`\\bAT\\s+${alias}\\s*;`).test(program))
    assert.deepEqual(unbound, [])
  })
})

describe('run sheet: TC05 return map', () => {
  test('maps/tc05-return.json answers 4321, 8765 at 0, 1 and 3333, 4444 at 10, 11', () => {
    const file = path.join(BENCH_DIR, 'maps', 'tc05-return.json')
    assert.ok(existsSync(file), 'maps/tc05-return.json does not exist')
    assert.deepEqual(readJson<unknown>(file), {
      holdingRegisters: { '0': 4321, '1': 8765, '10': 3333, '11': 4444 },
    })
  })
})

/** The bench compile fixtures, which have no pins and bind literal addresses in their programs. */
const COMPILE_FIXTURES = [
  'compile-tcp-master',
  'compile-tcp-master-wifi',
  'compile-rtu-master',
  'compile-rtu-master-fx3u',
  'compile-rtu-master-no-pin',
]

/** Program variable and the IO point it must be located on, in every compile fixture. */
const COMPILE_PAIRS: Array<[string, string]> = [
  ['coil_0', 'coils_0'],
  ['discrete_0', 'discretes_0'],
  ['holding_0', 'holding_0'],
  ['input_0', 'inputs_0'],
  ['second_0', 'second_0'],
  ['coil_out', 'coil_out_0'],
  ['reg_out', 'reg_out_0'],
  ['coils_out_0', 'coils_out_0'],
  ['regs_out_0', 'regs_out_0'],
]

/** The pair the TCP compile fixtures add: their second endpoint's point. */
const TCP_COMPILE_PAIRS: Array<[string, string]> = [['shared_0', 'shared_0']]

const pairsOf = (name: string): Array<[string, string]> =>
  name.startsWith('compile-tcp-') ? [...COMPILE_PAIRS, ...TCP_COMPILE_PAIRS] : COMPILE_PAIRS

/** Every variable declared in a program, with its `AT` address or `null` when it is not located. */
function declarationsOf(program: string): Map<string, string | null> {
  const declared = new Map<string, string | null>()
  for (const match of program.matchAll(/^\s*([A-Za-z_]\w*)\s*:\s*[A-Za-z_]\w*(?:\s+AT\s+(\S+?))?\s*;/gm)) {
    declared.set(match[1], match[2] ?? null)
  }
  return declared
}

const programOf = (project: BenchProject): string =>
  readFileSync(path.join(project.dir, 'pous', 'programs', 'main.st'), 'utf-8')

describe('B1b: compile fixtures bind their own points', () => {
  for (const name of COMPILE_FIXTURES) {
    test(`${name}: every paired variable is located at its point's stored address`, () => {
      const project = loadProject(name)
      const declared = declarationsOf(programOf(project))
      const stored = new Map(pointsOf(project).map(({ point }) => [point.name ?? point.id, point.iecLocation]))
      const mismatches = pairsOf(name).flatMap(([variable, point]) => {
        const at = declared.get(variable) ?? '<not located>'
        const expected = stored.get(point) ?? '<no such point>'
        return at === expected ? [] : [`${name} / ${variable} AT ${at}, point ${point} stored at ${expected}`]
      })
      assert.deepEqual(mismatches, [])
    })

    test(`${name}: scan_toggle is declared and not located`, () => {
      const declared = declarationsOf(programOf(loadProject(name)))
      assert.deepEqual(
        { declared: declared.has('scan_toggle'), at: declared.get('scan_toggle') ?? null },
        { declared: true, at: null },
      )
    })

    test(`${name}: locates no variable outside the pairing`, () => {
      const paired = new Set(pairsOf(name).map(([variable]) => variable))
      const extra = [...declarationsOf(programOf(loadProject(name)))]
        .filter(([variable, at]) => at !== null && !paired.has(variable))
        .map(([variable, at]) => `${variable} AT ${at}`)
      assert.deepEqual(extra, [])
    })

    test(`${name}: no two located variables share an address`, () => {
      const byAddress = new Map<string, string[]>()
      for (const [variable, at] of declarationsOf(programOf(loadProject(name)))) {
        if (at !== null) byAddress.set(at, [...(byAddress.get(at) ?? []), variable])
      }
      const shared = [...byAddress]
        .filter(([, variables]) => variables.length > 1)
        .map(([at, v]) => `${at}: ${v.join(', ')}`)
      assert.deepEqual(shared, [])
    })
  }
})
