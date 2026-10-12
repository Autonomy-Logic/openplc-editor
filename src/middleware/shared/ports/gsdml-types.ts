/**
 * GSDML (General Station Description Markup Language) types.
 *
 * In-memory representation of a device description document parsed from a
 * GSDML XML file, following the PI GSDML specification Annex A structural
 * model: Device Access Points (DAP), Modules and Submodules, with their
 * I/O data layouts and parameter record definitions.
 *
 * This representation is intentionally the editor's own domain shape, not
 * a faithful mirror of the XML tree. It is normalised, typed and indexed
 * so the configurator UI can slot/subslot-pick, show parameters and build
 * variable mappings without touching the raw XML again.
 */

// ===================== VENDOR / DEVICE IDENTITY =====================

/**
 * Device identity extracted from DeviceIdentity.
 */
export interface GsdmlDeviceIdentity {
  /** VendorID as hex string, e.g. "0x002A" (Siemens). */
  vendorId: string
  /** DeviceID as hex string, e.g. "0x0313" (ET200SP IM 155-6PN ST). */
  deviceId: string
  /** VendorName, resolved from ExternalText when the identity carries a TextId. */
  vendorName: string
  /** InfoText for the device as a whole, resolved from ExternalText. */
  infoText: string
}

// ===================== I/O DATA =====================

/**
 * Direction of a submodule I/O item: Input (device -> controller) or
 * Output (controller -> device).
 */
export type GsdmlIoDirection = 'input' | 'output'

/**
 * A single data item inside a submodule's I/O area.
 *
 * Mirrors the DataItem element: a typed field with a bit length and an
 * optional per-channel breakdown through UseAsBits (BitDataItem list).
 */
export interface GsdmlDataItem {
  /** Direction this item belongs to. */
  direction: GsdmlIoDirection
  /** GSDML data type literal, e.g. "Unsigned8", "Integer16", "Bit", "OctetString". */
  dataType: string
  /** Bit length of the whole item. */
  bitLength: number
  /** Short label resolved from TextId; empty when none is referenced. */
  text: string
  /** When true, the item is a packed byte broken into individual bits. */
  useAsBits: boolean
  /** Named bit positions, present only when useAsBits is true. */
  bits: GsdmlBitDataItem[]
}

/**
 * One bit of a packed byte declared with UseAsBits.
 */
export interface GsdmlBitDataItem {
  /** 0..7 for a byte-packed item; parser preserves whatever the file says. */
  bitOffset: number
  /** Short label resolved from TextId; empty when none is referenced. */
  text: string
}

/**
 * I/O layout of a submodule: ordered Input and Output items.
 */
export interface GsdmlIoData {
  input: GsdmlDataItem[]
  output: GsdmlDataItem[]
}

// ===================== PARAMETER RECORDS =====================

/**
 * Kind of a parameter field. Driven by the Ref's DataType plus any ValueItem
 * attached through ValueItemTarget.
 */
export type GsdmlParameterFieldKind = 'enum' | 'integer' | 'float' | 'boolean' | 'text' | 'bitfield'

/**
 * A single value option on an enum-kind parameter field, flattened from
 * ValueItem's Assignments list.
 */
export interface GsdmlParameterEnumOption {
  /** Raw value as it will travel on the wire, as a string to preserve width. */
  value: string
  /** Display label resolved from TextId; empty when none is referenced. */
  text: string
}

/**
 * A single configurable field inside a parameter record, built from Ref.
 */
export interface GsdmlParameterField {
  /** Field identifier, from the Ref's Name attribute. */
  name: string
  /** Label resolved from TextId; empty when the Ref has no text. */
  text: string
  /** Byte offset into the record. */
  byteOffset: number
  /** Bit offset within the byte (0 when the field is byte-aligned). */
  bitOffset: number
  /** GSDML data type literal of the field. */
  dataType: string
  /** Classified kind for the UI. */
  kind: GsdmlParameterFieldKind
  /** Default value as a string, when Ref declares one. */
  defaultValue?: string
  /** Allowed numeric range as a half-open "min..max" string, when declared. */
  allowedValues?: string
  /** Options for enum fields; empty for non-enum kinds. */
  enumOptions: GsdmlParameterEnumOption[]
}

/**
 * A parameter record on a submodule, from RecordDataItem.
 *
 * Represents one Record Data Object the controller writes during startup
 * to configure the submodule.
 */
export interface GsdmlParameterRecord {
  /** Record index as hex string, e.g. "0x0001". */
  index: string
  /** Total length in bytes. */
  length: number
  /** Transfer sequence declared on the record, e.g. "Startup". */
  transferSequence: string
  /** Label resolved from TextId; empty when the record has no text. */
  text: string
  /** Ordered fields. */
  fields: GsdmlParameterField[]
}

// ===================== SUBMODULE =====================

/**
 * A submodule entry. Covers both VirtualSubmoduleItem (fixed, inside a
 * module) and the standalone SubmoduleItem referenced by SubmoduleItemRef.
 */
export interface GsdmlSubmodule {
  /** GSDML ID attribute (parser scope). */
  id: string
  /** SubmoduleIdentNumber as hex string. */
  identNumber: string
  /** Short display name resolved from ModuleInfo.Name's TextId. */
  name: string
  /** Longer description resolved from ModuleInfo.InfoText's TextId. */
  infoText: string
  /** I/O layout. */
  io: GsdmlIoData
  /** Parameter records that configure this submodule. */
  parameterRecords: GsdmlParameterRecord[]
  /** True when this submodule is a VirtualSubmoduleItem (fixed inside a module). */
  virtual: boolean
}

// ===================== MODULE =====================

/**
 * A module entry inside the ModuleList, referenced by DAPs through
 * UseableModules -> ModuleItemRef.
 */
export interface GsdmlModule {
  /** GSDML ID attribute. */
  id: string
  /** ModuleIdentNumber as hex string, used by the controller to plug the module. */
  identNumber: string
  /** Short display name resolved from ModuleInfo.Name's TextId. */
  name: string
  /** Longer description resolved from ModuleInfo.InfoText's TextId. */
  infoText: string
  /** Order number as printed on the hardware label; empty when not declared. */
  orderNumber: string
  /** Hardware release label; empty when not declared. */
  hardwareRelease: string
  /** Software release label; empty when not declared. */
  softwareRelease: string
  /** Submodules fixed inside this module (VirtualSubmoduleItem instances). */
  virtualSubmodules: GsdmlSubmodule[]
  /** References to standalone SubmoduleItems this module can carry. */
  submoduleRefs: string[]
}

// ===================== DEVICE ACCESS POINT (DAP) =====================

/**
 * One slot position declared on a DAP.
 */
export interface GsdmlSlotEntry {
  /** Slot number. */
  slotNumber: number
  /** When true, the slot cannot be reassigned (interface/port slot). */
  fixedModule: boolean
  /** ModuleIdentNumber of the module hard-wired to this slot, when fixed. */
  moduleIdentNumber?: string
}

/**
 * A Device Access Point. Represents a configurable device variant: the IM
 * (interface module) a project will plug modules into.
 */
export interface GsdmlDeviceAccessPoint {
  /** GSDML ID attribute. */
  id: string
  /** ModuleIdentNumber of the DAP itself (slot 0 normally). */
  identNumber: string
  /** Short display name resolved from ModuleInfo.Name's TextId. */
  name: string
  /** Longer description resolved from ModuleInfo.InfoText's TextId. */
  infoText: string
  /** Order number as printed on the hardware label; empty when not declared. */
  orderNumber: string
  /** Fixed slot layout exposed by this DAP (interface, ports, head module). */
  slots: GsdmlSlotEntry[]
  /** Module IDs this DAP can carry. */
  useableModuleIds: string[]
  /** Submodules fixed inside the DAP (interface submodules, ports). */
  virtualSubmodules: GsdmlSubmodule[]
}

// ===================== CATALOG =====================

/**
 * Fully parsed GSDML catalog. The main entry point UI code consumes.
 */
export interface GsdmlCatalog {
  /** Device identity: VendorID, DeviceID and resolved names. */
  identity: GsdmlDeviceIdentity
  /** DeviceAccessPointItems indexed by ID. */
  deviceAccessPoints: GsdmlDeviceAccessPoint[]
  /** ModuleItems indexed by ID. */
  modules: GsdmlModule[]
  /** Standalone SubmoduleItems indexed by ID. */
  submodules: GsdmlSubmodule[]
  /** Non-fatal issues the parser logged, e.g. unresolved TextIds. */
  warnings: string[]
  /** Highest GSDML schema version seen in the file (e.g. "V2.45"). */
  schemaVersion: string
}

// ===================== LOOKUPS =====================

/**
 * Convenience lookups built on top of GsdmlCatalog. Not generated by the
 * parser; use buildGsdmlCatalogLookups to derive them.
 */
export interface GsdmlCatalogLookups {
  /** DAPs by their ID. */
  dapById: Map<string, GsdmlDeviceAccessPoint>
  /** Modules by their ID. */
  moduleById: Map<string, GsdmlModule>
  /** Modules by their ModuleIdentNumber (lowercased hex). */
  moduleByIdent: Map<string, GsdmlModule>
  /** Standalone submodules by their ID. */
  submoduleById: Map<string, GsdmlSubmodule>
  /** Standalone submodules by their SubmoduleIdentNumber (lowercased hex). */
  submoduleByIdent: Map<string, GsdmlSubmodule>
}

// ===================== RESULT =====================

/**
 * Successful parse result.
 */
export interface GsdmlParseSuccess {
  success: true
  catalog: GsdmlCatalog
}

/**
 * Failed parse result. Error is always a human-readable sentence; callers
 * surface it directly to the user.
 */
export interface GsdmlParseFailure {
  success: false
  error: string
}

/**
 * Discriminated-union parse result.
 */
export type GsdmlParseResult = GsdmlParseSuccess | GsdmlParseFailure
