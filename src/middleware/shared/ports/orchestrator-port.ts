/**
 * OrchestratorPort — Abstracts orchestrator discovery and device listing.
 *
 * Orchestrators are agent-managed hosts that contain one or more runtime devices.
 * This port provides the interface for fetching the list of orchestrators and
 * their devices, decoupling the UI from the specific API transport.
 *
 * Editor adapter: No-op (editor connects to devices directly, not through orchestrators).
 * Web adapter:    Calls Edge API GET /orchestrators with cookie-based auth.
 */

/**
 * A runtime device within an orchestrator.
 */
export interface OrchestratorDevice {
  id: string
  name: string
  status: string | null
  active: boolean
}

/**
 * An orchestrator host with its managed devices.
 */
export interface OrchestratorInfo {
  /** Database ID of the orchestrator record. */
  id: string
  /** Display name. */
  name: string
  /** Agent identifier used for runtime commands (run-command proxy). */
  agentId: string
  /** Optional description. */
  description: string | null
  /** Devices managed by this orchestrator. */
  devices: OrchestratorDevice[]
}

/**
 * Port interface for orchestrator operations.
 */
export interface OrchestratorPort {
  /** Fetch all orchestrators with their devices. */
  listOrchestrators(): Promise<OrchestratorInfo[]>
}
