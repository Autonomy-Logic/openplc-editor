/**
 * EtherCAT Slave Information (ESI) Types
 *
 * Types for parsing and representing ESI XML files following ETG.2000 specification.
 * ESI files describe EtherCAT slave device properties, PDO mappings, and communication settings.
 */

// ===================== VENDOR =====================

/**
 * Vendor information from ESI file
 */
export interface ESIVendor {
  /** Vendor ID (hex format, e.g., "0x0002" for Beckhoff) */
  id: string
  /** Vendor name */
  name: string
}

// ===================== DEVICE INFO =====================

/**
 * Device type information
 */
export interface ESIDeviceType {
  /** Product code (hex format) */
  productCode: string
  /** Revision number (hex format) */
  revisionNo: string
  /** Type name/description */
  name: string
}

/**
 * Sync Manager configuration
 */
export interface ESISyncManager {
  /** SM index (0-3 typically) */
  index: number
  /** Start address */
  startAddress: string
  /** Control byte */
  controlByte: string
  /** Default size */
  defaultSize: number
  /** Enable flag */
  enable: boolean
  /** SM type: Mailbox Out, Mailbox In, Process Data Out, Process Data In */
  type: 'MbxOut' | 'MbxIn' | 'Outputs' | 'Inputs'
}

/**
 * FMMU (Fieldbus Memory Management Unit) configuration
 */
export interface ESIFMMU {
  /** FMMU type: Outputs, Inputs, MbxState */
  type: 'Outputs' | 'Inputs' | 'MbxState'
}

// ===================== PDO ENTRIES =====================

/**
 * EtherCAT data types used in PDO entries
 * Common types: BOOL, SINT, INT, DINT, LINT, USINT, UINT, UDINT, ULINT,
 * REAL, LREAL, STRING, BYTE, WORD, DWORD, BIT, BIT2-BIT7
 * Using string to allow vendor-specific custom types
 */
export type ESIDataType = string

/**
 * PDO Entry - represents a single variable in a PDO
 */
export interface ESIPdoEntry {
  /** Entry index (hex, e.g., "#x6000") */
  index: string
  /** Entry subindex (hex, e.g., "#x01") */
  subIndex: string
  /** Bit length of the data */
  bitLen: number
  /** Entry name/identifier */
  name: string
  /** Data type */
  dataType: ESIDataType
  /** Optional: Comment/description */
  comment?: string
}

/**
 * Process Data Object - TxPdo (slave to master) or RxPdo (master to slave)
 */
export interface ESIPdo {
  /** PDO index (hex, e.g., "#x1600" for RxPdo, "#x1A00" for TxPdo) */
  index: string
  /** PDO name */
  name: string
  /** Whether this PDO is fixed (cannot be modified) */
  fixed: boolean
  /** Whether this PDO is mandatory */
  mandatory: boolean
  /** SM index this PDO is assigned to */
  smIndex?: number
  /** List of entries in this PDO */
  entries: ESIPdoEntry[]
}

// ===================== COE (CANopen over EtherCAT) =====================

/**
 * CoE Object Dictionary entry
 */
export interface ESICoEObject {
  /** Object index (hex) */
  index: string
  /** Object name */
  name: string
  /** Object type */
  type: string
  /** Bit size */
  bitSize: number
  /** Access rights */
  access: 'RO' | 'RW' | 'WO'
  /** PDO mapping allowed */
  pdoMapping: boolean
  /** Object category: M=Mandatory, O=Optional, C=Conditional */
  category?: 'M' | 'O' | 'C'
  /** PDO mapping direction: R=RxPDO, T=TxPDO, RT=both */
  pdoMappingDirection?: 'R' | 'T' | 'RT'
  /** Default value */
  defaultValue?: string
  /** Subindexes for complex objects */
  subItems?: ESICoESubItem[]
}

/**
 * CoE Object subitem (for array/record types)
 */
export interface ESICoESubItem {
  /** Subindex */
  subIndex: string
  /** Name */
  name: string
  /** Data type */
  type: string
  /** Bit size */
  bitSize: number
  /** Access rights */
  access: 'RO' | 'RW' | 'WO'
  /** Whether this sub-item can be PDO-mapped */
  pdoMapping?: boolean
  /** Default value */
  defaultValue?: string
}

// ===================== SDO CONFIGURATION =====================

/**
 * SDO (Service Data Object) configuration entry for startup parameters.
 * Each entry represents a single parameter to be written to the slave at startup.
 */
export interface SDOConfigurationEntry {
  /** Object index (hex, e.g., "0x8000") */
  index: string
  /** Subindex: 0 for simple objects, 1+ for sub-items */
  subIndex: number
  /** Value configured by the user */
  value: string
  /** Default value from the ESI */
  defaultValue: string
  /** Data type (e.g., "UINT16", "BOOL") */
  dataType: string
  /** Bit length of the parameter */
  bitLength: number
  /** Parameter name */
  name: string
  /** Parent object name */
  objectName: string
}

// ===================== DEVICE =====================

/**
 * Complete ESI Device representation
 */
export interface ESIDevice {
  /** Device type information */
  type: ESIDeviceType
  /** Device name */
  name: string
  /** Group name (category) */
  groupName?: string
  /** Physics type (e.g., "YY") */
  physics?: string
  /** FMMU configurations */
  fmmu: ESIFMMU[]
  /** Sync Manager configurations */
  syncManagers: ESISyncManager[]
  /** RxPDOs (master to slave) */
  rxPdo: ESIPdo[]
  /** TxPDOs (slave to master) */
  txPdo: ESIPdo[]
  /** CoE objects (optional) */
  coeObjects?: ESICoEObject[]
  /** Device image URL (optional) */
  imageUrl?: string
  /** Additional description */
  description?: string
}

// ===================== GROUP =====================

/**
 * Device group/category
 */
export interface ESIGroup {
  /** Group type identifier */
  type: string
  /** Group name */
  name: string
  /** Group image URL (optional) */
  imageUrl?: string
  /** Group description */
  description?: string
}

// ===================== COMPLETE ESI FILE =====================

/**
 * Complete ESI file representation
 */
export interface ESIFile {
  /** Vendor information */
  vendor: ESIVendor
  /** Device groups */
  groups: ESIGroup[]
  /** Devices in the file */
  devices: ESIDevice[]
  /** Original filename */
  filename?: string
  /** File version info */
  version?: string
  /** Creation/modification info */
  infoData?: {
    version?: string
    creationDate?: string
    modificationDate?: string
    vendorUrl?: string
  }
}

// ===================== PARSED CHANNEL (for UI) =====================

/**
 * Represents a channel that can be mapped to a located variable
 * This is a flattened view of PDO entries for easier UI handling
 */
export interface ESIChannel {
  /** Unique identifier for this channel */
  id: string
  /** PDO type: input (TxPdo) or output (RxPdo) */
  direction: 'input' | 'output'
  /** Parent PDO index */
  pdoIndex: string
  /** Parent PDO name */
  pdoName: string
  /** Entry index */
  entryIndex: string
  /** Entry subindex */
  entrySubIndex: string
  /** Channel name */
  name: string
  /** Data type */
  dataType: ESIDataType
  /** Bit length */
  bitLen: number
  /** Bit offset within the PDO */
  bitOffset: number
  /** Byte offset (calculated) */
  byteOffset: number
  /** IEC 61131-3 compatible type */
  iecType: string
  /** Whether this channel is selected for mapping */
  selected?: boolean
  /** Mapped variable name (if assigned) */
  mappedVariable?: string
}

// ===================== PERSISTED PDO/CHANNEL DATA =====================

/**
 * Persisted PDO entry - stored in project.json for runtime config generation.
 * Includes padding entries (index "0x0000") for complete PDO layout.
 */
export interface PersistedPdoEntry {
  /** Entry index (hex, e.g., "0x6000") */
  index: string
  /** Entry subindex (hex, e.g., "0x01") */
  subIndex: string
  /** Bit length of the data */
  bitLen: number
  /** Entry name */
  name: string
  /** Data type (e.g., "BOOL", "INT16", "BIT" for padding) */
  dataType: string
}

/**
 * Persisted PDO - stored in project.json for runtime config generation.
 */
export interface PersistedPdo {
  /** PDO index (hex, e.g., "0x1A00") */
  index: string
  /** PDO name */
  name: string
  /** PDO entries including padding */
  entries: PersistedPdoEntry[]
}

/**
 * Persisted channel info with full metadata from ESI.
 * Enriches the minimal channelId stored in EtherCATChannelMapping.
 */
export interface PersistedChannelInfo {
  /** Unique channel ID matching ESIChannel.id format */
  channelId: string
  /** Channel display name from ESI */
  name: string
  /** Channel direction */
  direction: 'input' | 'output'
  /** Parent PDO index (hex) */
  pdoIndex: string
  /** Entry index (hex) */
  entryIndex: string
  /** Entry subindex (hex) */
  entrySubIndex: string
  /** ESI data type */
  dataType: string
  /** Bit length */
  bitLen: number
  /** IEC 61131-3 compatible type */
  iecType: string
}

// ===================== CHANNEL MAPPING =====================

/**
 * Mapping of an ESI channel to an IEC 61131-3 located variable address
 */
export interface EtherCATChannelMapping {
  /** Matches ESIChannel.id */
  channelId: string
  /** IEC 61131-3 located variable address (e.g., "%IX0.0", "%QW2") */
  iecLocation: string
  /** True if the user manually edited this address */
  userEdited: boolean
  /** User-editable alias for this channel mapping */
  alias?: string
}

// ===================== PARSE RESULT =====================

/**
 * Result of parsing an ESI file
 */
export interface ESIParseResult {
  success: boolean
  data?: ESIFile
  error?: string
  warnings?: string[]
}

// ===================== DEVICE SUMMARY (lightweight) =====================

/**
 * Lightweight device metadata without PDOs/SM/FMMU.
 * Used for repository listing and device matching without full parsing.
 */
export interface ESIDeviceSummary {
  /** Device type information */
  type: ESIDeviceType
  /** Device name */
  name: string
  /** Group name (category) */
  groupName?: string
  /** Physics type (e.g., "YY") */
  physics?: string
  /** Pre-computed count of non-padding TxPDO entries */
  inputChannelCount: number
  /** Pre-computed count of non-padding RxPDO entries */
  outputChannelCount: number
  /** Pre-computed total input bytes */
  totalInputBytes: number
  /** Pre-computed total output bytes */
  totalOutputBytes: number
  /** Additional description */
  description?: string
}

// ===================== REPOSITORY =====================

/**
 * Item in the ESI repository (a loaded ESI file)
 */
export interface ESIRepositoryItem {
  /** Unique identifier for this repository item */
  id: string
  /** Original filename */
  filename: string
  /** Vendor information */
  vendor: ESIVendor
  /** Devices contained in this file */
  devices: ESIDevice[]
  /** Timestamp when this file was loaded */
  loadedAt: number
  /** Parsing warnings (non-fatal issues) */
  warnings?: string[]
}

/**
 * Lightweight repository item with device summaries instead of full ESIDevice objects.
 * Used for UI display and matching without loading full PDO data.
 */
export interface ESIRepositoryItemLight {
  /** Unique identifier for this repository item */
  id: string
  /** Original filename */
  filename: string
  /** Vendor information */
  vendor: ESIVendor
  /** Lightweight device summaries */
  devices: ESIDeviceSummary[]
  /** Timestamp when this file was loaded */
  loadedAt: number
  /** Parsing warnings (non-fatal issues) */
  warnings?: string[]
}

// ===================== CONFIGURED DEVICES =====================

/**
 * Reference to an ESI device in the repository
 */
export interface ESIDeviceRef {
  /** ID of the repository item containing the device */
  repositoryItemId: string
  /** Index of the device within the repository item */
  deviceIndex: number
}

/**
 * A configured EtherCAT device in the project
 */
export interface ConfiguredEtherCATDevice {
  /** Unique identifier */
  id: string
  /** Position in the EtherCAT network (from scan or manual assignment) */
  position?: number
  /** User-editable name for this device */
  name: string
  /** Reference to the ESI device definition */
  esiDeviceRef: ESIDeviceRef
  /** Vendor ID (hex format) */
  vendorId: string
  /** Product code (hex format) */
  productCode: string
  /** Revision number (hex format) */
  revisionNo: string
  /** How this device was added */
  addedFrom: 'repository' | 'scan'
  /** Per-slave configuration settings */
  config: EtherCATSlaveConfig
  /** Channel-to-located-variable mappings */
  channelMappings: EtherCATChannelMapping[]
  /** Enriched channel metadata from ESI (persisted for runtime config generation) */
  channelInfo?: PersistedChannelInfo[]
  /** RxPDOs with full layout including padding (persisted for runtime config generation) */
  rxPdos?: PersistedPdo[]
  /** TxPDOs with full layout including padding (persisted for runtime config generation) */
  txPdos?: PersistedPdo[]
  /** Slave device type classification (e.g., "digital_input", "coupler") */
  slaveType?: string
  /** SDO startup parameters extracted from CoE Object Dictionary */
  sdoConfigurations?: SDOConfigurationEntry[]
}

// ===================== PER-SLAVE CONFIGURATION =====================

/**
 * Startup identity checks for an EtherCAT slave.
 * When enabled, the master verifies the slave's identity during startup.
 */
export interface EtherCATStartupChecks {
  /** Verify slave vendor ID matches ESI definition */
  checkVendorId: boolean
  /** Verify slave product code matches ESI definition */
  checkProductCode: boolean
  /** Verify slave revision number matches ESI definition */
  checkRevisionNumber: boolean
  /** Download expected PDO/slot configuration to slave at startup */
  downloadPdoConfig: boolean
}

/**
 * Addressing configuration for an EtherCAT slave.
 */
export interface EtherCATAddressing {
  /** Fixed EtherCAT station address (configured address). 0 = auto-assign from position (1001+) */
  ethercatAddress: number
  /** Mark slave as optional - network continues if this slave is absent */
  optionalSlave: boolean
}

/**
 * Timeout settings for an EtherCAT slave.
 */
export interface EtherCATTimeouts {
  /** SDO (Service Data Object) operation timeout in milliseconds */
  sdoTimeoutMs: number
  /** Init to Pre-Operational state transition timeout in milliseconds */
  initToPreOpTimeoutMs: number
  /** Pre-Op to Safe-Op and Safe-Op to Operational transition timeout in milliseconds */
  safeOpToOpTimeoutMs: number
}

/**
 * Watchdog settings for an EtherCAT slave.
 */
export interface EtherCATWatchdog {
  /** Enable Sync Manager watchdog */
  smWatchdogEnabled: boolean
  /** Sync Manager watchdog time in milliseconds */
  smWatchdogMs: number
  /** Enable Process Data Interface (PDI) watchdog */
  pdiWatchdogEnabled: boolean
  /** PDI watchdog time in milliseconds */
  pdiWatchdogMs: number
}

/**
 * Distributed Clocks (DC) settings for an EtherCAT slave.
 * DC provides synchronized timing across all slaves in the network.
 */
export interface EtherCATDistributedClocks {
  /** Enable Distributed Clocks for this slave */
  dcEnabled: boolean
  /** Base sync unit cycle time in microseconds. 0 = use master cycle time */
  dcSyncUnitCycleUs: number
  /** Enable SYNC0 pulse generation */
  dcSync0Enabled: boolean
  /** SYNC0 cycle time in microseconds. 0 = use master cycle time */
  dcSync0CycleUs: number
  /** SYNC0 shift/offset time in microseconds */
  dcSync0ShiftUs: number
  /** Enable SYNC1 pulse generation */
  dcSync1Enabled: boolean
  /** SYNC1 cycle time in microseconds. 0 = use master cycle time */
  dcSync1CycleUs: number
  /** SYNC1 shift/offset time in microseconds */
  dcSync1ShiftUs: number
}

/**
 * Complete per-slave configuration for a configured EtherCAT device.
 */
export interface EtherCATSlaveConfig {
  /** Identity verification during startup */
  startupChecks: EtherCATStartupChecks
  /** Network addressing */
  addressing: EtherCATAddressing
  /** Communication timeouts */
  timeouts: EtherCATTimeouts
  /** Watchdog settings */
  watchdog: EtherCATWatchdog
  /** Distributed Clocks (DC) settings */
  distributedClocks: EtherCATDistributedClocks
}

// ===================== DEVICE MATCHING =====================

/**
 * Quality of match between a scanned device and ESI device
 */
export type DeviceMatchQuality = 'exact' | 'partial' | 'none'

/**
 * A potential match for a scanned device
 */
export interface DeviceMatch {
  /** ID of the repository item containing the matched device */
  repositoryItemId: string
  /** Index of the device within the repository item */
  deviceIndex: number
  /** Quality of the match */
  matchQuality: DeviceMatchQuality
  /** The matched ESI device (lightweight summary) */
  esiDevice: ESIDeviceSummary
}

/**
 * A scanned device with its potential matches from the repository
 */
export interface ScannedDeviceMatch {
  /** The scanned device from network discovery */
  device: {
    position: number
    name: string
    vendor_id: number
    product_code: number
    revision: number
    serial_number: number
    state: string
    input_bytes: number
    output_bytes: number
  }
  /** List of potential matches from the repository */
  matches: DeviceMatch[]
  /** The match selected by the user for addition */
  selectedMatch?: ESIDeviceRef
}
