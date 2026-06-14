/**
 * EtherCAT Discovery Service Types
 *
 * Types for communication with the OpenPLC Runtime EtherCAT discovery endpoints.
 * Based on the runtime's /api/discovery/* REST API.
 */

// NOTE: ESI types (ESIDevice, ESIRepositoryItemLight, etc.) live in
// src/middleware/shared/ports/esi-types.ts (shared surface). Import them
// from '@root/middleware/shared/ports/esi-types' directly.

// ===================== ENUMS =====================

/**
 * Status codes returned by the discovery service
 */
export type EtherCATDiscoveryStatus =
  | 'success'
  | 'error'
  | 'timeout'
  | 'permission_denied'
  | 'interface_not_found'
  | 'not_available'

/**
 * EtherCAT slave states as reported by the discovery service
 */
export type EtherCATSlaveState = 'NONE' | 'INIT' | 'PRE-OP' | 'BOOT' | 'SAFE-OP' | 'OP' | 'UNKNOWN'

// ===================== NETWORK INTERFACES =====================

/**
 * Represents a network interface available for EtherCAT communication
 */
export interface NetworkInterface {
  /** Interface name (e.g., "eth0", "enp3s0") */
  name: string
  /** Human-readable description of the interface */
  description: string
}

/**
 * Response from GET /api/discovery/interfaces
 */
export interface NetworkInterfacesResponse {
  status: 'success' | 'error'
  interfaces: NetworkInterface[]
  message?: string
}

// ===================== ETHERCAT DEVICE =====================

/**
 * Represents an EtherCAT slave device discovered on the network
 */
export interface EtherCATDevice {
  /** Position in the EtherCAT chain (1-indexed) */
  position: number
  /** Device name (e.g., "EK1100", "EL1008") */
  name: string
  /** Vendor ID (e.g., 2 for Beckhoff) */
  vendor_id: number
  /** Product code identifying the device type */
  product_code: number
  /** Hardware revision number */
  revision: number
  /** Serial number (0 if not available) */
  serial_number: number
  /** Configured station address */
  config_address: number
  /** Alias address (0 if not set) */
  alias: number
  /** Current EtherCAT state */
  state: EtherCATSlaveState
  /** AL (Application Layer) status code */
  al_status_code: number
  /** Whether the device supports CoE (CANopen over EtherCAT) */
  has_coe: boolean
  /** Number of input bytes */
  input_bytes: number
  /** Number of output bytes */
  output_bytes: number
}

// ===================== SERVICE STATUS =====================

/**
 * Response from GET /api/discovery/ethercat/status
 */
export interface EtherCATServiceStatusResponse {
  /** Whether the EtherCAT discovery service is available */
  available: boolean
  /** Status message */
  message: string
}

// ===================== SCAN =====================

/**
 * Request body for POST /api/discovery/ethercat/scan
 */
export interface EtherCATScanRequest {
  /** Network interface to scan (e.g., "eth0") */
  interface: string
  /** Scan timeout in milliseconds (default: 5000) */
  timeout_ms?: number
}

/**
 * Response from POST /api/discovery/ethercat/scan
 */
export interface EtherCATScanResponse {
  status: EtherCATDiscoveryStatus
  /** List of discovered EtherCAT devices */
  devices: EtherCATDevice[]
  /** Human-readable result message */
  message: string
  /** Time taken to complete the scan in milliseconds */
  scan_time_ms: number
  /** Interface that was scanned */
  interface: string
}

// ===================== CONNECTION TEST =====================

/**
 * Request body for POST /api/discovery/ethercat/test
 */
export interface EtherCATTestRequest {
  /** Network interface to use */
  interface: string
  /** Position of the slave to test (1-indexed) */
  position: number
  /** Connection test timeout in milliseconds (default: 3000) */
  timeout_ms?: number
}

/**
 * Response from POST /api/discovery/ethercat/test
 */
export interface EtherCATTestResponse {
  status: EtherCATDiscoveryStatus
  /** Whether the connection was successful */
  connected: boolean
  /** Device information if connected */
  device?: EtherCATDevice
  /** Human-readable result message */
  message: string
  /** Response time in milliseconds */
  response_time_ms: number
}

// ===================== VALIDATION =====================

/**
 * PDO mapping entry for validation
 */
export interface PDOMappingEntry {
  /** PDO address */
  address: string
  /** Optional: data type */
  type?: string
  /** Optional: bit offset */
  bit_offset?: number
}

/**
 * Slave configuration entry for validation requests.
 * Not to be confused with EtherCATSlaveConfig from esi-types.ts (per-slave runtime config).
 */
export interface EtherCATValidationSlaveEntry {
  /** Position in the EtherCAT chain (1-indexed) */
  position: number
  /** Vendor ID */
  vendor_id?: number
  /** Product code */
  product_code?: number
  /** PDO mapping configuration */
  pdo_mapping?: Record<string, PDOMappingEntry>
}

/**
 * Request body for POST /api/discovery/ethercat/validate
 */
export interface EtherCATValidateRequest {
  /** Network interface to use */
  interface: string
  /** List of slave configurations */
  slaves: EtherCATValidationSlaveEntry[]
  /** Cycle time in milliseconds */
  cycle_time_ms?: number
}

/**
 * Response from POST /api/discovery/ethercat/validate
 */
export interface EtherCATValidateResponse {
  /** Whether the configuration is valid */
  valid: boolean
  /** List of validation errors (configuration is invalid if non-empty) */
  errors: string[]
  /** List of warnings (configuration is valid but may have issues) */
  warnings: string[]
}

// ===================== IPC RESPONSE WRAPPERS =====================

/**
 * Generic IPC response wrapper for EtherCAT operations
 */
export interface EtherCATIPCResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * IPC response for listing network interfaces
 */
export type ListInterfacesIPCResponse = EtherCATIPCResponse<NetworkInterface[]>

/**
 * IPC response for checking service status
 */
export type ServiceStatusIPCResponse = EtherCATIPCResponse<EtherCATServiceStatusResponse>

/**
 * IPC response for scanning EtherCAT devices
 */
export type ScanDevicesIPCResponse = EtherCATIPCResponse<EtherCATScanResponse>

/**
 * IPC response for testing connection to a device
 */
export type TestConnectionIPCResponse = EtherCATIPCResponse<EtherCATTestResponse>

/**
 * IPC response for validating configuration
 */
export type ValidateConfigIPCResponse = EtherCATIPCResponse<EtherCATValidateResponse>

// ===================== RUNTIME STATUS MONITORING =====================

/**
 * EtherCAT plugin state machine states as reported by the runtime
 */
export type EtherCATPluginState =
  | 'IDLE'
  | 'SCANNING'
  | 'CONFIGURING'
  | 'TRANSITIONING'
  | 'OPERATIONAL'
  | 'RECOVERING'
  | 'ERROR'
  | 'STOPPED'

/**
 * Per-slave status snapshot from the runtime
 */
export interface EtherCATSlaveStatus {
  /** Position in the EtherCAT chain (1-indexed) */
  position: number
  /** Device name */
  name: string
  /** Current EtherCAT AL state (e.g., "OP", "SAFE-OP", "INIT") */
  state: string
  /** AL status code (0 = no error) */
  al_status_code: number
  /** Cumulative error count for this slave */
  error_count: number
  /** Whether the slave has an error condition */
  has_error: boolean
}

/**
 * Cycle performance metrics from the EtherCAT bus thread.
 *
 * Two distinct categories:
 *
 *   Work-window — `avg_cycle_us`, `max_cycle_us`, `max_exchange_us`.
 *     How long each cycle's work actually takes (mutex+exchange+mutex).
 *     Tells you whether the configured period is enough to fit one
 *     SOEM round-trip plus the IO copies. `cycle - exchange` exposes
 *     buffer-mutex contention with the IEC tasks.
 *
 *   Scheduling — `avg/max/min_period_us`, `avg/max/min_latency_us`.
 *     How well the bus thread is being scheduled. `period_us` is the
 *     observed time between cycle starts (should equal the configured
 *     cycle on average); `latency_us` is the wake-up delay from the
 *     absolute clock_nanosleep deadline. Spikes here point at OS
 *     scheduling jitter, not bus or PLC issues.
 */
export interface EtherCATCycleMetrics {
  /** Total cycles executed since last reset */
  cycle_count: number
  /** Total WKC errors since last reset */
  wkc_error_count: number
  /** Moving-average bus-exchange duration in microseconds. Time-based EWMA
   *  with a ~2 s wall-clock window (matches the editor poll cadence). */
  avg_cycle_us: number
  /** Best-case bus-exchange duration in microseconds */
  min_cycle_us: number
  /** Worst-case bus-exchange duration in microseconds */
  max_cycle_us: number
  /** Best-case process data exchange time in microseconds (just SOEM RTT) */
  min_exchange_us: number
  /** Maximum process data exchange time in microseconds (just SOEM RTT) */
  max_exchange_us: number
  /** Average observed period between cycle starts (microseconds). On a
   *  healthy RT system this equals the configured cycle time. */
  avg_period_us: number
  /** Worst-case observed cycle period in microseconds */
  max_period_us: number
  /** Best-case observed cycle period in microseconds */
  min_period_us: number
  /** Average wake-up scheduling delay (microseconds). How much later
   *  than its absolute deadline the bus thread actually started a cycle. */
  avg_latency_us: number
  /** Worst-case wake-up scheduling delay in microseconds */
  max_latency_us: number
  /** Best-case wake-up scheduling delay in microseconds */
  min_latency_us: number
  /** Current consecutive WKC error count */
  consecutive_wkc_errors: number
  /** Number of recovery attempts since last successful recovery */
  recovery_attempts: number
}

/**
 * Per-master status snapshot (used in multi-master responses)
 */
export interface EtherCATMasterStatus {
  /** Master name from configuration */
  name: string
  /** Current plugin state */
  plugin_state: EtherCATPluginState
  /** Number of configured slaves */
  slave_count: number
  /** Expected working counter value */
  expected_wkc: number
  /** Per-slave status array */
  slaves: EtherCATSlaveStatus[]
  /** Cycle performance metrics */
  metrics: EtherCATCycleMetrics
}

/**
 * Response from GET /api/discovery/ethercat/runtime-status
 *
 * The runtime returns a "masters" array entry per configured EtherCAT bus.
 */
export interface EtherCATRuntimeStatusResponse {
  /** Per-master status array (one entry per configured EtherCAT bus) */
  masters: EtherCATMasterStatus[]
}

/**
 * IPC response for getting runtime status
 */
export type RuntimeStatusIPCResponse = EtherCATIPCResponse<EtherCATRuntimeStatusResponse>
