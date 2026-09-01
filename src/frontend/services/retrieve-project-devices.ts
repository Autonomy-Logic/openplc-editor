/**
 * What the retrieve picker knows about each device, and what it may claim.
 *
 * The device list and the discovery scan answer two different questions. The
 * list says which devices exist; the scan says what each one is holding. A
 * device can therefore be in one of three states, and the middle one is why
 * this is a separate rule rather than a `??` in the render:
 *
 *   - answered, and named a project  -- retrievable, and we can say what it is
 *   - answered, and named none       -- genuinely stores nothing
 *   - never answered                 -- we know nothing about it
 *
 * Treating the third as the second makes the picker assert "No project stored"
 * about a device that may well have one, and -- because that assertion also
 * disables the row -- leaves the user no way to find out. An orchestrator whose
 * agent cannot run the scan answers for none of its devices, so collapsing the
 * two would turn the documented degraded mode (a list without project names)
 * into a list where nothing can be selected at all.
 *
 * Kept out of the modal because this distinction is the feature, not
 * presentation.
 */

import type { DiscoveredOrchestratorRuntime, OrchestratorInfo } from '../../middleware/shared/ports/orchestrator-port'

export interface DeviceRow {
  orchestratorName: string
  agentId: string
  deviceId: string
  deviceName: string
  status: string | null
  /** Whether this device answered the discovery scan. See the module comment. */
  answeredScan: boolean
  /** Absent when the device answered and stores no project, and equally when it
   *  never answered -- `answeredScan` is what separates those. */
  projectName?: string
  projectTimestamp?: string
}

/** One orchestrator's scan result, as the picker collects them. */
export interface OrchestratorScan {
  agentId: string
  runtimes: DiscoveredOrchestratorRuntime[]
}

/**
 * Devices are keyed by orchestrator *and* id: ids are unique per orchestrator,
 * not globally, so the agent has to be part of the key.
 */
export function deviceKey(agentId: string, deviceId: string): string {
  return `${agentId}:${deviceId}`
}

/** The picker's rows, with each device matched to what it advertised. */
export function buildDeviceRows(orchestrators: OrchestratorInfo[], scans: OrchestratorScan[]): DeviceRow[] {
  const advertised = new Map(
    scans.flatMap(({ agentId, runtimes }) =>
      runtimes
        .filter((runtime) => runtime.deviceId)
        .map((runtime) => [deviceKey(agentId, runtime.deviceId as string), runtime] as const),
    ),
  )

  return orchestrators.flatMap((orchestrator) =>
    orchestrator.devices.map((device) => {
      const runtime = advertised.get(deviceKey(orchestrator.agentId, device.id))
      return {
        orchestratorName: orchestrator.name,
        agentId: orchestrator.agentId,
        deviceId: device.id,
        deviceName: device.name,
        status: device.status,
        answeredScan: runtime !== undefined,
        ...(runtime?.projectName ? { projectName: runtime.projectName } : {}),
        ...(runtime?.projectTimestamp ? { projectTimestamp: runtime.projectTimestamp } : {}),
      }
    }),
  )
}

/**
 * Whether a row can be chosen.
 *
 * Only a device that answered can be known to store nothing. Silence is not an
 * answer, so a device that did not reply stays selectable and the retrieval
 * itself reports what is actually there.
 */
export function canRetrieveDevice(device: DeviceRow): boolean {
  return Boolean(device.projectName) || !device.answeredScan
}

/** The row's headline: the project it holds, or the best thing we can say instead. */
export function deviceRowTitle(device: DeviceRow): string {
  if (device.projectName) return device.projectName
  return device.answeredScan ? 'No project stored' : device.deviceName
}
