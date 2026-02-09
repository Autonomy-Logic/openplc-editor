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
  /** Default value */
  defaultValue?: string
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
