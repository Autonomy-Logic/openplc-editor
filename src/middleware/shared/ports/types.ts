/**
 * Shared domain types used by port interfaces.
 *
 * These types are platform-agnostic and represent the domain concepts
 * shared between openplc-editor (Electron) and openplc-web (Browser).
 * Inner layers (domain/application) depend on these; outer layers (adapters)
 * implement the ports that use them.
 */

import type { ConfiguredEtherCATDevice } from './esi-types'

// ---------------------------------------------------------------------------
// Result wrappers
// ---------------------------------------------------------------------------

/** Standard result for operations that can fail.
 *
 *  Default `T` is `unknown` — NOT `void` — because TS 5.5+ collapses
 *  `{ success: true } & void` to `never`, which would make
 *  `return { success: true }` an error at every call site that
 *  consumes `Result<void>`.  Intersection with `unknown` is the
 *  identity, so callers that don't pass `T` get the bare
 *  `{ success: true }` shape, and callers that do (e.g.
 *  `Result<{ value: number }>`) still get the extra fields merged in.
 */
export type Result<T = unknown> = ({ success: true } & T) | { success: false; error: string }

/** Unsubscribe function returned by event subscriptions */
export type Unsubscribe = () => void

// ---------------------------------------------------------------------------
// PLC Languages & POU
// ---------------------------------------------------------------------------

export type PLCLanguage = 'IL' | 'ST' | 'LD' | 'FBD' | 'SFC'

/** Extended languages supported by function blocks */
export type PLCExtendedLanguage = PLCLanguage | 'python' | 'cpp'

export type PouType = 'program' | 'function' | 'function-block'

export type VariableClass = 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp' | 'global'

export type VariableTypeDefinition = 'base-type' | 'user-data-type' | 'array' | 'derived'

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
  /**
   * The variable's binding — single-field model: an alias name OR a literal
   * IEC address (`%QX0.0`). Empty = unlocated. Alias→address resolution
   * happens at compile time; a manual literal is honoured verbatim.
   */
  location: string
  initialValue?: string | null
  documentation: string
  debug?: boolean
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

// ---------------------------------------------------------------------------
// POU Variants (used by project store)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Servers & Communication Protocols
// ---------------------------------------------------------------------------

export type ServerProtocol = 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua'
export type RemoteDeviceProtocol = 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet'

// Modbus
export interface ModbusSlaveConfig {
  enabled: boolean
  networkInterface: string
  port: number
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
  parity?: 'N' | 'E' | 'O'
  stopBits?: number
  dataBits?: number
  slaveId?: number
  timeout: number
  ioGroups: ModbusIOGroup[]
}

// S7Comm
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

// OPC-UA
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

// PLCServer
export interface PLCServer {
  name: string
  protocol: ServerProtocol
  modbusSlaveConfig?: ModbusSlaveConfig
  s7commSlaveConfig?: S7CommSlaveConfig
  opcuaServerConfig?: OpcUaServerConfig
}

// EtherCAT
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

// PLCRemoteDevice
export interface PLCRemoteDevice {
  name: string
  protocol: RemoteDeviceProtocol
  modbusTcpConfig?: ModbusRemoteTcpConfig
  ethercatConfig?: EthercatConfig
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface PLCProjectLibraryRef {
  /** Strucpp manifest identifier — same value
   *  `InstalledLibrary.name` carries.  Project ↔ system pool joins
   *  go through this field. */
  name: string
  /** Informational on load (name-only match against the pool today);
   *  the manager surfaces a soft warning when versions differ. */
  version: string
}

export interface PLCProjectData {
  dataTypes: PLCDataType[]
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
  /** Opt-in libraries the project pulls into compile + UI surfaces.
   *  Bundled / canonical strucpp libraries are always-on regardless
   *  of this list and do not appear here.  Optional on the wire so
   *  legacy fixtures and projects without the field type-check; the
   *  store's default state and the parsed-project loader both
   *  surface the absent case as `[]`. */
  libraries?: PLCProjectLibraryRef[]
  /** Raw bytes of the library project's `library.json` manifest.
   *  Same in-memory pattern POU bodies use (`pous[i].body.value`):
   *  loaded from disk on project open, serialised back to its own
   *  file by the save pipeline, NEVER embedded in `project.json`.
   *  Optional / undefined for PLC projects, which don't own this
   *  file. */
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

/**
 * Single source of truth for "is this project a library?"  Every UI
 * conditional that hides or rearranges affordances for libraries
 * funnels through this — never compare `meta.type` directly at a
 * call site.  A future third project type (firmware project, board
 * preset bundle, …) would change this helper, not every consumer.
 */
export function isLibraryProject(meta: { type: 'plc-project' | 'plc-library' } | null | undefined): boolean {
  return meta?.type === 'plc-library'
}

/**
 * Per-project-type capability matrix.  Drives every UI affordance
 * that depends on what kind of project is open: project tree
 * branches, sidebar actions, menu entries, the New Project modal's
 * step count, etc.
 *
 * Layered on top of `useCapabilities()` (which gates by host
 * platform — serial ports, native dialogs, …).  The two are
 * independent: `useCapabilities` answers "what can this build of
 * the editor do?", `projectCapabilities` answers "what makes sense
 * for this project?".
 *
 * Pure function so the renderer can call it inline without
 * memoising — `meta.type` only changes when the project changes,
 * which is rare and always triggers a re-render anyway.
 */
export interface ProjectCapabilities {
  /** Show the Programs branch in the project tree and allow the
   *  create-element modal to make new programs. */
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
  /** Show the standard Compile / Run on Simulator / Upload /
   *  Start-Stop / Debug affordances in the workspace activity bar. */
  hasProgramBuild: boolean
  /** Show the Library-specific build button (produces `.stlib`). */
  hasLibraryBuild: boolean
  /** Show the version-control affordance. */
  hasVersionControl: boolean
  /** Show the debugger panel + watch list. */
  hasDebugger: boolean
  /** Show the runtime-connection status and Start/Stop controls. */
  hasRuntimeControls: boolean
  /** Show the library manifest tab (the JSON-on-disk Monaco editor
   *  that controls .stlib build output). */
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
    hasVersionControl: true,
    hasDebugger: true,
    hasRuntimeControls: true,
    hasLibraryManifest: false,
  }
}

// ---------------------------------------------------------------------------
// Device & Board
// ---------------------------------------------------------------------------

export type CompilerType = 'arduino-cli' | 'openplc-compiler' | 'simulator'

/** Re-export of the canonical capability shape so consumers of
 *  `BoardInfo` get the same union without crossing the utils layer
 *  directly. Authoritative definition lives in
 *  `middleware/shared/utils/target-capabilities`. */
import type { DebuggerTransport, TargetCapabilities } from '../utils/target-capabilities'

export type { DebuggerTransport, TargetCapabilities }

/**
 * VPP-declared FQBN sub-option (e.g. Nano `cpu=atmega328old`). Shared
 * shape between the manifest wire type, the resolved BoardBuildInfo, the
 * boards Map exposed to the renderer, and the BoardInfo IPC payload —
 * keeping it as a single exported interface so adding a field (say,
 * `condition` for conditional visibility) doesn't drift across the four
 * sites that reference it. See CompilerModule.applyPlatformOptions for
 * how the editor turns a value pick into an FQBN segment.
 */
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
  preview: string
  specs: Record<string, string>
  coreVersion?: string
  pins?: {
    defaultAin?: string[]
    defaultAout?: string[]
    defaultDin?: string[]
    defaultDout?: string[]
  }
  /** Optional explicit capability declaration. When absent, the resolver
   *  in backend/shared infers capabilities from the legacy `compiler`
   *  field (back-compat for pre-migration data). */
  capabilities?: Partial<TargetCapabilities>
  vpp?: VppMetadata
  /**
   * Mirrors the VPP manifest's `target.platformOptions`. Surfaced on the
   * flat BoardInfo (rather than only inside `vpp`) so the device-screen UI
   * can decide whether to render the variant dropdown without reaching
   * into VPP-specific metadata. Builtins (Simulator / Runtime v3/v4) never
   * declare it.
   */
  platformOptions?: PlatformOption[]
  /**
   * Declarative debug-channel resolver spec carried through from the
   * source catalog (hals.json or VPP manifest).  Consumed by
   * `backend/shared/hardware/debug-spec.ts#resolveDebugConnection`.
   * Absent → the renderer surfaces "Debugging Not Available".
   */
  debug?: import('./debug-spec-types').DebugSpec
}

// ---------------------------------------------------------------------------
// VPP (Vendor Plugin Package)
// ---------------------------------------------------------------------------

export interface VppModuleDefinition {
  id: string
  name: string
  /** Vendor-specific hardware id (e.g. board model number) used by the
   *  module-discovery flow to match a detected device against this
   *  definition. Optional — modules with no hwId can only be added
   *  manually. */
  hwId?: string
  /** When true, this module represents a fixed (always-present) part
   *  of the device hardware — e.g. the Arduino Opta's built-in I/O.
   *  The renderer auto-places it in slot 1 on first load, locks that
   *  slot against removal/replacement, and hides the module from the
   *  per-slot module-picker dropdown (slot 1 is the only place it
   *  belongs). */
  fixed?: boolean
  image?: string
  /** One-line prose displayed in the per-slot detail pane of the
   *  backplane editor. */
  description?: string
  /** Key/value pairs (channels, resolution, range, ...) rendered as a
   *  spec list in the per-slot detail pane. */
  specs?: Record<string, string>
  /** Path (in the manifest) to this module's configuration screen. The
   *  backend loads it eagerly and exposes the parsed JSON via
   *  `configScreenDefinition`; consumers should prefer that field. */
  configScreen?: string
  /** Parsed config-screen JSON for this module. Populated by the
   *  hardware-module loader when `configScreen` resolves to an
   *  existing, valid screen file. */
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

export interface VppMetadata {
  packageId: string
  /** Human-readable vendor name from the package manifest's
   *  `package.vendor.name` field.  Used by the device-dropdown to
   *  group boards under their vendor heading (e.g. all boards from
   *  `com.openplc.arduino` cluster under "Arduino"). */
  vendor: string
  deviceId: string
  packagePath: string
  screens: Record<string, unknown>
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
    minEditorVersion?: string
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
      /**
       * User-selectable FQBN sub-options for arduino-cli targets. The editor
       * renders a dropdown per entry (next to the board picker) and appends
       * `:<key>=<chosen_id>` to `platform` at compile and upload time —
       * mirroring arduino-cli's boards.txt menu mechanism. See
       * manifest.schema.json for the canonical field documentation.
       */
      platformOptions?: PlatformOption[]
      /**
       * Exact Arduino core version a prebuilt arduino-hal library was compiled
       * against (arduino-cli targets with hal.provisioning="prebuilt"). The
       * editor installs/verifies this version before linking, since the
       * precompiled .a is ABI-locked to it.
       */
      coreVersion?: string
    }
    specs?: Record<string, string>
    hal: {
      type: string
      pluginType?: string
      /**
       * Native runtime-v4 plugin provisioning. "source" (default when absent):
       * pluginEntry is the entry source file and its directory is compiled on
       * the runtime. "prebuilt": pluginEntry is the directory holding the
       * precompiled .o objects plus a link-only Makefile; the runtime only links.
       */
      provisioning?: string
      pluginEntry?: string
      configTemplate?: string
      requirements?: string
      source?: string
      /**
       * Prebuilt arduino-hal (provisioning="prebuilt") precompiled Arduino
       * library directory. Linked via --library alongside the source
       * integration layer (hal.source).
       */
      precompiledLibrary?: string
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
    /** Declarative debug-channel resolver spec, consumed by
     *  `backend/shared/hardware/debug-spec.ts`.  Same shape as
     *  the `debug` field on built-in hals.json entries — the
     *  editor's resolver doesn't care which catalog the device
     *  came from.  Absence means no debug capability is declared. */
    debug?: import('./debug-spec-types').DebugSpec
    /** Optional target capability overrides for this device, merged over
     *  the preset the editor derives from the target type. A runtime-v4
     *  board exposing physical GPIO (e.g. the Raspberry Pi) sets
     *  `{ pinMapping: true }` to surface the pin-mapping table and feed a
     *  pins[] array into its plugin config. */
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
  /**
   * Minimum editor semver required to run this package version. The UI
   * compares this against `APP_VERSION` and flags incompatible entries in
   * the dropdown so users don't try to install something the editor can't
   * load.
   */
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
  /**
   * Available versions, ordered newest-first. The adapter/CDN owns the
   * ordering contract — UI code treats `versions[0]` as the latest.
   */
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
  /** When this channel was resolved out of a module's
   *  `addressMapping.perChannelChoices`, the `fieldId` whose value
   *  selected the current mode. Drives the IO Table's per-row "Mode"
   *  selector — picking a new option writes the chosen key to
   *  `slotsConfig[slot][modeFieldId]`, which re-triggers the channel
   *  resolver and the address allocator. Absent for statically-
   *  declared channels (modules with no per-pin mode switch). */
  modeFieldId?: string
  /** Available mode keys for the per-row selector
   *  (`Object.keys(perChannelChoices[*].modes)`). Absent for static
   *  channels. */
  modeOptions?: string[]
  /** Currently-selected mode key. Reflects `slotsConfig[slot][modeFieldId]`
   *  at the time the allocator ran. Absent for static channels. */
  modeValue?: string
}

export interface VendorIoMapping {
  entries: IoMappingEntry[]
}

export interface CommunicationPort {
  name: string
  address: string
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
  /** User-supplied label that participates in the alias registry.
   *  Used to be `name` — legacy projects are auto-upgraded on load. */
  alias?: string
}

export interface DeviceConfiguration {
  deviceBoard: string
  communicationPort: string
  runtimeIpAddress?: string
  /**
   * Active board's VPP vendor-screen data (backplane modules, IO mappings,
   * Modbus tables, …). This is the flat view every consumer and the compile
   * pipeline read — it always mirrors `vendorScreenDataByBoard[deviceBoard]`.
   */
  vendorScreenData?: Record<string, unknown>
  /**
   * Per-board archive of vendor-screen data. VPP screens are board-specific —
   * a backplane configured for one target makes no sense on another — so each
   * board keeps its own bucket here and switching boards swaps the active
   * `vendorScreenData` instead of carrying stale modules across targets.
   * Legacy projects (flat `vendorScreenData` only) are migrated on load by
   * attributing the blob to the board the project was saved with.
   */
  vendorScreenDataByBoard?: Record<string, Record<string, unknown>>
  /**
   * User's choices for the board's `target.platformOptions` (VPP-declared
   * FQBN sub-options like processor variant, USB type, clock speed).
   * Keyed by option `key`, value is the chosen `values[].id`. Missing keys
   * fall back to the manifest's `default` at compile/upload time. Cleared
   * automatically when the selected board changes — platformOptions are
   * board-specific and a `cpu=atmega328old` choice on Nano makes no sense
   * for Mega. Optional for back-compat with project configs saved before
   * this field existed.
   */
  selectedPlatformOptions?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export type PlcStatus = 'INIT' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'EMPTY' | 'TRANSITIONING' | 'UNKNOWN'

/**
 * Per-task scan/cycle/latency stats from the runtime. Each IEC task
 * runs on its own thread under STruC++, so stats are reported per
 * task and the editor renders one row per entry. The `name` field
 * is the IEC task name from the project (falls back to `plc-task-<idx>`
 * when the compiled .so doesn't expose a name).
 */
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

/**
 * Plugin-contributed stat field. The runtime aggregates one of these
 * for each metric a loaded plugin exports via its `get_stats` hook
 * (e.g. EtherCAT cycle counters, VPP-package telemetry). The editor
 * renders them grouped under the plugin's `label` without needing to
 * know what the metric semantically represents.
 */
export interface PluginStatsField {
  label: string
  value: string | number | boolean
  unit?: string
}

export interface PluginStatsPayload {
  label: string
  fields: PluginStatsField[]
}

/**
 * Container for runtime timing stats. The runtime emits one entry per
 * IEC task plus an optional opaque map of plugin-contributed stats.
 * Pulled via the runtime's `/api/status?include_stats=true` endpoint.
 */
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

// ---------------------------------------------------------------------------
// Debugger
// ---------------------------------------------------------------------------

export type DebugConnectionType = 'tcp' | 'rtu' | 'websocket' | 'simulator'

export interface DebugConnectionConfig {
  connectionType: DebugConnectionType
  connectionParams: {
    ipAddress?: string
    port?: string
    baudRate?: number
    slaveId?: number
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
  /** Target byte order, detected from the runtime's MD5 response
   *  trailer.  Renderer-side debug components feed this into the
   *  swap layer at read / write boundaries.  Omitted on failure. */
  targetEndian?: 'le' | 'be'
  error?: string
}

// ---------------------------------------------------------------------------
// Simulator Debug
// ---------------------------------------------------------------------------

export interface SimulatorDebugResult {
  success: boolean
  tick?: number
  lastIndex?: number
  data?: string // hex string
  error?: string
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export interface CompileProgressEvent {
  stage: 'xml' | 'st' | 'c' | 'glue' | 'arduino' | 'upload' | 'done' | 'error'
  message: string
  progress?: number
  level?: string
  firmwarePath?: string
  plcStatus?: string
  /**
   * Structured strucpp diagnostic for click-to-open in the console.
   * Set on the per-error events emitted during a failed strucpp
   * compile; absent for plain progress messages.  Consumers that
   * don't care about navigation can ignore it.
   */
  compileError?: StructuredCompileError
}

/**
 * Subset of strucpp's `CompileError` carried over IPC.  Kept narrow
 * on purpose — only the fields the editor's console / navigation
 * actually consume travel across the bridge, to avoid coupling the
 * IPC shape to every internal strucpp detail.
 */
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

/**
 * Result of building a `.stlib` from a Library Project.  Mirrors the
 * shape of `CompileResult` (success / error) plus the artefact path
 * the console surfaces so the user can find the produced archive.
 *
 * The verification step (Phase 8 — running the synthetic project
 * through avr-gcc on the simulator target) reports its outcome
 * through `verification`: missing means the step hasn't been wired
 * yet; `success: true` means it ran clean; `success: false` does NOT
 * fail the build, the warning surfaces to the console instead (a
 * legitimate target may have more memory than the AVR simulator).
 */
export interface CompileLibraryResult {
  success: boolean
  /** Absolute path to the produced `<libname>.stlib`.  Only set on success. */
  stlibPath?: string
  /** Manifest name extracted from `library.json`. */
  libraryName?: string
  error?: string
  verification?: {
    success: boolean
    message?: string
  }
}

// ---------------------------------------------------------------------------
// Debugger Tree
// ---------------------------------------------------------------------------

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
  /**
   * Member names of an enumerated type, indexed by the underlying integer
   * value. Set only for leaves whose project type is a `derivation:
   * 'enumerated'` data type. The wire still carries an INT; the polling
   * loop maps it to the member name (`enumValues[i]`) on read, and the
   * force path maps the user-entered name back to its index on write.
   */
  enumValues?: string[]
}

// ---------------------------------------------------------------------------
// PLC Logs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

export interface LogObject {
  id: string
  level?: 'debug' | 'info' | 'warning' | 'error'
  message: string
  tstamp?: Date
  /**
   * Optional structured strucpp diagnostic that originated this log.
   * When set, the console renders the bracketed POU prefix as a
   * clickable button that opens the right tab/section. Plain
   * progress / informational logs leave this undefined.
   */
  compileError?: StructuredCompileError
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AI Feature
// ---------------------------------------------------------------------------

/**
 * Platform-provided configuration for the AI feature.
 * Resolved by the composition root from environment variables and persistent storage.
 */
export interface AIFeatureConfig {
  /** Whether the AI feature is enabled on this platform */
  isFeatureEnabled: boolean
  /** Whether the user has previously consented to AI usage */
  hasUserConsented: boolean
  /** User preference: whether inline ghost-text completions are active in editors */
  inlineCompletionsEnabled: boolean
}

// ---------------------------------------------------------------------------
// AI Chat
// ---------------------------------------------------------------------------

export type ChatMessageRole = 'user' | 'assistant'

/**
 * Anthropic-compatible content block. Persisted on the backend as JSONB.
 * On the wire from `/ai/chat`, mirrors what we re-send to Anthropic
 * across iterations of the agentic loop. Plain user text is normalized
 * to `[{ type: 'text', text: '...' }]` so readers don't need to branch
 * on string vs array.
 */
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
  /**
   * Plain string for legacy text-only turns; block array for restored
   * conversations from the backend (so `tool_use` / `tool_result` blocks
   * survive a reload). Renderers handle either form.
   */
  content: string | AIChatContentBlock[]
  timestamp: number
  rating?: 'up' | 'down'
  /**
   * Set when the message was loaded from the backend as part of a
   * persisted conversation; absent for in-progress local-only turns.
   * Used by the chat panel to know which conversation the message
   * belongs to when multiple are open across tabs.
   */
  conversationId?: string
}

// ---------------------------------------------------------------------------
// AI Billing — Entitlements + Usage (Phase 5)
// ---------------------------------------------------------------------------
//
// Mirrors the backend `ResolvedEntitlements` / `ResolvedUsage` shapes from
// autonomy-edge `infrastructure/services/billing/entitlements.service.ts`.
// Surfaced via `GET /me/entitlements` and `GET /me/usage` (Gustavo's chassis,
// populated by `EntitlementsService` + `AcuLedgerService`).

/** Subscription status as reported by the backend (Paddle-backed). */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired'

/** Plan level slug (standard < plus < premium). */
export type PlanLevelSlug = 'standard' | 'plus' | 'premium'

/**
 * Feature flags resolved from the active plan level. Open-ended map; only
 * declared keys are typed statically — backend may emit additional booleans
 * as new plan-gated features land.
 */
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

/**
 * Structured billing/limit payload from `/ai/chat` and `/ai/complete`. The
 * backend `CreditGuard` (autonomy-edge `presentation/guards/credit.guard.ts`)
 * throws one of these variants:
 *  - `insufficient_acu` (HTTP 402) — user is out of monthly ACU.
 *  - `subscription_inactive` (HTTP 402) — non-active Paddle subscription.
 *  - `rate_limit_exceeded` (HTTP 429) — the rolling usage window (default 6h,
 *    capped at a percentage of the monthly ACU) is spent. Carries `resetsAt`
 *    so the UI can tell the user when the window frees up.
 * Surfaced via `AIRequestError.billing` in the web adapter and stored on
 * `AISlice` as `billingError` for the exhaustion-modal consumer (DOPE-285).
 */
export type BillingErrorPayload = {
  code: 'insufficient_acu' | 'subscription_inactive' | 'rate_limit_exceeded'
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
  /**
   * Set when `code === 'rate_limit_exceeded'`. ISO-8601 timestamp at which the
   * rolling usage window resets and AI requests are allowed again. `null` when
   * the backend couldn't compute it (no prior reservations in the window).
   */
  resetsAt?: string | null
}

// ---------------------------------------------------------------------------
// Graphical Editor Flow Data Shapes
// ---------------------------------------------------------------------------

/**
 * FBD rung data — nodes + edges for one Function Block Diagram rung.
 * Used by both the store slice and the compiler adapter.
 */
export type FBDRungState = {
  comment: string
  selectedNodes: import('@xyflow/react').Node[]
  nodes: import('@xyflow/react').Node[]
  edges: import('@xyflow/react').Edge[]
}

/**
 * Represents a branch of elements connected to a specific block handle.
 * Input branches connect from the left rail to a block input handle.
 * Output branches connect from a block output handle to the right rail.
 *
 * Defined here (ports layer) rather than in the components layer so the
 * `RungLadderState.handleBranches` field below can reference it without
 * violating the layer rule that forbids ports from depending on components.
 * The components/_atoms ladder types module re-exports this name so
 * component code can keep importing it from a single nearby location.
 */
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

/**
 * Ladder rung data — nodes + edges + layout for one Ladder rung.
 * Used by both the store slice and the compiler adapter.
 */
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

// ---------------------------------------------------------------------------
// WebRTC
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Variable Reference
// ---------------------------------------------------------------------------

/** Composite key for identifying a variable reference in the system */
export type VariableReference = {
  pouName: string
  variableName: string
  variableType: PLCVariableType
}
