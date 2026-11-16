import type { OrchestratorDevice, OrchestratorInfo } from '../../middleware/shared/ports/orchestrator-port'
import type { ProjectTargetDevice } from '../../middleware/shared/ports/types'
import type { SelectedDevice } from '../store/slices/device'

/** The selection a listed vPLC makes, carrying its live binding (backplane access, vendor package). */
export function toSelectedDevice(
  orchestratorId: string,
  orchestratorAgentId: string,
  device: OrchestratorDevice,
): SelectedDevice {
  return {
    orchestratorId,
    orchestratorAgentId,
    deviceId: device.id,
    deviceName: device.name,
    // Absent stays absent: a host that predates the field must not read as one that said no.
    ...(typeof device.backplaneAccess === 'boolean' ? { backplaneAccess: device.backplaneAccess } : {}),
    // `null` is a real answer — "runs no vendor package" — and absent is not.
    ...(device.vpp !== undefined ? { vpp: device.vpp } : {}),
  }
}

/** What the project records about a selection: identity only, never the binding. */
export function toProjectTargetDevice(selection: SelectedDevice): ProjectTargetDevice {
  return {
    orchestratorId: selection.orchestratorId,
    deviceId: selection.deviceId,
    deviceName: selection.deviceName,
  }
}

/**
 * The selection to restore for a project's recorded vPLC, or null when this
 * user's listing no longer offers it (deleted, moved, not shared, or inactive).
 */
export function findProjectTargetDevice(
  target: ProjectTargetDevice,
  orchestrators: OrchestratorInfo[],
): SelectedDevice | null {
  const orchestrator = orchestrators.find((item) => item.id === target.orchestratorId)
  const device = orchestrator?.devices.find((item) => item.id === target.deviceId)
  if (!orchestrator || !device || device.active === false) return null
  return toSelectedDevice(orchestrator.id, orchestrator.agentId, device)
}
