/** Device identity read from DeviceIdentity; ident numbers are normalised `0x` lowercase hex. */
export interface GsdmlDeviceIdentity {
  readonly vendorId: string
  readonly deviceId: string
  /** The Value of the VendorName child element; empty when absent. */
  readonly vendorName: string
  readonly infoText: string
}

/** One closed range of a slot or subslot set, both bounds included. */
export interface GsdmlSlotRange {
  readonly first: number
  readonly last: number
}

/** A slot or subslot set, from value lists such as `1..32`, `1 2 3` or `1 3 5..7`. */
export type GsdmlSlotSet = readonly GsdmlSlotRange[]

/** One named bit of a DataItem, from BitDataItem. */
export interface GsdmlBitDataItem {
  readonly bitOffset: number
  readonly text: string
}

/** One DataItem of an IO data area. */
export interface GsdmlDataItem {
  readonly id: string | null
  readonly dataType: string
  /** Null when the size of the data type is not known. */
  readonly bitLength: number | null
  readonly textId: string
  readonly text: string
  readonly useAsBits: boolean
  readonly bits: readonly GsdmlBitDataItem[]
}

/** The IO data of a submodule, with the bit length of each direction. */
export interface GsdmlIoData {
  readonly input: readonly GsdmlDataItem[]
  readonly output: readonly GsdmlDataItem[]
  /** Sum of the input item lengths; null when one of them is unknown. */
  readonly inputBitLength: number | null
  /** Sum of the output item lengths; null when one of them is unknown. */
  readonly outputBitLength: number | null
}

/** A field of a record or diagnosis structure, from a Ref element. */
export interface GsdmlDataField {
  readonly id: string | null
  readonly textId: string
  readonly text: string
  readonly byteOffset: number
  readonly bitOffset: number
  /** Null when the size of the data type is not known. */
  readonly bitLength: number | null
  readonly dataType: string
}

/** How a parameter field is edited. */
export type GsdmlParameterFieldKind =
  | 'enum'
  | 'bit'
  | 'bitArea'
  | 'integer'
  | 'unsigned'
  | 'float'
  | 'string'
  | 'octets'
  | 'other'

/** One lexical range of AllowedValues; a single value has equal bounds. */
export interface GsdmlAllowedValueRange {
  readonly min: string
  readonly max: string
}

/** One option of an enumerated field, from ValueItem/Assignments/Assign. */
export interface GsdmlParameterEnumOption {
  readonly value: string
  readonly text: string
}

/** A parameter field of a ParameterRecordDataItem. */
export interface GsdmlParameterField extends GsdmlDataField {
  readonly kind: GsdmlParameterFieldKind
  readonly defaultValue: string
  /** The AllowedValues ranges as written; null when the attribute is absent. */
  readonly allowedValues: readonly GsdmlAllowedValueRange[] | null
  readonly enumOptions: readonly GsdmlParameterEnumOption[]
  readonly changeable: boolean
  readonly visible: boolean
}

/** Constant record bytes, from a Const element. */
export interface GsdmlRecordConstant {
  readonly byteOffset: number
  readonly data: readonly number[]
}

/** A ParameterRecordDataItem of a submodule. */
export interface GsdmlParameterRecord {
  readonly index: number
  readonly length: number
  readonly transferSequence: number | null
  readonly name: string
  readonly constants: readonly GsdmlRecordConstant[]
  readonly fields: readonly GsdmlParameterField[]
}

/** The fields every submodule kind shares. */
export interface GsdmlSubmoduleBase {
  readonly id: string
  readonly identNumber: string
  readonly name: string
  readonly infoText: string
  readonly io: GsdmlIoData
  readonly parameterRecords: readonly GsdmlParameterRecord[]
  readonly requiredSchemaVersion: string | null
}

/** A VirtualSubmoduleItem of a device access point or module. */
export interface GsdmlVirtualSubmodule extends GsdmlSubmoduleBase {
  readonly kind: 'virtual'
}

/** A SubmoduleItem of the SubmoduleList. */
export interface GsdmlStandardSubmodule extends GsdmlSubmoduleBase {
  readonly kind: 'submodule'
}

/** An InterfaceSubmoduleItem of a SystemDefinedSubmoduleList. */
export interface GsdmlInterfaceSubmodule extends GsdmlSubmoduleBase {
  readonly kind: 'interface'
  readonly subslotNumber: number | null
  /** The SupportedRT_Classes tokens as written. */
  readonly supportedRtClasses: readonly string[]
  /** The SupportedProtocols tokens as written. */
  readonly supportedProtocols: readonly string[]
}

/** A PortSubmoduleItem, fixed in a SystemDefinedSubmoduleList or pluggable in the SubmoduleList. */
export interface GsdmlPortSubmodule extends GsdmlSubmoduleBase {
  readonly kind: 'port'
  readonly subslotNumber: number | null
}

/** A submodule of the SubmoduleList. */
export type GsdmlPluggableSubmodule = GsdmlStandardSubmodule | GsdmlPortSubmodule

/** A submodule of a SystemDefinedSubmoduleList. */
export type GsdmlSystemDefinedSubmodule = GsdmlInterfaceSubmodule | GsdmlPortSubmodule

/** Any submodule kind. */
export type GsdmlSubmodule =
  | GsdmlVirtualSubmodule
  | GsdmlStandardSubmodule
  | GsdmlInterfaceSubmodule
  | GsdmlPortSubmodule

/** A module a device access point accepts, from UseableModules/ModuleItemRef. */
export interface GsdmlModulePlacement {
  readonly moduleId: string
  readonly allowedInSlots: GsdmlSlotSet
  readonly fixedInSlots: GsdmlSlotSet
  readonly usedInSlots: GsdmlSlotSet
}

/** A submodule a device access point or module accepts, from UseableSubmodules/SubmoduleItemRef. */
export interface GsdmlSubmodulePlacement {
  readonly submoduleId: string
  readonly allowedInSubslots: GsdmlSlotSet
  readonly fixedInSubslots: GsdmlSlotSet
  readonly usedInSubslots: GsdmlSlotSet
}

/** A DeviceAccessPointItem. */
export interface GsdmlDeviceAccessPoint {
  readonly id: string
  readonly identNumber: string
  readonly name: string
  readonly infoText: string
  readonly orderNumber: string
  readonly requiredSchemaVersion: string | null
  readonly physicalSlots: GsdmlSlotSet
  readonly fixedInSlots: GsdmlSlotSet
  readonly useableModules: readonly GsdmlModulePlacement[]
  readonly virtualSubmodules: readonly GsdmlVirtualSubmodule[]
  readonly systemDefinedSubmodules: readonly GsdmlSystemDefinedSubmodule[]
  readonly useableSubmodules: readonly GsdmlSubmodulePlacement[]
}

/** A ModuleItem of the ModuleList. */
export interface GsdmlModule {
  readonly id: string
  readonly identNumber: string
  readonly name: string
  readonly infoText: string
  readonly orderNumber: string
  readonly hardwareRelease: string
  readonly softwareRelease: string
  readonly requiredSchemaVersion: string | null
  readonly virtualSubmodules: readonly GsdmlVirtualSubmodule[]
  readonly useableSubmodules: readonly GsdmlSubmodulePlacement[]
}

/** A ChannelDiagItem. */
export interface GsdmlChannelDiagnostic {
  readonly errorType: number
  readonly name: string
  readonly help: string
}

/** A UnitDiagTypeItem with its Ref fields. */
export interface GsdmlUnitDiagnosticType {
  readonly userStructureIdentifier: number
  readonly name: string
  readonly fields: readonly GsdmlDataField[]
}

/** One ErrorCode2Item of a LogBookEntryItem. */
export interface GsdmlLogBookErrorCode2 {
  readonly errorCode2: number
  readonly name: string
  readonly help: string
}

/** The ErrorCode2 description of a LogBookEntryItem: its ErrorCode2Value or its ErrorCode2List. */
export type GsdmlLogBookErrorCode2Description =
  | { readonly kind: 'value'; readonly name: string; readonly help: string }
  | { readonly kind: 'list'; readonly items: readonly GsdmlLogBookErrorCode2[] }

/** A LogBookEntryItem. */
export interface GsdmlLogBookEntry {
  readonly status: number
  readonly errorCode2: GsdmlLogBookErrorCode2Description
}

/** The kind of a parser notice. */
export type GsdmlNoticeKind =
  | 'newer-schema-version'
  | 'object-skipped'
  | 'unresolved-text'
  | 'dangling-reference'
  | 'unknown-data-type'
  | 'no-device-access-point'
  | 'notices-truncated'

/** Something the parser noticed while reading a file it accepted. */
export interface GsdmlNotice {
  readonly kind: GsdmlNoticeKind
  readonly message: string
  /** The ID of the element the notice is about, when it has one. */
  readonly elementId?: string
  /** The value the notice is about, such as a text id, a reference target or a data type. */
  readonly detail?: string
}

/** The catalog of one GSDML file. Plain data only, safe to structured-clone. */
export interface GsdmlCatalog {
  /** The version of the schema location file name, such as `V2.45`; empty when it names none. */
  readonly schemaVersion: string
  readonly identity: GsdmlDeviceIdentity
  readonly deviceAccessPoints: readonly GsdmlDeviceAccessPoint[]
  readonly modules: readonly GsdmlModule[]
  readonly submodules: readonly GsdmlPluggableSubmodule[]
  readonly channelDiagnostics: readonly GsdmlChannelDiagnostic[]
  readonly unitDiagnosticTypes: readonly GsdmlUnitDiagnosticType[]
  readonly logBookEntries: readonly GsdmlLogBookEntry[]
  readonly notices: readonly GsdmlNotice[]
}

/** The result of parsing a GSDML file: its catalog or the reason it was rejected. */
export type GsdmlParseResult =
  | { readonly success: true; readonly catalog: GsdmlCatalog }
  | { readonly success: false; readonly error: string }
