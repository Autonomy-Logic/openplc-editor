/**
 * What the picker may claim about a device.
 *
 * The case driving these tests: a device that never answered the scan looks
 * exactly like one that answered and stores nothing, unless the difference is
 * kept. It was not kept, and the picker told the user "No project stored" about
 * a device holding a project -- then disabled the row, so they could not find
 * out otherwise. It reproduced whenever two scans ran at once, because a
 * runtime rate-limits probes from one address and answers only the first.
 */

import type { OrchestratorInfo } from '../../../middleware/shared/ports/orchestrator-port'
import { buildDeviceRows, canRetrieveDevice, deviceRowTitle, type OrchestratorScan } from '../retrieve-project-devices'

const orchestrator = (devices: { id: string; name: string }[]): OrchestratorInfo =>
  ({
    id: 'o1',
    name: 'Shop floor',
    agentId: 'agent-1',
    description: null,
    devices: devices.map((d) => ({ ...d, status: 'running', active: true })),
  }) as unknown as OrchestratorInfo

const scan = (runtimes: OrchestratorScan['runtimes']): OrchestratorScan[] => [{ agentId: 'agent-1', runtimes }]

const runtime = (over: Record<string, unknown> = {}) =>
  ({
    ipAddress: '10.0.0.5',
    hostname: 'plc-1',
    runtimeVersion: 'v4.2.0',
    apiPort: 8443,
    deviceId: 'd1',
    ...over,
  }) as OrchestratorScan['runtimes'][number]

it('names the project a device advertised', () => {
  const [row] = buildDeviceRows(
    [orchestrator([{ id: 'd1', name: 'Line 1' }])],
    scan([runtime({ projectName: 'Traffic Light', projectTimestamp: '2026-08-31T12:00:00Z' })]),
  )

  expect(row.answeredScan).toBe(true)
  expect(row.projectName).toBe('Traffic Light')
  expect(deviceRowTitle(row)).toBe('Traffic Light')
  expect(canRetrieveDevice(row)).toBe(true)
})

it('reports a device that answered and named nothing as storing nothing', () => {
  const [row] = buildDeviceRows([orchestrator([{ id: 'd1', name: 'Line 1' }])], scan([runtime()]))

  expect(row.answeredScan).toBe(true)
  expect(deviceRowTitle(row)).toBe('No project stored')
  expect(canRetrieveDevice(row)).toBe(false)
})

it('does not claim a silent device stores nothing, and leaves it selectable', () => {
  // The regression. A dropped probe is not a statement about the device, and
  // disabling the row on the strength of it removes the only way to check.
  const [row] = buildDeviceRows([orchestrator([{ id: 'd1', name: 'Line 1' }])], scan([]))

  expect(row.answeredScan).toBe(false)
  expect(row.projectName).toBeUndefined()
  expect(deviceRowTitle(row)).toBe('Line 1')
  expect(canRetrieveDevice(row)).toBe(true)
})

it('keeps every device selectable when the agent cannot scan at all', () => {
  // The documented degraded mode: an agent too old to answer yields no scan.
  // That must leave a usable list, not a picker where nothing can be chosen.
  const rows = buildDeviceRows(
    [
      orchestrator([
        { id: 'd1', name: 'Line 1' },
        { id: 'd2', name: 'Line 2' },
      ]),
    ],
    [],
  )

  expect(rows).toHaveLength(2)
  expect(rows.every((row) => canRetrieveDevice(row))).toBe(true)
  expect(rows.map(deviceRowTitle)).toEqual(['Line 1', 'Line 2'])
})

it('matches a reply to a device by orchestrator as well as id', () => {
  // Device ids are unique per orchestrator, not globally. Keying on the id
  // alone would let one orchestrator's reply describe another's device.
  const other = {
    ...orchestrator([{ id: 'd1', name: 'Other line' }]),
    id: 'o2',
    name: 'Warehouse',
    agentId: 'agent-2',
  } as OrchestratorInfo

  const rows = buildDeviceRows(
    [orchestrator([{ id: 'd1', name: 'Line 1' }]), other],
    scan([runtime({ projectName: 'Traffic Light' })]),
  )

  expect(rows[0].projectName).toBe('Traffic Light')
  expect(rows[1].answeredScan).toBe(false)
  expect(rows[1].projectName).toBeUndefined()
})

it('ignores a reply from a runtime the orchestrator does not manage', () => {
  // A runtime found on the network with no device id belongs to no row.
  const [row] = buildDeviceRows(
    [orchestrator([{ id: 'd1', name: 'Line 1' }])],
    scan([runtime({ deviceId: undefined, projectName: 'Stray' })]),
  )

  expect(row.answeredScan).toBe(false)
  expect(row.projectName).toBeUndefined()
})
