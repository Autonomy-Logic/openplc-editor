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
 * What one of an orchestrator's runtimes is advertising.
 *
 * The runtime's own UDP discovery reply, relayed by the agent. Same shape the
 * desktop editor gets from scanning its LAN directly, so both clients read one
 * source of truth rather than web reading a stored copy that has to be written
 * on every upload.
 *
 * `projectName` and `projectTimestamp` are absent when the device stores no
 * project -- absent rather than empty, so "nothing stored" stays
 * distinguishable from "stored but unnamed".
 */
export interface DiscoveredOrchestratorRuntime {
  ipAddress: string
  hostname: string
  runtimeVersion: string
  apiPort: number
  /** The orchestrator's own id for this device, when the reply came from an
   *  address it manages. Absent for a runtime found on the network that the
   *  orchestrator does not know about. */
  deviceId?: string
  projectName?: string
  projectTimestamp?: string
}

/**
 * Port interface for orchestrator operations.
 */
export interface OrchestratorPort {
  /** Fetch all orchestrators with their devices. */
  listOrchestrators(): Promise<OrchestratorInfo[]>

  /**
   * Ask one orchestrator's agent what its runtimes are advertising.
   *
   * Optional because it needs an agent new enough to answer the scan; an
   * orchestrator that cannot simply yields nothing, and the picker falls back
   * to listing devices without saying what they hold.
   */
  discoverRuntimes?(agentId: string): Promise<DiscoveredOrchestratorRuntime[]>
}
