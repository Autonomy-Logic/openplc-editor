/**
 * EtherCAT Discovery Service Types
 *
 * Types for communication with the OpenPLC Runtime EtherCAT discovery endpoints.
 * Based on the runtime's /api/discovery/* REST API.
 */

// Re-export ESI types
export * from './esi-types'

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
 * Slave configuration for validation
 */
export interface EtherCATSlaveConfig {
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
  slaves: EtherCATSlaveConfig[]
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
