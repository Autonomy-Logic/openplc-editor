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
  /**
   * DOPE-704 E1: Indices of other PDOs this one excludes. When assigned, each excluded
   * PDO becomes unassignable in the Simple view with the tooltip "excluded by <index>".
   * Normalised to the same `0x1A00` form the editor uses elsewhere.
   */
  exclude?: string[]
  /**
   * DOPE-704 E1: Object Strand Max (ESI `OSMax`). Zero or absent means no object strand
   * expansion. The generator expands PDO entries into `osMax` copies with each copy's
   * entry index incremented by `osIndexInc`. Used by multi-channel modules.
   */
  osMax?: number
  osIndexInc?: number
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

// ===================== DEVICE ENRICHMENT =====================

/**
 * Data extracted from a full ESIDevice for persistence into ConfiguredEtherCATDevice.
 * Returned by enrichDeviceData() and used by device configuration components.
 */
export type EnrichDeviceData = {
  channelInfo?: PersistedChannelInfo[]
  channelMappings?: EtherCATChannelMapping[]
  rxPdos?: PersistedPdo[]
  txPdos?: PersistedPdo[]
  slaveType?: string
  sdoConfigurations?: SDOConfigurationEntry[]
  /** DOPE-704 E1: CoE flags lifted from the ESI's `<Mailbox><CoE />`. */
  coeFlags?: EtherCATSlaveConfig['coeFlags']
  /** DOPE-704 E1: true when the ESI declares a `<Slots>` block. */
  isModularCoupler?: boolean
}

// ===================== DEVICE =====================

/**
 * DOPE-704 E1: ESI `InitCmd` as the master emits it at startup.
 *
 * The ESI's `<InitCmds>` block declares SDO writes the master must send during the state
 * transition named by `transition` (e.g. "PS" for PRE-OP → SAFE-OP). A module's own
 * `InitCmd`s are stamped by its slot: the generator renumbers `index` by
 * (slot - 1) × `SlotIndexIncrement` before emitting.
 *
 * Byte-string payloads (e.g. a module's name written to 0x80n0:03) are kept in
 * `dataAscii` and emitted through EtherDOG's `value_bytes` field; the hex form in
 * `data` is preferred when both are present. Numeric payloads use `value` + `dataType`.
 */
export interface ESIInitCmd {
  /** Transition name: "IP" (INIT→PRE-OP), "PS" (PRE-OP→SAFE-OP), "SO" (SAFE-OP→OP) etc. */
  transition: string
  /** Command class, usually "SDO" for CoE writes. */
  ccs?: string
  /** Object index. */
  index: string
  /** Object sub-index (0 by default). */
  subIndex: number
  /** Hex-encoded payload bytes (e.g. "0xDEADBEEF"). */
  data?: string
  /** Byte-string payload (e.g. a module's name). */
  dataAscii?: string
  /** Numeric payload (when the entry declares a specific type). */
  value?: number
  /** Data type the payload decodes to, when the entry declares one. */
  dataType?: ESIDataType
  /** CoE Complete Access when true. */
  completeAccess?: boolean
  /** Human-readable comment. */
  comment?: string
}

/**
 * DOPE-704 E1: TwinCAT `AlternativeSmMapping` preset. A pre-canned PDO assignment set
 * the ESI offers under a short name (e.g. "CSP mode" on a servo). The editor surfaces
 * these as a dropdown in the Simple view; selecting one assigns exactly the listed PDOs
 * on the named sync manager.
 */
export interface ESIAlternativeSmMapping {
  /** Preset name shown in the UI (e.g. "Position mode"). */
  name: string
  /** Sync manager this preset applies to. */
  syncManager: number
  /** PDO indices to assign (in order). */
  pdoIndices: string[]
}

/**
 * DOPE-704 E1: a single `<Slot>` on an ETG.5001 modular coupler. The slot is where a
 * module physically plugs in; `moduleClass` and `moduleIdents` filter which modules the
 * coupler accepts in this slot.
 */
export interface ESISlot {
  /** Short name for the slot (e.g. "I/O slot"). */
  name?: string
  /** Minimum number of module instances (0 by default; the UR20 bus side slot defaults to 1). */
  minInstances: number
  /** Maximum number of module instances. */
  maxInstances: number
  /** Allowed module classes (free-form vendor strings). */
  moduleClass?: string
  /** Allowed module idents (hex) when the ESI gates by ident rather than class. */
  moduleIdents?: string[]
  /** Default module ident to pre-populate the slot with. */
  defaultModuleIdent?: string
}

/**
 * DOPE-704 E1: the `<Slots>` block from a modular coupler ESI. Presence of this field on
 * an {@link ESIDevice} is what `isModularCoupler` reflects.
 */
export interface ESISlotsSpec {
  slots: ESISlot[]
  /** Per-slot index increment applied to module objects (e.g. 16 for UR20: slot 2's
   *  parameters land at `0x8010`, slot 3's at `0x8020`). */
  slotIndexIncrement: number
  /** Per-slot PDO index increment applied to module PDOs. */
  slotPdoIncrement: number
  /** When true, the generator emits `0xF030` listing the configured module idents. */
  downloadModuleIdentList: boolean
  /** Transition at which to emit the `0xF030` write (e.g. "IP"). */
  downloadModuleListTransition?: string
  /** `IdentifyModuleBy` attribute (usually "ModuleIdent"). */
  identifyModuleBy?: string
  /** Maximum slot count declared by the ESI (informational). */
  maxSlotCount?: number
}

/**
 * DOPE-704 E1: PDO group definition for modular couplers. ETG.5001 orders PDOs in the
 * generated bus config by `ModulePdoGroup` first, then by slot.
 */
export interface ESIModulePdoGroup {
  /** Group index (0 for coupler PDOs, 1+ for module PDOs). */
  group: number
  /** Sync manager assignment. */
  sm?: number
  /** Default RxPDO index template for this group (ETG.5001 names). */
  rxPdoIndex?: string
  /** Default TxPDO index template for this group. */
  txPdoIndex?: string
}

/**
 * DOPE-704 E1: an ETG.5001 I/O module. Parsed from the module ESI by
 * {@link parseESIModuleFull}. The module's RxPDOs, TxPDOs, CoE objects and `InitCmd`s
 * are generated with slot-adjusted indices by the generator.
 */
export interface ESIModule {
  /** Module ident (hex, e.g. "0x14081A0F"). Primary key for matching against `0xF050`. */
  ident: string
  /** Module name shown in the UI. */
  name: string
  /** Module class (free-form vendor string; matched against `ESISlot.moduleClass`). */
  moduleClass?: string
  /** Module description. */
  description?: string
  /** PDO group ID that governs this module's PDO ordering. */
  modulePdoGroup?: number
  /** Module RxPDOs (slot-adjusted at emit time). */
  rxPdo: ESIPdo[]
  /** Module TxPDOs (slot-adjusted at emit time). */
  txPdo: ESIPdo[]
  /** Module CoE objects (slot-adjusted at emit time). */
  coeObjects?: ESICoEObject[]
  /** Module `InitCmd`s (slot-adjusted at emit time). */
  initCmds: ESIInitCmd[]
}

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
  /**
   * DOPE-704 E1: CoE flags from `<Mailbox><CoE />`. Defaulted to the ESI values on
   * device import; the user can override in the Expert view. The generator uses these
   * to decide whether to emit `0x1C1n` assignment writes and complete-access SDO writes.
   */
  coeFlags?: {
    pdoAssign: boolean
    pdoConfig: boolean
    completeAccess: boolean
  }
  /** DOPE-704 E1: ESI startup commands at slave scope. */
  initCmds?: ESIInitCmd[]
  /** DOPE-704 E1: TwinCAT `AlternativeSmMapping` presets, when the ESI declares them. */
  alternativeSmMappings?: ESIAlternativeSmMapping[]
  /**
   * DOPE-704 E1: `<Slots>` block present when the device is a modular coupler (ETG.5001).
   * Non-null for UR20-class couplers; undefined for plain slaves and multi-mode drives.
   */
  slots?: ESISlotsSpec
  /** DOPE-704 E1: PDO group definitions on a modular coupler. */
  modulePdoGroups?: ESIModulePdoGroup[]
  /**
   * DOPE-704 E1: Modules defined inline in the device ESI (vs. referenced through an
   * external module ESI file). The coupler's catalogue combines these with external
   * modules looked up by `parseESIModuleFull`.
   */
  modules?: ESIModule[]
  /**
   * DOPE-704 E1: true when the device declares `<Slots>` and is to be treated as a
   * modular coupler. Mirrors the summary flag; present on the full device for consumers
   * that pass {@link ESIDevice} around without the summary.
   */
  isModularCoupler?: boolean
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
  /**
   * Whether the PDO is in the slave's assignment (ESI `Sm` or `Mandatory`). Absent in projects
   * saved before it was recorded, which are treated as every PDO assigned.
   */
  assigned?: boolean
  /**
   * DOPE-704 E2: ESI defaults carried forward on first import.
   */
  fixed?: boolean
  mandatory?: boolean
  /** Default sync manager this PDO is assigned to in the ESI. */
  sm?: number
  /**
   * DOPE-704 E2: PDO indices this one excludes (from the ESI `<Exclude>` children). The
   * Process Data view greys an excluded PDO when its excluder is assigned, with the
   * excluding PDO named in the tooltip.
   */
  exclude?: string[]
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
  /** IEC 61131-3 located variable address (e.g., "%IX0.0", "%QW2").
   *  Editor-allocated; never user-edited (the picker uses the alias). */
  iecLocation: string
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
  /**
   * DOPE-704 E1: true when the device declares a `<Slots>` block (ETG.5001 modular
   * coupler). Used by the ESI browser to indicate modular couplers in the list and by
   * the project tree to decide whether a Scan modules button appears on the coupler.
   */
  isModularCoupler?: boolean
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
  /** ISO 8601 UTC timestamp when this file was loaded */
  loadedAt: string
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
  /** ISO 8601 UTC timestamp when this file was loaded */
  loadedAt: string
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
  /** CiA 402 SoftMotion axis configuration (present when recognized as a drive) */
  cia402?: Cia402AxisConfig
  /**
   * DOPE-704 E4: modules plugged into this coupler, in slot order. Present only when the
   * underlying ESI device declares a `<Slots>` block (i.e. the ESI is a modular coupler).
   * The project tree renders the modules one indentation level below the coupler, the
   * generator renumbers each module's PDO and object indices by its slot, and the address
   * pool walks the modules to claim channel addresses.
   */
  modules?: ConfiguredEtherCATModule[]
  /**
   * DOPE-704 E1: true when the underlying ESI device declares a `<Slots>` block. Set once
   * at import time from the parsed ESI so the UI can render the "Add module to slot N"
   * flow (E4/E5 UI) without re-loading the ESI, and the project tree can render the
   * three-level nesting (bus → coupler → modules) even when `modules` is still empty.
   */
  isModularCoupler?: boolean
}

/**
 * DOPE-704 E4: one I/O module plugged into a modular coupler. The module is a first-class
 * element in the project model with its own tab, its own channel mappings and its own
 * startup SDOs; it is NOT an EtherCAT slave of its own (ETG.5001 moves process data
 * through the coupler's single slave position).
 */
export interface ConfiguredEtherCATModule {
  /** Stable identifier within the coupler (used in project tree keys and address-pool refs). */
  id: string
  /** 1-based slot the module occupies on the coupler's backplane. */
  slot: number
  /** User-editable display name (defaults to the module's ESI name). */
  name: string
  /** Module ident, hex (e.g. "0x1A0F"). Matches ESIModule.ident and the coupler's 0xF030. */
  ident: string
  /**
   * Reference to the module's ESI definition. For a module defined inline in the coupler's
   * ESI, this points at the coupler's repository item and names the module ident. For an
   * external module ESI file, it points at the module file.
   */
  esiModuleRef: {
    repositoryItemId: string
    moduleIdent: string
  }
  /** Module channel mappings (slot-local channelId → IEC address). */
  channelMappings: EtherCATChannelMapping[]
  /** Enriched channel metadata, mirror of ConfiguredEtherCATDevice.channelInfo. */
  channelInfo?: PersistedChannelInfo[]
  /** Module RxPDOs persisted for the generator. */
  rxPdos?: PersistedPdo[]
  /** Module TxPDOs persisted for the generator. */
  txPdos?: PersistedPdo[]
  /** Module startup SDOs (byte-string InitCmd writes carried through to EtherDOG). */
  sdoConfigurations?: SDOConfigurationEntry[]
}

/**
 * Per-axis CiA 402 SoftMotion configuration persisted on a recognized drive.
 * Mirrors the AXIS_REF_SM3 scaling fields; increments-per-unit is derived as
 * scaleFactor * scaleNum / scaleDenom. When `enabled`, the compile step
 * generates the AXIS_REF_SM3 global, located PDO scalars, and the per-scan
 * SM_Drive_GenericDS402 bridge for this device.
 */
export interface Cia402AxisConfig {
  /** TRUE = treat this EtherCAT device as a SoftMotion axis. */
  enabled: boolean
  /** iRatioTechUnitsNum (CODESYS param 1052). */
  scaleNum: number
  /** dwRatioTechUnitsDenom (CODESYS param 1051). */
  scaleDenom: number
  /** fScalefactor (CODESYS param 1054) — increments per user unit. */
  scaleFactor: number
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
}

/**
 * Addressing configuration for an EtherCAT slave.
 */
export interface EtherCATAddressing {
  /** Fixed EtherCAT station address (configured address). 0 = auto-assign from position (1001+) */
  ethercatAddress: number
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
  /**
   * DOPE-704 E2: CoE flags defaulted from the ESI's `<Mailbox><CoE />` attributes on first
   * device import and overridable in the Expert view. The generator uses these to decide
   * whether to emit `0x1C1n` PDO assignment writes and Complete Access SDO writes.
   *
   * Optional for backward compatibility with projects saved before this field existed; the
   * migration helper {@link migrateSlaveToE2Schema} fills them in from the ESI on open.
   */
  coeFlags?: {
    pdoAssign: boolean
    pdoConfig: boolean
    completeAccess: boolean
  }
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
