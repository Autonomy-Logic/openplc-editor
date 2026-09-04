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
/**
 * What the orchestrator agent knows about the machine it runs on.
 *
 * The Runtime Status header's real source in production. Devices under an
 * orchestrator are vPLC containers with no bootloader beside them, so the
 * bootloader's device-info endpoint answers nothing there and the header sat
 * blank. The agent already collects exactly these facts for its own
 * consumption reporting (`tools/system_info.py::get_static_system_info`), and
 * Edge bridges them to REST at `GET /orchestrators/:id/details`.
 *
 * Every field is optional: an agent too old to report, or one that is offline
 * when asked, yields nothing rather than an error.
 */
export type OrchestratorHostInfo = {
  /** Operating system description, e.g. "Debian GNU/Linux 12 (bookworm)". */
  os?: string
  /**
   * Host kernel version, e.g. "6.12.35-rt10-v8+".
   *
   * The agent has always sent this; Edge did not declare it until EDGE-631,
   * so it could not be read. An older Edge simply yields nothing here.
   */
  kernel?: string
  /** CPU count, as the agent reports it. */
  cpu?: string
  /** Total RAM in MB, as the agent reports it. */
  memory?: string
  /** Total disk in GB, as the agent reports it. */
  disk?: string
  /** Version of the agent itself. */
  agentVersion?: string
  /** The orchestrator's name, which is the closest thing to a hostname here. */
  name?: string
}

export interface OrchestratorPort {
  /** Fetch all orchestrators with their devices. */
  listOrchestrators(): Promise<OrchestratorInfo[]>

  /**
   * Host facts for one orchestrator, from its agent.
   *
   * Optional: it needs an agent that answers the consumption request Edge
   * forwards, and an Edge new enough to expose the details route. A failure
   * yields nothing and the header simply shows less.
   *
   * `kernel` needs an Edge carrying EDGE-631; against an older one the field
   * is simply absent and the header shows less.
   */
  getOrchestratorHostInfo?(orchestratorId: string): Promise<OrchestratorHostInfo | null>

  /**
   * Ask one orchestrator's agent what its runtimes are advertising.
   *
   * Optional because it needs an agent new enough to answer the scan; an
   * orchestrator that cannot simply yields nothing, and the picker falls back
   * to listing devices without saying what they hold.
   */
  discoverRuntimes?(agentId: string): Promise<DiscoveredOrchestratorRuntime[]>
}
