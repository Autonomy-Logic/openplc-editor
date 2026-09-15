/** Shared, platform-agnostic domain types used by port interfaces. */

import type { ConfiguredEtherCATDevice } from './esi-types'

/** Default `T` is `unknown`, not `void`: TS 5.5+ collapses `{ success: true } & void` to `never`. */
export type Result<T = unknown> = ({ success: true } & T) | { success: false; error: string }

/** Unsubscribe function returned by event subscriptions */
export type Unsubscribe = () => void

export type PLCLanguage = 'IL' | 'ST' | 'LD' | 'FBD' | 'SFC'

/** Extended languages supported by function blocks */
export type PLCExtendedLanguage = PLCLanguage | 'python' | 'cpp'

export type PouType = 'program' | 'function' | 'function-block'

export type VariableClass = 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp' | 'global'

export type VariableTypeDefinition = 'base-type' | 'user-data-type' | 'array' | 'derived'

/** The IEC block qualifier a variable is declared under (the **Flags** column); absent means plain `VAR`. */
export type VariableFlag = 'constant' | 'retain'

export interface PLCVariableType {
  definition: VariableTypeDefinition
  value: string
  data?: {
    baseType: { definition: 'base-type' | 'user-data-type'; value: string }
    dimensions: Array<{ dimension: string }>
  }
}

export interface PLCVariable {
  id?: string
  name: string
  class?: VariableClass
  type: PLCVariableType
  /** The variable's binding: an alias name OR a literal IEC address (`%QX0.0`); empty = unlocated. */
  location: string
  initialValue?: string | null
  documentation: string
  debug?: boolean
  /** IEC block qualifier; absent = plain `VAR`. See {@link VariableFlag}. */
  flag?: VariableFlag
}

export interface PLCTask {
  name: string
  triggering: 'Cyclic' | 'Interrupt'
  interval: string
  priority: number
}

export interface PLCInstance {
  name: string
  task: string
  program: string
}

export interface PLCStructureVariable {
  name: string
  type: PLCVariableType
  initialValue?: { simpleValue: { value: string } }
  documentation?: string
}

/** A Global Variable List, compiled as a STRUCT type plus one global instance (see `serializeGlobalVariableListsToTypes`). */
export interface PLCGlobalVariableList {
  name: string
  variables: PLCVariable[]
  /** Uppercased `VAR_GLOBAL` qualifier text (`'CONSTANT'`, `'RETAIN PERSISTENT'`, …). */
  qualifier?: string
  /** The declaration as the user last left it, kept ONLY while it does not parse (same contract as a POU's `variablesText`). */
  text?: string
  documentation?: string
}

export type PLCDataType =
  | { name: string; derivation: 'structure'; variable: PLCStructureVariable[] }
  | {
      name: string
      derivation: 'enumerated'
      initialValue?: string
      values: Array<{ description: string }>
    }
  | {
      name: string
      derivation: 'array'
      baseType: PLCVariableType
      initialValue?: string
      dimensions: Array<{ dimension: string }>
    }

export interface PLCBody {
  language: PLCExtendedLanguage | 'il' | 'st' | 'ld' | 'fbd' | 'sfc' | 'python' | 'cpp'
  value: unknown
}

export interface PLCPou {
  name: string
  pouType: PouType
  interface?: {
    returnType?: string
    variables: PLCVariable[]
  }
  body: PLCBody
  documentation?: string
}

export type PouLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

export interface PLCFunction {
  language: PouLanguage
  name: string
  returnType: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCFunctionBlock {
  language: PouLanguage
  name: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCProgram {
  language: PouLanguage
  name: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCGlobalVariable extends Omit<PLCVariable, 'class'> {
  class: 'global'
}

export type ServerProtocol = 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua'
export type RemoteDeviceProtocol = 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet'

// Modbus

/** Wire transports a Modbus endpoint answers on, shared by the slave and the
 *  master: the same two wires carry both roles. */
export type ModbusTransport = 'rtu' | 'tcp'

/** Modbus RTU parity, shared by the slave and the master. */
export type ModbusParity = 'N' | 'E' | 'O'

export interface ModbusSlaveConfig {
  enabled: boolean
  /** Transports this server answers on. RTU and TCP together are ONE server
   *  with two transports, never two servers. Absent means TCP, which is what
   *  every project saved before baremetal gained a real `PLCServer` implies. */
  transports?: ModbusTransport[]
  networkInterface: string
  port: number
  /** Meaningful on RTU, where it is the only addressing there is. On TCP the
   *  MBAP unit id is a gateway routing field and is not filtered on. */
  slaveId?: number
  // RTU wiring, mirroring the master's serial half.
  serialPort?: string
  baudRate?: number
  parity?: ModbusParity
  stopBits?: number
  dataBits?: number
  bufferMapping?: ModbusBufferMapping
}

export interface ModbusBufferMapping {
  holdingRegisters?: { qwCount?: number; mwCount?: number; mdCount?: number; mlCount?: number }
  coils?: { qxBits?: number; mxBits?: number }
  discreteInputs?: { ixBits?: number }
  inputRegisters?: { iwCount?: number }
}

export interface ModbusIOPoint {
  id: string
  name: string
  type: string
  iecLocation: string
  alias?: string
}

export interface ModbusIOGroup {
  id: string
  name: string
  functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'
  cycleTime: number
  offset: string
  length: number
  errorHandling: 'keep-last-value' | 'set-to-zero'
  ioPoints?: ModbusIOPoint[]
}

export interface ModbusRemoteTcpConfig {
  transport?: 'tcp' | 'rtu'
  host?: string
  port?: number
  serialPort?: string
  baudRate?: number
  parity?: ModbusParity
  stopBits?: number
  dataBits?: number
  slaveId?: number
  timeout: number
  ioGroups: ModbusIOGroup[]
}

export interface S7CommServerSettings {
  enabled: boolean
  bindAddress: string
  port: number
  maxClients: number
  workIntervalMs: number
  sendTimeoutMs: number
  recvTimeoutMs: number
  pingTimeoutMs: number
  pduSize: number
}

export interface S7CommPlcIdentity {
  name: string
  moduleType: string
  serialNumber: string
  copyright: string
  moduleName: string
}

export type S7CommBufferType =
  | 'input'
  | 'output'
  | 'memory'
  | 'bool_input'
  | 'bool_output'
  | 'bool_memory'
  | 'byte_input'
  | 'byte_output'
  | 'int_input'
  | 'int_output'
  | 'int_memory'
  | 'dint_input'
  | 'dint_output'
  | 'dint_memory'
  | 'lint_input'
  | 'lint_output'
  | 'lint_memory'

export interface S7CommBufferMapping {
  type: S7CommBufferType
  startBuffer: number
  bitAddressing: boolean
}

export interface S7CommDataBlock {
  dbNumber: number
  description: string
  sizeBytes: number
  mapping: S7CommBufferMapping
}

export interface S7CommSystemArea {
  enabled: boolean
  sizeBytes: number
  mapping?: S7CommBufferMapping
}

export interface S7CommSystemAreas {
  peArea?: S7CommSystemArea
  paArea?: S7CommSystemArea
  mkArea?: S7CommSystemArea
}

export interface S7CommLogging {
  logConnections: boolean
  logDataAccess: boolean
  logErrors: boolean
}

export interface S7CommSlaveConfig {
  server: S7CommServerSettings
  plcIdentity?: S7CommPlcIdentity
  dataBlocks: S7CommDataBlock[]
  systemAreas?: S7CommSystemAreas
  logging?: S7CommLogging
}

export interface OpcUaServerSettings {
  enabled: boolean
  name: string
  applicationUri: string
  productUri: string
  bindAddress: string
  port: number
  endpointPath: string
}

export type OpcUaSecurityPolicyType = 'None' | 'Basic128Rsa15' | 'Basic256' | 'Basic256Sha256'
export type OpcUaSecurityModeType = 'None' | 'Sign' | 'SignAndEncrypt'
export type OpcUaAuthMethod = 'Anonymous' | 'Username' | 'Certificate'

export interface OpcUaSecurityProfile {
  id: string
  name: string
  enabled: boolean
  securityPolicy: OpcUaSecurityPolicyType
  securityMode: OpcUaSecurityModeType
  authMethods: OpcUaAuthMethod[]
}

export interface OpcUaUser {
  id: string
  type: 'password' | 'certificate'
  username: string | null
  passwordHash: string | null
  certificateId: string | null
  role: 'viewer' | 'operator' | 'engineer'
}

export interface OpcUaTrustedCertificate {
  id: string
  pem: string
  subject?: string
  validFrom?: string
  validTo?: string
  fingerprint?: string
}

export type OpcUaPermission = 'r' | 'w' | 'rw'

export interface OpcUaPermissions {
  viewer: OpcUaPermission
  operator: OpcUaPermission
  engineer: OpcUaPermission
}

export interface OpcUaFieldConfig {
  fieldPath: string
  displayName: string
  datatype?: string
  permissions: OpcUaPermissions
  fields?: OpcUaFieldConfig[]
}

export interface OpcUaNodeConfig {
  id: string
  pouName: string
  variablePath: string
  variableType: string
  nodeId: string
  browseName: string
  displayName: string
  description: string
  permissions: OpcUaPermissions
  nodeType: 'variable' | 'structure' | 'array'
  fields?: OpcUaFieldConfig[]
  arrayLength?: number
  elementType?: string
}

export interface OpcUaAddressSpaceConfig {
  namespaceUri: string
  nodes: OpcUaNodeConfig[]
}

export interface OpcUaSecurityConfig {
  serverCertificateStrategy: 'auto_self_signed' | 'custom'
  serverCertificateCustom: string | null
  serverPrivateKeyCustom: string | null
  trustedClientCertificates: OpcUaTrustedCertificate[]
}

export interface OpcUaServerConfig {
  server: OpcUaServerSettings
  securityProfiles: OpcUaSecurityProfile[]
  security: OpcUaSecurityConfig
  users: OpcUaUser[]
  cycleTimeMs: number
  addressSpace: OpcUaAddressSpaceConfig
}

export interface PLCServer {
  name: string
  protocol: ServerProtocol
  modbusSlaveConfig?: ModbusSlaveConfig
  s7commSlaveConfig?: S7CommSlaveConfig
  opcuaServerConfig?: OpcUaServerConfig
}

export interface EtherCATMasterConfig {
  enabled?: boolean
  networkInterface: string
  cycleTimeUs: number
  watchdogTimeoutCycles?: number
  taskPriority?: number
}

export interface EthercatConfig {
  masterConfig?: EtherCATMasterConfig
  devices: ConfiguredEtherCATDevice[]
}

export interface PLCRemoteDevice {
  name: string
  protocol: RemoteDeviceProtocol
  modbusTcpConfig?: ModbusRemoteTcpConfig
  ethercatConfig?: EthercatConfig
}

export interface PLCProjectLibraryRef {
  /** Strucpp manifest identifier; project ↔ system pool joins go through this field. */
  name: string
  /** Informational on load (name-only match against the pool today). */
  version: string
}

export interface PLCProjectData {
  dataTypes: PLCDataType[]
  /** Optional on the wire so projects saved before GVLs existed still parse; absent reads as `[]`. */
  globalVariableLists?: PLCGlobalVariableList[]
  pous: PLCPou[]
  configurations: {
    resource: {
      tasks: PLCTask[]
      instances: PLCInstance[]
      globalVariables: PLCVariable[]
    }
  }
  servers?: PLCServer[]
  remoteDevices?: PLCRemoteDevice[]
  /** Opt-in libraries; bundled/canonical strucpp libraries are always-on and don't appear here. */
  libraries?: PLCProjectLibraryRef[]
  /** Raw bytes of the library project's `library.json` manifest. Loaded from disk on open, never embedded in `project.json`. */
  libraryManifest?: string
  debugVariables?: {
    global?: string[]
    pous?: Record<string, string[]>
  }
}

/** Alias used by Monaco completion providers */
export type PLCProject = PLCProjectData

export interface ProjectMeta {
  name: string
  type: 'plc-project' | 'plc-library'
  path: string
}

/** Single source of truth for "is this project a library?" — never compare `meta.type` directly at a call site. */
export function isLibraryProject(meta: { type: 'plc-project' | 'plc-library' } | null | undefined): boolean {
  return meta?.type === 'plc-library'
}

/** True when a project identifier names a project held on Autonomy Edge rather than a file on this machine. */
export function isRemoteProjectPath(identifier: string): boolean {
  if (identifier.length === 0) {
    return false
  }

  const isPosixAbsolute = identifier.startsWith('/')
  // `C:\...` or `C:/...`, and `\\server\share` for a UNC path.
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(identifier) || identifier.startsWith('\\\\')

  return !isPosixAbsolute && !isWindowsAbsolute
}

/** Per-project-type capability matrix. Independent of `useCapabilities()`, which gates by host platform. */
export interface ProjectCapabilities {
  /** Show the Programs branch and the create-element modal's program option. */
  hasPrograms: boolean
  /** Show the Resource entry in the project tree. */
  hasResource: boolean
  /** Show Device / Configuration / Orchestrators entries. */
  hasDevices: boolean
  /** Show Server entries (Modbus / OPC-UA servers). */
  hasServers: boolean
  /** Show Remote-Device entries (Modbus client, EtherCAT). */
  hasRemoteDevices: boolean
  /** Show VPP vendor screens for the current board. */
  hasVendorScreens: boolean
  /** Show the standard Compile / Run on Simulator / Upload / Start-Stop / Debug affordances. */
  hasProgramBuild: boolean
  /** Show the Library-specific build button (produces `.stlib`). */
  hasLibraryBuild: boolean
  /** Show the Library-specific debug button (harness program exercising every block). Distinct from `hasProgramBuild`. */
  hasLibraryDebug: boolean
  /** Show the version-control affordance. */
  hasVersionControl: boolean
  /** Show the debugger panel + watch list. */
  hasDebugger: boolean
  /** Show the runtime-connection status and Start/Stop controls. */
  hasRuntimeControls: boolean
  /** Show the library manifest tab (the JSON-on-disk Monaco editor that controls .stlib build output). */
  hasLibraryManifest: boolean
}

export function projectCapabilities(
  meta: { type: 'plc-project' | 'plc-library' } | null | undefined,
): ProjectCapabilities {
  if (isLibraryProject(meta)) {
    return {
      hasPrograms: false,
      hasResource: false,
      hasDevices: false,
      hasServers: false,
      hasRemoteDevices: false,
      hasVendorScreens: false,
      hasProgramBuild: false,
      hasLibraryBuild: true,
      hasLibraryDebug: true,
      hasVersionControl: false,
      hasDebugger: false,
      hasRuntimeControls: false,
      hasLibraryManifest: true,
    }
  }
  return {
    hasPrograms: true,
    hasResource: true,
    hasDevices: true,
    hasServers: true,
    hasRemoteDevices: true,
    hasVendorScreens: true,
    hasProgramBuild: true,
    hasLibraryBuild: false,
    hasLibraryDebug: false,
    hasVersionControl: true,
    hasDebugger: true,
    hasRuntimeControls: true,
    hasLibraryManifest: false,
  }
}

export type CompilerType = 'arduino-cli' | 'openplc-compiler' | 'simulator'

/** Re-export of the canonical capability shape; authoritative definition lives in `middleware/shared/utils/target-capabilities`. */
import type { DebuggerTransport, TargetCapabilities } from '../utils/target-capabilities'

export type { DebuggerTransport, TargetCapabilities }

/** VPP-declared FQBN sub-option (e.g. Nano `cpu=atmega328old`); shared shape across the four sites that reference it. */
export interface PlatformOptionValue {
  id: string
  label: string
  help?: string
}

export interface PlatformOption {
  key: string
  label: string
  default: string
  help?: string
  values: PlatformOptionValue[]
}

export interface BoardInfo {
  compiler: CompilerType | (string & {})
  core: string
  /**
   * The board's fully-qualified name, e.g. `arduino:avr:uno`. The same string
   * arduino-cli reads `build.mcu` from, which is what selects the firmware's
   * I/O buffer sizes in `resources/sources/arduino/openplc.h` -- `core` alone
   * cannot tell an Uno from a Mega. Absent for hals.json targets.
   */
  platform?: string
  preview: string
  specs: Record<string, string>
  coreVersion?: string
  pins?: {
    defaultAin?: string[]
    defaultAout?: string[]
    defaultDin?: string[]
    defaultDout?: string[]
  }
  /** When absent, the resolver in backend/shared infers capabilities from the legacy `compiler` field. */
  capabilities?: Partial<TargetCapabilities>
  vpp?: VppMetadata
  /** Mirrors the VPP manifest's `target.platformOptions`, surfaced flat so device-screen UI need not reach into `vpp`. */
  platformOptions?: PlatformOption[]
  /** Hardware serial ports this board exposes. Absent → the editor assumes a single `Serial`. */
  serialPorts?: string[]
  /** Default serial port for the debugger. Absent → `Serial`. */
  defaultSerial?: string
  /** TCP carriers this board can bring up. Absent → every carrier stays on offer; declared only to REMOVE one the firmware can't serve. */
  networkInterfaces?: string[]
  /** Debug-channel resolver spec from hals.json/VPP manifest. Absent → "Debugging Not Available". */
  debug?: import('./debug-spec-types').DebugSpec
}

export interface VppModuleDefinition {
  id: string
  name: string
  /** Used by module-discovery to match a detected device. Modules with no hwId can only be added manually. */
  hwId?: string
  /** True for an always-present part of the device hardware (e.g. Arduino Opta's built-in I/O). Auto-placed and locked in slot 1. */
  fixed?: boolean
  image?: string
  /** One-line prose displayed in the per-slot detail pane. */
  description?: string
  /** Key/value pairs rendered as a spec list in the per-slot detail pane. */
  specs?: Record<string, string>
  /** Path to this module's configuration screen. Prefer `configScreenDefinition`, the parsed result. */
  configScreen?: string
  /** Parsed config-screen JSON, populated when `configScreen` resolves to a valid file. */
  configScreenDefinition?: unknown
  io: {
    digitalInputs: number
    digitalOutputs: number
    analogInputs: number
    analogOutputs: number
  }
  parameters?: Array<{
    id: string
    name: string
    type: string
    options?: string[]
    default?: unknown
    min?: number
    max?: number
  }>
  addressMapping?: unknown
}

/** Screens the runtime itself provides, which a VPP may replace. A closed union: a name that isn't a native screen is a typo. */
export type NativeScreenId = 'persistent-storage'

export interface VppMetadata {
  packageId: string
  /** From the manifest's `package.vendor.name`; groups boards under a vendor heading in the device dropdown. */
  vendor: string
  deviceId: string
  packagePath: string
  screens: Record<string, unknown>
  /** Native screens this device replaces; see `PackageManifest.devices[].hidesNativeScreens`. */
  hidesNativeScreens?: NativeScreenId[]
  moduleSystem: {
    enabled: boolean
    maxSlots: number
    modules: VppModuleDefinition[]
  } | null
}

export interface PackageManifest {
  formatVersion: string
  package: {
    id: string
    name: string
    version: string
    vendor: {
      name: string
      url?: string
      logo: string
    }
    description: string
    license?: string
    /** Oldest editor that may install this package; the install gate refuses one whose floor is above `APP_VERSION`. */
    minEditorVersion?: string
    /** Oldest runtime this package works with. Checked at compile time, since the target device is unknown at install time. */
    minRuntimeVersion?: string
  }
  devices: Array<{
    id: string
    name: string
    category?: string
    preview: string
    target: {
      type: string
      platform?: string
      core?: string
      boardManagerUrl?: string
      /** User-selectable FQBN sub-options for arduino-cli targets, appended to `platform` at compile/upload time. */
      platformOptions?: PlatformOption[]
      /** Exact core version a prebuilt arduino-hal was compiled against; the precompiled .a is ABI-locked to it. */
      coreVersion?: string
    }
    specs?: Record<string, string>
    hal: {
      type: string
      pluginType?: string
      /** "source" (default): pluginEntry is compiled on the runtime. "prebuilt": pluginEntry holds precompiled .o objects plus a link-only Makefile. */
      provisioning?: string
      pluginEntry?: string
      configTemplate?: string
      requirements?: string
      source?: string
      /** Prebuilt arduino-hal library directory, linked via --library alongside `hal.source`. */
      precompiledLibrary?: string
      /** On-device license-storage backend. PRESENCE is the signal: it resolves `TargetCapabilities.licenseStore` and drives the backend into the build. Absent → board answers `LIC_UNSUPPORTED`. */
      licenseStore?: string | string[]
      /** Per-VPP signing key id. Informational in the editor — the real trust root is the public key compiled into the VPP, not this string. */
      licenseKeyId?: string
      compilerFlags?: {
        c_flags?: string[]
        cxx_flags?: string[]
        ld_flags?: string[]
      }
      define?: string | string[]
      extraArduinoLibraries?: string[]
      libraries?: string
    }
    defaults?: {
      runtimeIpAddress?: string
      pins?: {
        defaultDin?: string[]
        defaultDout?: string[]
        defaultAin?: string[]
        defaultAout?: string[]
      }
    }
    screens?: Record<string, string>
    /** Native runtime-v4 screens this device REPLACES; hiding one turns off the native feature so only the vendor's driver handles it. */
    hidesNativeScreens?: NativeScreenId[]
    /** Hardware serial ports this device exposes (e.g. `['Serial', 'Serial1']`).
     *  Surfaced onto `BoardInfo.serialPorts` and consumed by VPP screen
     *  `select` fields via `optionsRef: 'board.serialPorts'`. */
    serialPorts?: string[]
    /** Name of the default serial port (usually the USB CDC port). Surfaced onto
     *  `BoardInfo.defaultSerial`. Absent → `Serial`. */
    defaultSerial?: string
    /** TCP carriers this device can bring up, surfaced onto `BoardInfo.networkInterfaces`. Declared only to REMOVE a carrier the firmware can't serve. */
    networkInterfaces?: string[]
    /** Declarative debug-channel resolver spec, consumed by `backend/shared/hardware/debug-spec.ts`; absence means none declared. */
    debug?: import('./debug-spec-types').DebugSpec
    /** Optional target capability overrides for this device, merged over the preset the editor derives from the target type. */
    capabilities?: Partial<TargetCapabilities>
    moduleSystem?: {
      enabled: boolean
      maxSlots: number
      discoverySupported?: boolean
      /** Shell command the editor invokes to ask a connected device
       *  to enumerate its modules. Returns lines parsed by the
       *  module-system's discovery flow; format defined per package. */
      discoveryCommand?: string
      modules: VppModuleDefinition[]
    }
  }>
}

export interface InstalledPackage {
  packageId: string
  version: string
  installedAt: string
  path: string
  devices: string[]
}

export interface ImportResult {
  success: boolean
  canceled?: boolean
  packageId?: string
  packageName?: string
  devices?: string[]
  error?: string
}

export interface RemoteVersionEntry {
  version: string
  downloadUrl: string
  publishedAt?: string
  /** Compared against `APP_VERSION` to flag incompatible entries in the dropdown. */
  minEditorVersion?: string
  deviceCount: number
  releaseNotes?: string
}

export interface RemoteCatalogEntry {
  packageId: string
  name: string
  vendor: {
    name: string
    url?: string
    logoUrl?: string
  }
  description: string
  license?: string
  tags?: string[]
  /** Ordered newest-first; UI code treats `versions[0]` as the latest. */
  versions: RemoteVersionEntry[]
}

export interface RemoteCatalog {
  entries: RemoteCatalogEntry[]
  fetchedAt: string
}

export interface IoMappingEntry {
  slot: number
  moduleId: string
  moduleName: string
  channelName: string
  channelType: string
  dataType: string
  iecAddress: string
  alias: string
  /** The `fieldId` that selected this channel's current mode, when resolved from `perChannelChoices`. Absent for static channels. */
  modeFieldId?: string
  /** Available mode keys for the per-row selector. Absent for static channels. */
  modeOptions?: string[]
  /** Currently-selected mode key. Absent for static channels. */
  modeValue?: string
}

export interface VendorIoMapping {
  entries: IoMappingEntry[]
}

/** A serial port offered in the communication-port picker; deliberately NOT a pre-composed display string. */
export interface CommunicationPort {
  /** OS-canonical port identifier and the value actually opened (`COM5`, `/dev/ttyUSB0`, `/dev/cu.usbmodem*`). */
  address: string
  /** Board name identified by arduino-cli from the connected core's VID/PID. Absent when no core matched. */
  boardName?: string
  /** Manufacturer/vendor string from `serialport`. The fallback descriptor when arduino-cli identified no board. */
  manufacturer?: string
}

export interface SerialPort {
  device: string
  description?: string
}

export type PinType = 'digitalInput' | 'digitalOutput' | 'analogInput' | 'analogOutput'

export interface DevicePin {
  pin: string
  pinType: PinType
  address: string
  /** User-supplied label participating in the alias registry. Used to be `name` — legacy projects auto-upgrade on load. */
  alias?: string
}

/** Bounds on the retain store's commit period, mirroring the runtime's own (`webserver/retain_config.py`). */
export const RETAIN_MIN_FLUSH_SECONDS = 1
export const RETAIN_MAX_FLUSH_SECONDS = 3600
export const DEFAULT_RETAIN_FLUSH_SECONDS = 5

/** Persistent storage (RETAIN) for the runtime's built-in file store, delivered as `retain.conf` inside the program upload. */
export interface PersistentStorageSettings {
  /** Off by default; leaving it off means the upload carries no `retain.conf`, keeping the device store switched off. */
  enabled: boolean
  /** Absolute path on the DEVICE. Empty means "use the runtime's default". */
  path: string
  /** How often the store commits, in seconds. The runtime rejects a value outside its accepted range at install time. */
  flushSeconds: number
}

export interface DeviceConfiguration {
  deviceBoard: string
  communicationPort: string
  runtimeIpAddress?: string
  /** Absent means this project does not use persistent storage — the signal that keeps the runtime's built-in store off. */
  persistentStorage?: PersistentStorageSettings
  /** Per-board archive: a storage path is a property of the target box, so retargeting shouldn't carry one device's path onto another. */
  persistentStorageByBoard?: Record<string, PersistentStorageSettings>
  /** Active board's VPP vendor-screen data; always mirrors `vendorScreenDataByBoard[deviceBoard]`. */
  vendorScreenData?: Record<string, unknown>
  /** Per-board archive of vendor-screen data, since VPP screens are board-specific. Legacy flat data is migrated on load. */
  vendorScreenDataByBoard?: Record<string, Record<string, unknown>>
  /** Choices for the board's `target.platformOptions`, keyed by option `key`. Cleared when the selected board changes. */
  selectedPlatformOptions?: Record<string, string>
}

export type PlcStatus = 'INIT' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'EMPTY' | 'TRANSITIONING' | 'UNKNOWN'

/** Per-task scan/cycle/latency stats from the runtime; `name` falls back to `plc-task-<idx>` when the .so doesn't expose one. */
export interface TaskTimingStats {
  name: string
  scan_count: number
  scan_time_min: number | null
  scan_time_max: number | null
  scan_time_avg: number | null
  cycle_time_min: number | null
  cycle_time_max: number | null
  cycle_time_avg: number | null
  cycle_latency_min: number | null
  cycle_latency_max: number | null
  cycle_latency_avg: number | null
  overruns: number
}

/** Plugin-contributed stat field (e.g. EtherCAT cycle counters), grouped under the plugin's `label` by the editor. */
export interface PluginStatsField {
  label: string
  value: string | number | boolean
  unit?: string
}

export interface PluginStatsPayload {
  label: string
  fields: PluginStatsField[]
}

/** Container for runtime timing stats; one entry per IEC task plus an optional map of plugin-contributed stats. */
export interface TimingStats {
  tasks: TaskTimingStats[]
  plugin_stats?: Record<string, PluginStatsPayload>
}

export type RuntimeLogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

export interface RuntimeLogEntry {
  id: number | null
  timestamp: string
  level: RuntimeLogLevel
  message: string
}

/** A channel kind a board's `debug` spec can declare — the SPEC's vocabulary, not necessarily what a live session rides (see `DebugMedium`). */
export type DebugConnectionType = 'tcp' | 'rtu' | 'websocket' | 'simulator'

/** What a live debug session actually rides; wider than `DebugConnectionType` since the browser can also use `webrtc` or `http-relay`. */
export type DebugMedium = DebugConnectionType | 'webrtc' | 'http-relay'

/** Media that can carry a CONTROL channel the connection manager physically holds open and polls. */
export type DeviceLinkTransport = 'rtu' | 'tcp' | 'simulator'

export interface DebugConnectionConfig {
  connectionType: DebugConnectionType
  connectionParams: {
    ipAddress?: string
    port?: string
    baudRate?: number
    slaveId?: number
    /**
     * An id a board flashed before 4.4.0 may still answer the editor on, tried
     * only after `slaveId` has gone unanswered. Not a manifest field: the editor
     * reads it from the project's own legacy screen state, because the packages
     * no longer declare the screen it lived on.
     */
    jwtToken?: string
  }
}

export interface DebugVariableResult {
  success: boolean
  tick?: number
  lastIndex?: number
  data?: number[]
  error?: string
  needsReconnect?: boolean
}

export interface DebugSetResult {
  success: boolean
  error?: string
}

export interface Md5VerifyResult {
  success: boolean
  match?: boolean
  targetMd5?: string
  /** Detected from the runtime's MD5 response trailer; feeds the renderer's byte-swap layer. Omitted on failure. */
  targetEndian?: 'le' | 'be'
  error?: string
}

export interface SimulatorDebugResult {
  success: boolean
  tick?: number
  lastIndex?: number
  data?: string // hex string
  error?: string
}

export interface CompileProgressEvent {
  stage: 'xml' | 'st' | 'c' | 'glue' | 'arduino' | 'upload' | 'done' | 'error'
  message: string
  progress?: number
  level?: string
  firmwarePath?: string
  plcStatus?: string
  /** Structured strucpp diagnostic for click-to-open in the console. Absent for plain progress messages. */
  compileError?: StructuredCompileError
}

/** Subset of strucpp's `CompileError` carried over IPC — only what the console/navigation consume. */
export interface StructuredCompileError {
  message: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  file?: string
  severity: 'error' | 'warning' | 'info'
  pouName?: string
  pouKind?: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
  section?: 'interface' | 'var-block' | 'body'
  bodyLine?: number
  variableName?: string
}

export interface CompileResult {
  success: boolean
  message?: string
  hexPath?: string
  /** Generated Structured Text program — available for runtime upload after compilation. */
  programSt?: string
  error?: string
}

export interface DebugCompileResult {
  success: boolean
  debugContent?: string
  md5?: string
  error?: string
}

/** Result of building a `.stlib` from a Library Project. Deliberately no verification field — running a library is its own action, via the debug harness. */
export interface CompileLibraryResult {
  success: boolean
  /** Absolute path to the produced `<libname>.stlib`. Only set on success. */
  stlibPath?: string
  /** Manifest name extracted from `library.json`. */
  libraryName?: string
  error?: string
}

/** Function Block Instance Info — represents a specific FB instance for debugging */
export interface FbInstanceInfo {
  fbTypeName: string
  programName: string
  programInstanceName: string
  fbVariableName: string
  key: string
}

/** Debug Tree Node — represents a node in the hierarchical debugger variable tree */
export interface DebugTreeNode {
  name: string
  fullPath: string
  compositeKey: string
  type: string
  isComplex: boolean
  isExpanded?: boolean
  children?: DebugTreeNode[]
  debugIndex?: number
  arrayIndices?: number[]
  /** Member names of an enumerated type, indexed by the underlying integer value; the wire still carries an INT. */
  enumValues?: string[]
}

/** Union type representing logs from either v3 (string) or v4 (array) runtime */
export type PlcLogs = string | RuntimeLogEntry[]

/** Maximum number of log entries to keep in the client-side buffer */
export const LOG_BUFFER_CAP = 1000

/** Type guard to check if logs are in v4 format (array of objects) */
export function isV4Logs(logs: PlcLogs): logs is RuntimeLogEntry[] {
  return Array.isArray(logs)
}

/** Type guard to check if logs are in v3 format (plain string) */
export function isV3Logs(logs: PlcLogs): logs is string {
  return typeof logs === 'string'
}

/** A run of log text sharing one SGR-colour style. `className` is a Tailwind class string, absent when unstyled. */
export interface LogSegment {
  text: string
  className?: string
}

/** What a caller hands to `addLog`. Deliberately has no `id`: the store mints the rendering key itself. */
export interface LogObject {
  level?: 'debug' | 'info' | 'warning' | 'error'
  message: string
  tstamp?: Date
  /** When set, the console renders the bracketed POU prefix as a clickable button. */
  compileError?: StructuredCompileError
  /** Styled runs, set only when the source emitted SGR colour; `message` always holds the same text with escapes stripped. */
  segments?: LogSegment[]
  /** True while this entry is an in-place line a terminal would still overwrite; a newline clears the flag. */
  transient?: boolean
}

export type Platform = 'linux' | 'darwin' | 'win32' | ''

export type Architecture = 'x64' | 'arm' | ''

export interface SystemInfo {
  OS: Platform
  architecture: Architecture
  prefersDarkMode: boolean
  isWindowMaximized: boolean
}

export interface RecentProject {
  name: string
  path: string
  lastOpenedAt: string
  createdAt: string
}

/** Platform-provided configuration for the AI feature, resolved by the composition root. */
export interface AIFeatureConfig {
  /** Whether the AI feature is enabled on this platform */
  isFeatureEnabled: boolean
  /** Whether the user has previously consented to AI usage */
  hasUserConsented: boolean
  /** User preference: whether inline ghost-text completions are active in editors */
  inlineCompletionsEnabled: boolean
}

export type ChatMessageRole = 'user' | 'assistant'

/** Anthropic-compatible content block. Plain user text is normalized to `[{ type: 'text', text: '...' }]` so readers don't branch on string vs array. */
export type AIChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error?: boolean
    }

export type ChatMessage = {
  id: string
  role: ChatMessageRole
  /** Plain string for legacy text-only turns; block array for restored conversations (so `tool_use`/`tool_result` survive a reload). */
  content: string | AIChatContentBlock[]
  timestamp: number
  rating?: 'up' | 'down'
  /** Set when loaded from the backend as part of a persisted conversation; absent for in-progress local-only turns. */
  conversationId?: string
}

/** Mirrors the backend `ResolvedEntitlements`/`ResolvedUsage` shapes, surfaced via `GET /me/entitlements` and `GET /me/usage`. */

/** Subscription status as reported by the backend (Paddle-backed). */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired'

/** Plan level slug (standard < plus < premium). */
export type PlanLevelSlug = 'standard' | 'plus' | 'premium'

/** Feature flags resolved from the active plan level. Open-ended map: backend may emit additional booleans as features land. */
export type PlanFeatures = {
  hasAiEngineer?: boolean
  hasAiChat?: boolean
  hasPrivateProjects?: boolean
  hasOrganizations?: boolean
  hasCodesysImporter?: boolean
  hasOnPrem?: boolean
  hasSla?: boolean
  hasSoc2Badge?: boolean
  hasVersionControl?: boolean
  [key: string]: boolean | undefined
}

/** Shared header on both `/me/entitlements` and `/me/usage`. */
export interface EntitlementSource {
  subscriptionId: string
  subscriptionStatus: SubscriptionStatus
  planSlug: string
  planDisplayName: string
  planLevelSlug: PlanLevelSlug
  tier: number
}

/** Numeric counter with a nullable cap (null = unlimited). */
export interface UsageCounter {
  used: number
  limit: number | null
  remaining: number | null
}

/** Response shape of `GET /me/entitlements`. */
export interface AIEntitlements {
  source: EntitlementSource
  limits: {
    maxOrchestrators: number | null
    maxDevices: number | null
    maxPrivateProjects: number | null
    maxPublicProjects: number | null
    maxOrgMembers: number | null
    maxTeamWorkspaces: number | null
  }
  acu: {
    monthlyAcu: number
    rateLimitWindowHours: number
    rateLimitWindowPercent: number
    marginPercent: number | null
  }
  features: PlanFeatures
}

/** Response shape of `GET /me/usage`. */
export interface AIUsage {
  source: EntitlementSource
  orchestrators: UsageCounter
  devices: UsageCounter
  privateProjects: UsageCounter
  publicProjects: UsageCounter
  organizations: {
    used: number
    allowed: boolean
  }
  acu: {
    used: number
    monthlyLimit: number
    remaining: number
    rateLimitWindowHours: number
    rateLimitWindowPercent: number
  }
}

/** Structured billing/limit payload from `/ai/chat` and `/ai/complete`, thrown by autonomy-edge's `CreditGuard`. */
export type BillingErrorPayload = {
  /** `subscription_past_due` is a lapsed payment method: the plan is still there, the card is not. */
  code: 'insufficient_acu' | 'subscription_inactive' | 'rate_limit_exceeded' | 'subscription_past_due'
  message: string
  /** Set when `code === 'insufficient_acu'`. ACU remaining in the period. */
  remaining?: number
  /** Set when `code === 'insufficient_acu'`. ACU the request would have used. */
  required?: number
  /** Set when `code === 'insufficient_acu'`. Plan's monthly ACU cap. */
  monthlyLimit?: number
  /** Set when `code === 'subscription_inactive'`. Reason the subscription is blocking. */
  subscriptionStatus?: SubscriptionStatus
  /** Optional deep-link to the autonomy-edge billing portal. */
  reactivateUrl?: string
  /** Set when `code === 'rate_limit_exceeded'`; ISO-8601 reset time, `null` if the backend couldn't compute it. */
  resetsAt?: string | null
}

/** FBD rung data — nodes + edges for one Function Block Diagram rung. */
export type FBDRungState = {
  comment: string
  selectedNodes: import('@xyflow/react').Node[]
  nodes: import('@xyflow/react').Node[]
  edges: import('@xyflow/react').Edge[]
}

/** A branch of elements connected to a specific block handle; defined here so `RungLadderState` can reference it across layers. */
export type HandleBranch = {
  /** The block node ID this branch connects to */
  blockId: string
  /** The handle ID on the block (e.g., "R", "PV", "CV") */
  handleId: string
  /** Direction: 'input' means elements feed INTO the block, 'output' means elements come OUT */
  direction: 'input' | 'output'
  /** Ordered list of node IDs in this branch (left-to-right for input, block-to-right for output) */
  nodeIds: string[]
}

/** Ladder rung data — nodes + edges + layout for one Ladder rung. */
export type RungLadderState = {
  id: string
  comment: string
  defaultBounds: number[]
  reactFlowViewport: number[]
  selectedNodes: import('@xyflow/react').Node[]
  nodes: import('@xyflow/react').Node[]
  edges: import('@xyflow/react').Edge[]
  /** Index of active handle branches in this rung (undefined for backward compatibility) */
  handleBranches?: HandleBranch[]
}

export type WebRTCConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'failed'

/** Narrow callback interface for the WebRTC connection manager. */
export interface WebRTCSessionCallbacks {
  setStatus: (status: WebRTCConnectionStatus) => void
  setError: (error: string | null) => void
  setSessionId: (id: string | null) => void
  setReconnectAttempt: (attempt: number) => void
  startSession: (params: { deviceId: string; deviceName: string; agentId: string }) => void
  endSession: () => void
}

/** Composite key for identifying a variable reference in the system */
export type VariableReference = {
  pouName: string
  variableName: string
  variableType: PLCVariableType
}
