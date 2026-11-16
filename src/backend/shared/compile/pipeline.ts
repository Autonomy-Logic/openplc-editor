import { generateModbusMasterHeader } from '../../../frontend/utils/modbus-master/generate-modbus-master-header'
import { buildOpcUaRuntimeConfig, generateOpcUaHeaderContent } from '../../../frontend/utils/opcua'
import type { S7CommSlaveConfigLike } from '../../../frontend/utils/s7comm'
import { generateS7CommHeaderContent } from '../../../frontend/utils/s7comm'
import { isVersionAtLeast } from '../../../frontend/utils/semver'
import type {
  CheckRuntimeVersionResult,
  CompilerPlatformPort,
  PlatformDeviceContext,
  PlatformLog,
  RuntimeV4Bundle,
} from '../../../middleware/shared/ports/compiler-platform-port'
import type { StructuredCompileError } from '../../../middleware/shared/ports/types'
import { composeRuntimeV4Bundle } from '../../../middleware/shared/utils/library/compose-runtime-v4-bundle'
import {
  checkModbusMaster,
  isModbusRemoteDevice,
  type MasterIssue,
  type MasterTarget,
  resolveModbusMasterProfile,
  resolveRs485Pins,
  type Rs485Board,
  storedRs485Pins,
} from '../../../middleware/shared/utils/modbus-master-profile'
import { resolveModbusServerProfile } from '../../../middleware/shared/utils/modbus-server-profile'
import {
  DEFAULT_S7_PROFILE,
  resolveAddressProducerCapabilities,
  resolveTargetCapabilities,
} from '../../../middleware/shared/utils/target-capabilities'
import type { BoardHalsCompileEntry } from '../firmware/build-arduino-cli-args'
import { buildArduinoCliCompileArgs } from '../firmware/build-arduino-cli-args'
import { isRetainConfigCapableRuntime, MIN_RETAIN_CONFIG_RUNTIME_VERSION } from '../firmware/runtime-version-gate'
import {
  describeEditorTooOldForRuntime,
  describeIncompatibleRuntime,
  describeVppRuntimeMismatch,
  isStrucppCompatibleRuntime,
} from '../firmware/runtime-version-gate'
import { buildKnownPous, emitCompileErrorEvents } from '../library/program-build-helpers'
import { runProgramBuildPipeline } from '../library/program-build-pipeline'
import {
  type DependencyHintSurface,
  detectsMissingArduinoCore,
  missingArduinoCoreHint,
} from '../packages/arduino-dependencies'
import type { DevicePin } from '../types/PLC/devices'
import type { PLCProjectData } from '../types/PLC/open-plc'
import { materialiseOpcUaCredentials } from './opcua-credentials'
import { buildCBlocksFromPous, composeFirmwareBundle } from './steps/compose-firmware-bundle'
import {
  computeIoImage,
  describeDuplicateOutput,
  describeIoImageSizes,
  describeUnbackedBail,
  describeUnbackedLocations,
  describeUnsupportedArea,
  IMAGE_AREAS_BAREMETAL,
  IMAGE_AREAS_RUNTIME_V4,
} from './steps/compute-io-image'
import { generateRuntimeConfs } from './steps/generate-confs'
import { generateDefinesContent } from './steps/generate-defines'
import { generateImageConf } from './steps/generate-image-conf'
import { generateRetainConf } from './steps/generate-retain-conf'
import { generateVppConfigContent } from './steps/generate-vpp-config'
import {
  isBuildNetworkEnabled,
  narrowModbusTransports,
  resolveServedRtuUart,
  selectModbusServer,
} from './steps/modbus-defines'
import { findEmptyFbdVariables } from './steps/validate-empty-variables'

/**
 * Stages the pipeline emits during a single run.  Each stage carries
 * an info / warning / error message and (for compile errors) the
 * structured `compileError` payload the renderer's click-to-navigate
 * keys off.
 */
export interface PipelineProgressEvent {
  stage:
    | 'preprocess'
    | 'validate'
    | 'st'
    | 'strucpp'
    | 'confs'
    | 'firmware-bundle'
    | 'runtime-v4-bundle'
    | 'embed-c-blocks'
    | 'arduino-compile'
    | 'runtime-version'
    | 'upload'
    | 'done'
    | 'error'
  message: string
  level: 'info' | 'warning' | 'error'
  compileError?: StructuredCompileError
}

/**
 * Slice of a `hals.json` board entry the pipeline reads.  Superset
 * of `BoardHalsCompileEntry` (used by `buildArduinoCliCompileArgs`)
 * plus the optional `define` field used by `generateDefinesContent`.
 * Caller passes the relevant entry from its platform's `hals.json`;
 * both platforms ship a byte-identical `hals.json` so the entry
 * shape is the same.
 */
export interface BoardHalsBuildEntry extends BoardHalsCompileEntry {
  /** Per-board #defines, fed through to `generateDefinesContent` as
   *  the `// Board defines` section. */
  define?: string | string[]
  /** Names of the device's configuration screens, and the physical transport it
   *  exposes. Forwarded from the VPP manifest so the pipeline can resolve the
   *  SAME Modbus profile the screen resolves — what the board can serve over is
   *  the board's to state, and the emitter had no access to it. */
  vppScreenNames?: string[]
  serialPorts?: string[]
  defaultSerial?: string
  networkInterfaces?: string[]
  /** RS-485 enable pin the package fixes per UART, from the manifest's `rs485FixedPins`. */
  rs485FixedPins?: Record<string, string>
  /** True when the board takes RS-485 pins per UART (`BoardBuildInfo.perUartAware`). Absent → legacy board. */
  perUartAware?: boolean
  /** The manifest's `defaults.pins.pull`, forwarded to `generateDefinesContent` for `PINPULL_DIN`. */
  pinPull?: import('../../../middleware/shared/ports/types').PinPullSpec
  /** Prebuilt arduino-hal (provisioning="prebuilt"): the precompiled Arduino
   *  library dir, linked via a 2nd `--library`. Present only for arduino
   *  prebuilt boards (the `source` HAL still compiles as the integration layer).
   *  Sourced from the VPP manifest `device.hal.precompiledLibrary`. */
  precompiledLibraryDir?: string
  /** Upload transport for arduino-cli targets. Absent/"serial" (default):
   *  serial-port upload. "ethernet": network upload, with the device IP passed
   *  as arduino-cli's `--port`. From `target.uploadMethod`. */
  uploadMethod?: 'serial' | 'ethernet'
  /** Compiler / runtime identifier (`'arduino-cli' | 'openplc-compiler'
   *  | 'simulator'`).  Used by `resolveTargetCapabilities`'s
   *  preset lookup — without this the resolver can't pick the right
   *  capability defaults for the board. */
  compiler?: string
  /** Truthy when the board came from a VPP package.  Lets the
   *  capability resolver flip `vppIo` on for v4-derived VPP boards
   *  that didn't ship an explicit capability block. */
  vpp?: unknown
  /** Per-board capability overrides. */
  capabilities?: Partial<import('../../../middleware/shared/utils/target-capabilities/types').TargetCapabilities>
}

export interface RunCompilePipelineArgs {
  /** Source project (renderer-side store flat shape).  Pipeline
   *  internally preprocesses to canonical schema shape before
   *  threading through downstream steps. */
  projectData: PLCProjectData
  /** Board target identifier from the user's selection (e.g. `'OpenPLC
   *  Simulator'`, `'OpenPLC Runtime v4 (RPi)'`, `'Arduino Mega 2560'`). */
  boardTarget: string
  /** Runtime identifier from the matching `hals.json` entry:
   *  `'simulator'` (avr8js), `'arduino-cli'` (direct Arduino board),
   *  `'openplc-compiler'` (runtime v4 vPLC). */
  boardRuntime: string
  /** Resolved `hals.json` entry for `boardTarget`.  Carries the
   *  per-board `define` field consumed by `generateDefinesContent`
   *  and the `platform` / c_flags / cxx_flags arduino-cli passes
   *  through. */
  boardEntry: BoardHalsBuildEntry
  /** Pin mappings parsed from `devices/pin-mapping.json`.  Threaded
   *  through to `generateDefinesContent` for the `PINMASK_*` and
   *  `NUM_*` defines. */
  devicePinMapping: DevicePin[]
  /** `true` when the user picked the simulator board.  Drives whether
   *  the pipeline returns after arduino-cli compile (simulator) or
   *  goes on to upload (physical Arduino). */
  isSimulator: boolean
  /** `true` when the runtime is the OpenPLC v4 vPLC (boardRuntime
   *  `'openplc-compiler'` + `boardTarget !== 'OpenPLC Runtime v3'`).
   *  Drives the v4 bundle path (composeRuntimeV4Bundle + uploadRuntimeV4). */
  isRuntimeV4: boolean
  /** `true` when the runtime is the legacy v3 (boardTarget ===
   *  `'OpenPLC Runtime v3'`).  Drives the v3 embed-c-blocks path. */
  isRuntimeV3: boolean
  /** `true` when the caller only wants a compile, no upload.  The
   *  pipeline still runs through every step but returns before the
   *  upload phase. */
  compileOnly: boolean
  /** Pre-loaded `.stlib` archives the strucpp compile needs.
   *  Resolved by the adapter (editor: from `node_modules/strucpp/lib`
   *  + user-installed pool; web: from bundled assets). */
  libraryArchives: unknown[]
  /** Library names the project enables but couldn't be resolved.
   *  Strucpp's pre-compile gate fails fast on these with a clear
   *  message. */
  missingLibraries: string[]
  /** Firmware skeleton — bundled `Baremetal.ino`, Arduino HAL,
   *  strucpp runtime headers, simulator HAL adapter.  Editor: from
   *  filesystem; web: from `import.meta.glob`.  Contents byte-
   *  identical between repos. */
  firmwareSkeleton: Record<string, string>
  /** Strucpp runtime headers keyed under `strucpp_runtime/include/<filename>`.
   *  Only used by `composeRuntimeV4Bundle`; pass empty for the
   *  simulator path. */
  strucppRuntimeHeaders: Record<string, string>
  /** Server-resolved path to the avr-libstdcpp include directory.
   *  Threaded through to `buildArduinoCliCompileArgs`.  Empty string
   *  when not applicable (e.g. non-AVR cores). */
  avrLibStdCppInclude: string
  /** When `false`, arduino-cli runs with `--jobs 1` (web sandbox
   *  default).  When `true`, defaults to `--jobs 0` (editor's
   *  use-every-core). */
  arduinoCliParallel: boolean
  /** Device context for upload steps.  `undefined` when the caller
   *  is compile-only or the runtime upload step won't run.  The
   *  pipeline never inspects this — it just forwards through. */
  deviceContext?: PlatformDeviceContext
  /** Serial port to hand to `arduino-cli upload --port` when the
   *  build targets a physical Arduino board.  Captured from the
   *  user's device-board UI picker — the renderer reads it from the
   *  store at compile time and passes it through unchanged.  When
   *  absent (older callers, runtime v4 / simulator paths), the
   *  pipeline still threads `''` through so the editor adapter can
   *  fall back to its legacy `devices/configuration.json` disk
   *  read.  Ignored entirely on simulator + runtime-v3/v4 branches. */
  communicationPort?: string
  /** Device IP for a board whose VPP declares `uploadMethod: "ethernet"` — the
   *  ethernet counterpart of `communicationPort`, and handled the same way: the
   *  caller's value (the CLI's `--host`, the store's in the GUI) is preferred
   *  by the adapter over the project file's persisted `runtimeIpAddress`, which
   *  lags whatever the user just asked for. Absent on every serial board. */
  runtimeIpAddress?: string
  /** Optional cache hook for the strucpp debug-map.json bytes — the
   *  debugger reads these out of memory to map debug variable
   *  addresses without re-reading the file.  Called once per
   *  successful strucpp compile. */
  cacheDebugData?: (md5: string, debugMapJson: string) => void
  /**
   * This editor's own version, compared against the `minEditorVersion` a runtime publishes at `GET
   * /api/capabilities`.
   */
  editorVersion?: string
  /** Persisted VPP Modbus screen state for the target device,
   *  sourced from `DeviceConfiguration.vendorScreenData` under
   *  the `modbus_rtu` / `modbus_tcp` keys.  Threaded straight
   *  through to `generateDefinesContent`, which emits the
   *  matching `MBSERIAL_*` / `MBTCP_*` macros for non-simulator
   *  Arduino targets.  Web passes `undefined` until the VPP
   *  Modbus screen lands on the web build. */
  vppModbusState?: import('./steps/modbus-defines').VppModbusScreenState
  /** The project's persistent-storage (RETAIN) settings, from `DeviceConfiguration.persistentStorage`. */
  persistentStorage?: import('../../../middleware/shared/ports/types').PersistentStorageSettings
  /** True when the selected target's VPP declares that its own driver
   *  handles retention (`hidesNativeScreens` includes
   *  `'persistent-storage'`).  Suppresses `retain.conf` entirely, which
   *  is what makes the runtime remove any copy the device still has and
   *  leaves the vendor's driver as the only store. */
  targetHidesPersistentStorage?: boolean
  /** User-authored configuration-screen data from `DeviceConfiguration.vendorScreenData`. */
  vendorScreenData?: Record<string, unknown>
  /** Where to tell the user how to repair a missing core when arduino-cli fails on one.
   *  Absent means no hint, for hosts that do not install cores. */
  dependencyHintSurface?: DependencyHintSurface
}

export interface RunCompilePipelineResult {
  success: boolean
  /** Structured strucpp diagnostics from this run.  Carries
   *  the per-error events the renderer's navigation keys off. */
  errors?: StructuredCompileError[]
  /** Compiled firmware bytes when the pipeline reached the
   *  arduino-cli compile step successfully.  `undefined` when the
   *  pipeline targeted runtime v4 (no arduino-cli step) or failed
   *  before compile.  Caller decides what to do with these bytes
   *  (editor: write to `Baremetal.ino.hex`; web: feed avr8js). */
  binary?: Uint8Array
  /** MD5 of the strucpp-compiled `program.st`.  Echoed back so
   *  callers can use it as a cache key (defines.h PROGRAM_MD5
   *  refers to it). */
  md5?: string
  /** `true` when an upload step ran successfully (runtime v4 upload,
   *  arduino direct upload, or runtime v3 upload).  `false` when
   *  the pipeline returned via `compileOnly` or before reaching
   *  upload. */
  uploaded?: boolean
}

function makePlatformLog(
  emit: (event: PipelineProgressEvent) => void,
  stage: PipelineProgressEvent['stage'],
): PlatformLog {
  return (message, level) => emit({ stage, message, level })
}

function bailError(
  emit: (event: PipelineProgressEvent) => void,
  stage: PipelineProgressEvent['stage'],
  message: string,
  errors?: StructuredCompileError[],
): RunCompilePipelineResult {
  emit({ stage, message, level: 'error' })
  emit({ stage: 'error', message: 'Stopping compilation process.', level: 'error' })
  return { success: false, errors }
}

/** Emits every error of `issues` at `stage`, then stops the pipeline on the last one. */
function bailIssues(
  emit: (event: PipelineProgressEvent) => void,
  stage: PipelineProgressEvent['stage'],
  issues: MasterIssue[],
): RunCompilePipelineResult {
  const errors = issues.filter((issue) => issue.severity === 'error')
  for (const issue of errors.slice(0, -1)) {
    emit({ stage, message: issue.message, level: 'error' })
  }
  return bailError(emit, stage, errors[errors.length - 1]?.message ?? 'Stopping compilation process.')
}

/**
 * Run the full compile pipeline for a single project.  Branches on
 * `isRuntimeV4` / `isRuntimeV3` / `isSimulator` to drive the four
 * editor-canonical paths:
 *
 *   - Runtime v4 (openplc-compiler runtime): preprocess → ST →
 *     strucpp → confs → composeRuntimeV4Bundle → version check →
 *     uploadRuntimeV4.
 *   - Simulator (avr8js):                   preprocess → ST →
 *     strucpp → defines → composeFirmwareBundle → compileArduino →
 *     return hex.
 *   - Arduino direct (physical board):     same as simulator, then
 *     uploadArduinoBoard.
 *   - Runtime v3 (legacy):                  preprocess → ST →
 *     strucpp → embed c-blocks → uploadRuntimeV3.
 *
 * Each branch returns the canonical `RunCompilePipelineResult`
 * shape — `success`, `errors`, `binary`, `md5`, `uploaded` — that
 * adapters surface to their `CompilerPort` callers.
 */
export async function runCompilePipeline(
  args: RunCompilePipelineArgs,
  port: CompilerPlatformPort,
  emit: (event: PipelineProgressEvent) => void,
): Promise<RunCompilePipelineResult> {
  try {
    return await runCompilePipelineInner(args, port, emit)
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    emit({ stage: 'error', message: `Unhandled pipeline error: ${message}`, level: 'error' })
    emit({ stage: 'error', message: 'Stopping compilation process.', level: 'error' })
    return { success: false }
  }
}

async function runCompilePipelineInner(
  args: RunCompilePipelineArgs,
  port: CompilerPlatformPort,
  emit: (event: PipelineProgressEvent) => void,
): Promise<RunCompilePipelineResult> {
  const {
    projectData,
    boardTarget,
    boardRuntime,
    boardEntry,
    devicePinMapping,
    isSimulator,
    isRuntimeV4,
    isRuntimeV3,
    compileOnly,
    libraryArchives,
    missingLibraries,
    firmwareSkeleton,
    strucppRuntimeHeaders,
    avrLibStdCppInclude,
    arduinoCliParallel,
    deviceContext,
    communicationPort,
    runtimeIpAddress,
    cacheDebugData,
    vppModbusState,
    persistentStorage,
    targetHidesPersistentStorage,
    vendorScreenData,
    editorVersion,
    dependencyHintSurface,
  } = args

  const targetCapabilities = resolveTargetCapabilities(boardEntry)

  const sizesTheImage = !isRuntimeV3 && !isSimulator

  const ioImage = computeIoImage({
    projectData,
    devicePinMapping,
    vendorScreenData,
    capabilities: resolveAddressProducerCapabilities(boardEntry),
    serverCapabilities: resolveTargetCapabilities(boardEntry),
    areas: isRuntimeV4 ? IMAGE_AREAS_RUNTIME_V4 : IMAGE_AREAS_BAREMETAL,
  })

  if (sizesTheImage && (ioImage.unsupported.length > 0 || ioImage.unbacked.length > 0)) {
    for (const issue of ioImage.unsupported) {
      emit({ stage: 'validate', message: describeUnsupportedArea(issue, boardTarget), level: 'error' })
    }
    for (const message of describeUnbackedLocations(ioImage.unbacked)) {
      emit({ stage: 'validate', message, level: 'error' })
    }
    return bailError(emit, 'validate', describeUnbackedBail(ioImage.unbacked))
  }

  if (sizesTheImage) {
    for (const issue of ioImage.duplicateOutputs) {
      emit({ stage: 'validate', message: describeDuplicateOutput(issue), level: 'warning' })
    }
  }

  if (sizesTheImage) {
    for (const line of describeIoImageSizes(ioImage)) {
      emit({ stage: 'validate', message: line, level: 'info' })
    }
  }

  const processedData = projectData as PLCProjectData & {
    originalCppPous?: Array<{ name: string; code: string; variables: unknown[] }>
  }
  const originalCppPous = processedData.originalCppPous ?? []

  const emptyVariables = findEmptyFbdVariables(processedData)
  if (emptyVariables.length > 0) {
    for (const variable of emptyVariables) {
      const where =
        variable.connectedTo !== null ? `connected to ${variable.connectedTo}` : `at x=${variable.x}, y=${variable.y}`
      emit({
        stage: 'validate',
        message: `POU "${variable.pouName}": an FBD ${variable.kind} variable block has no name (${where}). Name it before compiling.`,
        level: 'error',
      })
    }
    return bailError(emit, 'validate', 'Compilation aborted: name all variable blocks and try again.')
  }

  const modbusSelection = selectModbusServer(processedData.servers as never)
  const targetServesOneSlave = !isRuntimeV4 && !isSimulator && boardRuntime !== 'openplc-compiler'
  const oneSlaveConfigShips = !isSimulator && (targetCapabilities.modbusTcpServer || targetCapabilities.modbusRtuServer)
  if (oneSlaveConfigShips && modbusSelection.conflict) {
    return bailError(
      emit,
      'validate',
      `Compilation aborted: this target serves one Modbus server, and ${modbusSelection.conflict.join(', ')} are all enabled. Turn off all but one.`,
    )
  }

  const modbusProfile = resolveModbusServerProfile({
    compiler: boardEntry.compiler,
    ...(boardEntry.platform ? { platform: boardEntry.platform } : {}),
    ...(boardEntry.capabilities ? { capabilities: boardEntry.capabilities } : {}),
    ...(boardEntry.vppScreenNames
      ? { vpp: { screens: Object.fromEntries(boardEntry.vppScreenNames.map((name) => [name, true])) } }
      : {}),
    ...(boardEntry.networkInterfaces ? { networkInterfaces: boardEntry.networkInterfaces } : {}),
    ...(boardEntry.serialPorts ? { serialPorts: boardEntry.serialPorts } : {}),
    ...(boardEntry.defaultSerial ? { defaultSerial: boardEntry.defaultSerial } : {}),
  })

  const modbusServer = !targetServesOneSlave
    ? modbusSelection.server
    : narrowModbusTransports(modbusSelection.server, modbusProfile.transports, (dropped) => {
        for (const transport of dropped) {
          emit({
            stage: 'validate',
            level: 'warning',
            message:
              transport === 'tcp'
                ? 'Modbus TCP was requested, but this board declares no network carrier. It was left out of the build.'
                : 'Modbus RTU was requested, but this board declares no serial transport for it. It was left out of the build.',
          })
        }
      })

  const masterTarget: MasterTarget = isRuntimeV3
    ? 'runtime-v3'
    : isSimulator
      ? 'simulator'
      : isRuntimeV4
        ? 'runtime-v4'
        : 'baremetal'
  const masterProfile = resolveModbusMasterProfile(
    {
      ...(boardEntry.compiler ? { compiler: boardEntry.compiler } : {}),
      ...(boardEntry.serialPorts ? { serialPorts: boardEntry.serialPorts } : {}),
      ...(boardEntry.defaultSerial ? { defaultSerial: boardEntry.defaultSerial } : {}),
    },
    targetCapabilities,
  )
  const rs485Board: Rs485Board = {
    ...(boardEntry.serialPorts ? { serialPorts: boardEntry.serialPorts } : {}),
    ...(boardEntry.rs485FixedPins ? { rs485FixedPins: boardEntry.rs485FixedPins } : {}),
    perUartAware: boardEntry.perUartAware === true,
  }
  const remoteDevices = processedData.remoteDevices ?? []
  const rtuServerUart =
    masterTarget === 'baremetal' ? resolveServedRtuUart(modbusServer, boardEntry.defaultSerial) : null
  const rs485Pins =
    masterTarget === 'baremetal' ? resolveRs485Pins(vppModbusState ?? {}, rs485Board, rtuServerUart) : {}
  const masterIssues = checkModbusMaster({
    devices: remoteDevices,
    profile: masterProfile,
    board: {
      ...(boardEntry.serialPorts ? { serialPorts: boardEntry.serialPorts } : {}),
      ...(boardEntry.defaultSerial ? { defaultSerial: boardEntry.defaultSerial } : {}),
      rs485Pins: masterTarget === 'baremetal' ? storedRs485Pins(vppModbusState ?? {}, rs485Board, rtuServerUart) : {},
    },
    rtuServerUart,
    networkEnabled:
      masterTarget !== 'baremetal' ||
      (vppModbusState !== undefined && isBuildNetworkEnabled(vppModbusState, modbusServer)),
    target: masterTarget,
    hasRemoteDevices: remoteDevices.length > 0,
    boardTarget,
  })
  for (const issue of masterIssues) {
    if (issue.severity === 'warning') emit({ stage: 'validate', message: issue.message, level: 'warning' })
  }
  if (masterIssues.some((issue) => issue.severity === 'error')) {
    return bailIssues(emit, 'validate', masterIssues)
  }

  let modbusMasterConfigH: string | undefined
  if (masterTarget === 'baremetal' && masterProfile.runsDevices && remoteDevices.some(isModbusRemoteDevice)) {
    const generated = generateModbusMasterHeader({
      devices: remoteDevices,
      profile: masterProfile,
      board: {
        ...(boardEntry.serialPorts ? { serialPorts: boardEntry.serialPorts } : {}),
        ...(boardEntry.defaultSerial ? { defaultSerial: boardEntry.defaultSerial } : {}),
      },
      rs485Pins,
    })
    if (!generated.ok) return bailIssues(emit, 'validate', generated.issues)
    modbusMasterConfigH = generated.header
  }

  emit({ stage: 'st', message: 'Generating Structured Text...', level: 'info' })
  const stResult = await port.transpileToSt({ projectData: processedData as never }, makePlatformLog(emit, 'st'))
  if (!stResult.ok || !stResult.programSt) {
    if (stResult.errors && stResult.errors.length > 0) {
      emitCompileErrorEvents(
        stResult.errors.map((e) => ({ formatted: e.message, raw: e as unknown as never })),
        (msg, level, compileError) => emit({ stage: 'st', message: msg, level, compileError }),
      )
    }
    return bailError(emit, 'st', 'Failed to generate Structured Text', stResult.errors)
  }
  const programSt = stResult.programSt

  emit({ stage: 'strucpp', message: 'Compiling Structured Text to C++ with STruC++...', level: 'info' })
  const hasCBlocks = originalCppPous.length > 0
  const knownPous = buildKnownPous(processedData.pous as never)
  const md5 = await port.computeMd5(programSt)
  const strucppResult = runProgramBuildPipeline({
    source: programSt,
    md5,
    pous: knownPous,
    libraries: libraryArchives,
    missingLibraries,
    hasCBlocks,
  })
  if (strucppResult.splitterFallbackMessage) {
    emit({ stage: 'st', message: strucppResult.splitterFallbackMessage, level: 'info' })
  }
  if (!strucppResult.success) {
    emitCompileErrorEvents(strucppResult.errors, (msg, level, compileError) =>
      emit({ stage: 'st', message: msg, level, compileError }),
    )
    return bailError(emit, 'strucpp', 'STruC++ compilation failed')
  }
  for (const warn of strucppResult.warnings) {
    emit({ stage: 'st', message: warn.formatted ?? 'unknown warning', level: 'warning' })
  }
  if (strucppResult.debugMapSummary) {
    emit({ stage: 'st', message: strucppResult.debugMapSummary, level: 'info' })
  }

  const strucppFilesMap: Record<string, string> = {}
  for (const file of strucppResult.files) {
    strucppFilesMap[file.name] = file.content
  }
  const debugMapJson = strucppFilesMap['debug-map.json'] ?? ''
  if (cacheDebugData) {
    cacheDebugData(md5, debugMapJson)
  }

  if (isRuntimeV4) {
    let versionCheck: CheckRuntimeVersionResult | null = null
    if (!compileOnly && deviceContext) {
      emit({ stage: 'runtime-version', message: 'Checking runtime version...', level: 'info' })
      versionCheck = await port.checkRuntimeVersion(
        { context: deviceContext },
        makePlatformLog(emit, 'runtime-version'),
      )
    }

    let confs
    try {
      emit({ stage: 'confs', message: 'Generating Runtime v4 conf files...', level: 'info' })
      const opcuaCredentialServers = await materialiseOpcUaCredentials(
        processedData.servers,
        targetCapabilities.opcua,
        (message) => emit({ stage: 'confs', message, level: 'warning' }),
      )

      confs = generateRuntimeConfs({
        imageSizes: ioImage.sizes,
        s7Profile: targetCapabilities.s7 ?? DEFAULT_S7_PROFILE,
        servers: opcuaCredentialServers as never,
        remoteDevices: processedData.remoteDevices as never,
        instances: processedData.configuration.resource.instances.map(
          (inst: { name: string; task: string; program: string }) => ({
            name: inst.name,
            task: inst.task,
            program: inst.program,
          }),
        ),
        debugMapContent: debugMapJson,
        log: (message, level) => emit({ stage: 'confs', message, level }),
        runtimeVersion: versionCheck?.version ?? null,
      })
    } catch (error) {
      return bailError(
        emit,
        'confs',
        `Error generating Runtime v4 configs: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    emit({ stage: 'runtime-v4-bundle', message: 'Composing Runtime v4 upload bundle...', level: 'info' })
    const userTypeNames = (projectData.dataTypes ?? []).map((dataType) => dataType.name)
    const cBlocks = buildCBlocksFromPous(originalCppPous as never, userTypeNames)
    const bundle: RuntimeV4Bundle = composeRuntimeV4Bundle({
      programSt,
      md5,
      strucppFiles: strucppFilesMap,
      cBlocks: { header: cBlocks.header, code: cBlocks.code },
      strucppRuntimeHeaders,
      confs: {
        modbusSlave: confs.modbusSlave,
        modbusMaster: confs.modbusMaster,
        s7Comm: confs.s7Comm,
        opcUa: confs.opcUa,
        ethercat: confs.ethercat,
        ethercatBusconfig: confs.ethercatBusconfig,
        ethercatIomapping: confs.ethercatIomapping,
      },
    })
    emit({
      stage: 'runtime-v4-bundle',
      message: `Runtime v4 bundle composed: ${Object.keys(bundle).length} files`,
      level: 'info',
    })

    const instances = (projectData.configuration?.resource?.instances ?? []).map((inst) => ({
      name: inst.name,
      program: inst.program,
    }))
    const vppExtensions = projectData.vppExtensions ?? {}
    const vppResult = await port.packageVppPlugin(
      { boardTarget, screenConfigInputs: { vppExtensions, debugMapContent: debugMapJson, instances } },
      makePlatformLog(emit, 'runtime-v4-bundle'),
    )
    if (vppResult.errors && vppResult.errors.length > 0) {
      return bailError(emit, 'runtime-v4-bundle', 'VPP plugin packaging failed.', vppResult.errors)
    }
    const vppFileCount = Object.keys(vppResult.files).length
    if (vppFileCount > 0) {
      Object.assign(bundle, vppResult.files)
      emit({
        stage: 'runtime-v4-bundle',
        message: `Merged ${vppFileCount} VPP plugin file(s) into bundle (bundle now ${Object.keys(bundle).length} files)`,
        level: 'info',
      })
    }

    const retainConf = generateRetainConf({
      settings: persistentStorage,
      targetHidesPersistentStorage: targetHidesPersistentStorage ?? false,
    })
    if (retainConf !== null) {
      bundle['retain.conf'] = retainConf
      emit({
        stage: 'runtime-v4-bundle',
        message: 'Generated retain.conf (persistent storage on)',
        level: 'info',
      })
    }

    bundle['image.conf'] = generateImageConf(ioImage.sizes)
    emit({
      stage: 'runtime-v4-bundle',
      message: `Generated image.conf (${Object.keys(ioImage.sizes).length} address area(s) sized from the project)`,
      level: 'info',
    })

    if (port.materializeRuntimeV4Bundle) {
      const materialized = await port.materializeRuntimeV4Bundle({ bundle }, makePlatformLog(emit, 'runtime-v4-bundle'))
      if (materialized.errors && materialized.errors.length > 0) {
        return bailError(
          emit,
          'runtime-v4-bundle',
          'Could not write the Runtime v4 build artifacts.',
          materialized.errors,
        )
      }
      emit({
        stage: 'runtime-v4-bundle',
        message: `Wrote ${materialized.written} build artifact(s) to the project build folder`,
        level: 'info',
      })
    }

    if (compileOnly) {
      emit({ stage: 'done', message: 'Compile only mode — skipping upload to runtime.', level: 'info' })
      return { success: true, md5, uploaded: false }
    }

    if (!deviceContext || !versionCheck) {
      emit({
        stage: 'upload',
        message: 'Runtime not configured or not logged in. Skipping upload to runtime.',
        level: 'warning',
      })
      return { success: true, md5, uploaded: false }
    }

    if (!isStrucppCompatibleRuntime(versionCheck.version)) {
      return bailError(emit, 'runtime-version', describeIncompatibleRuntime(versionCheck.version))
    }

    if (editorVersion && !isVersionAtLeast(editorVersion, versionCheck.minEditorVersion)) {
      return bailError(
        emit,
        'runtime-version',
        describeEditorTooOldForRuntime({
          runtimeVersion: versionCheck.version,
          minEditorVersion: versionCheck.minEditorVersion ?? '',
          editorVersion,
          deviceLabel: deviceContext.kind === 'editor-https' ? deviceContext.ip : undefined,
        }),
      )
    }

    if (!isVersionAtLeast(versionCheck.version, vppResult.minRuntimeVersion)) {
      return bailError(
        emit,
        'runtime-version',
        describeVppRuntimeMismatch({
          boardTarget,
          minRuntimeVersion: vppResult.minRuntimeVersion ?? '',
          runtimeVersion: versionCheck.version,
          deviceLabel: deviceContext.kind === 'editor-https' ? deviceContext.ip : undefined,
        }),
      )
    }

    if (bundle['retain.conf'] !== undefined && !isRetainConfigCapableRuntime(versionCheck.version)) {
      emit({
        stage: 'runtime-version',
        message:
          `This project turns on persistent storage, but the runtime on this device is ` +
          `${versionCheck.version || 'older than'} — the built-in retain store arrived in ` +
          `${MIN_RETAIN_CONFIG_RUNTIME_VERSION}. The program will run, but RETAIN variables ` +
          `will start at their initial values after every restart until the runtime is updated.`,
        level: 'warning',
      })
    }

    emit({ stage: 'upload', message: 'Uploading Runtime v4 bundle...', level: 'info' })
    const uploadResult = await port.uploadRuntimeV4(
      {
        bundle,
        context: deviceContext,
        supportsProjectSnapshot: versionCheck.supportsProjectSnapshot,
      },
      makePlatformLog(emit, 'upload'),
    )
    if (!uploadResult.ok) {
      return bailError(emit, 'upload', 'Failed to upload to runtime.', uploadResult.errors)
    }
    emit({ stage: 'done', message: 'Upload complete.', level: 'info' })
    return { success: true, md5, uploaded: true }
  }

  if (isRuntimeV3) {
    if (compileOnly) {
      emit({ stage: 'done', message: 'Compile only mode — skipping upload to runtime v3.', level: 'info' })
      return { success: true, md5, uploaded: false }
    }
    if (!deviceContext) {
      emit({
        stage: 'upload',
        message: 'Runtime v3 not configured. Skipping upload.',
        level: 'warning',
      })
      return { success: true, md5, uploaded: false }
    }

    emit({ stage: 'upload', message: 'Uploading program.st to Runtime v3...', level: 'info' })
    const uploadResult = await port.uploadRuntimeV3(
      { programSt, context: deviceContext },
      makePlatformLog(emit, 'upload'),
    )
    if (!uploadResult.ok) {
      return bailError(emit, 'upload', 'Failed to upload to Runtime v3.', uploadResult.errors)
    }
    emit({ stage: 'done', message: 'Runtime v3 upload complete.', level: 'info' })
    return { success: true, md5, uploaded: true }
  }

  const definesH = generateDefinesContent({
    boardEntry,
    devicePinMapping,
    buildMD5Hash: md5,
    boardRuntime,
    ...(vppModbusState !== undefined ? { vppModbusState } : {}),
    ...(modbusServer !== undefined ? { modbusServer } : {}),
    ...(boardEntry.defaultSerial ? { defaultSerial: boardEntry.defaultSerial } : {}),
    ...(boardEntry.networkInterfaces ? { networkInterfaces: boardEntry.networkInterfaces } : {}),
    rs485Board,
    ...(strucppResult.retainBlobSize !== null ? { retainBlobSize: strucppResult.retainBlobSize } : {}),
    ...(sizesTheImage ? { imageSizes: ioImage.sizes } : {}),
    ...(boardEntry.pinPull ? { pinPull: boardEntry.pinPull } : {}),
  })

  if (boardEntry.uploadMethod === 'ethernet' && !definesH.includes('#define OPLC_NET_ENABLED')) {
    return bailError(
      emit,
      'validate',
      'This board is programmed over Ethernet, so a build with the network disabled could never be ' +
        'reached again — not by the debugger, the uploader, or Search. Enable the Network screen for ' +
        'this device and build again.',
    )
  }

  const vppConfigH = targetCapabilities.vppIo ? generateVppConfigContent({ vendorScreenData }) : undefined

  const targetHostsServers = !targetCapabilities.isInProcessSimulator

  let opcuaConfigH: string | undefined
  if (targetCapabilities.opcuaServer && targetCapabilities.opcua && targetHostsServers) {
    try {
      const opcuaCredentialServers = await materialiseOpcUaCredentials(
        processedData.servers,
        targetCapabilities.opcua,
        (message) => emit({ stage: 'firmware-bundle', message, level: 'warning' }),
      )
      const resolvedOpcUa = buildOpcUaRuntimeConfig(
        opcuaCredentialServers,
        debugMapJson,
        processedData.configuration.resource.instances.map((inst: { name: string; task: string; program: string }) => ({
          name: inst.name,
          task: inst.task,
          program: inst.program,
        })),
        (message: string) => emit({ stage: 'firmware-bundle', message, level: 'warning' }),
      )
      opcuaConfigH = generateOpcUaHeaderContent({
        resolved: resolvedOpcUa,
        profile: targetCapabilities.opcua,
        buildEpochSeconds: Math.floor(Date.now() / 1000),
        warn: (message) => emit({ stage: 'firmware-bundle', message, level: 'warning' }),
      })
    } catch (error) {
      return bailError(
        emit,
        'firmware-bundle',
        `Error generating OPC-UA config header: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  let s7commConfigH: string | undefined
  if (targetCapabilities.s7Server && targetCapabilities.s7 && targetHostsServers) {
    try {
      const s7Server = (processedData.servers ?? []).find(
        (server: { protocol?: string; s7commSlaveConfig?: { server?: { enabled?: boolean } } }) =>
          server.protocol === 's7comm' && server.s7commSlaveConfig?.server?.enabled,
      ) as { s7commSlaveConfig?: S7CommSlaveConfigLike } | undefined

      s7commConfigH = generateS7CommHeaderContent({
        config: s7Server?.s7commSlaveConfig ?? null,
        profile: targetCapabilities.s7,
        warn: (message) => emit({ stage: 'firmware-bundle', message, level: 'warning' }),
      })
    } catch (error) {
      return bailError(
        emit,
        'firmware-bundle',
        `Error generating S7Comm config header: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  emit({ stage: 'firmware-bundle', message: 'Composing firmware bundle...', level: 'info' })
  const userTypeNames = (projectData.dataTypes ?? []).map((dataType) => dataType.name)
  const cBlocks = buildCBlocksFromPous(originalCppPous as never, userTypeNames)
  const firmwareFiles = composeFirmwareBundle({
    strucppFiles: strucppFilesMap,
    cBlocks,
    definesH,
    vppConfigH,
    opcuaConfigH,
    s7commConfigH,
    modbusMasterConfigH,
    firmwareSkeleton,
  })

  const arduinoArgs = buildArduinoCliCompileArgs(boardEntry, {
    sketchPath: 'examples/Baremetal/Baremetal.ino',
    libraryPath: 'src',
    avrLibStdCppInclude,
    parallel: arduinoCliParallel,
    ...(boardEntry.precompiledLibraryDir ? { prebuiltLibraryPath: boardEntry.precompiledLibraryDir } : {}),
  })

  emit({ stage: 'arduino-compile', message: 'Compiling Arduino firmware...', level: 'info' })
  const compileOutput: string[] = []
  const compileLog = makePlatformLog(emit, 'arduino-compile')
  const compileResult = await port.compileArduino(
    { files: firmwareFiles, argv: arduinoArgs, parallel: arduinoCliParallel },
    (message, level) => {
      compileOutput.push(message)
      compileLog(message, level)
    },
  )
  if (!compileResult.ok) {
    if (compileResult.errors && compileResult.errors.length > 0) {
      emitCompileErrorEvents(
        compileResult.errors.map((e) => ({ formatted: e.message, raw: e as unknown as never })),
        (msg, level, compileError) => emit({ stage: 'arduino-compile', message: msg, level, compileError }),
      )
    }
    const failed = bailError(emit, 'arduino-compile', 'Arduino compilation failed', compileResult.errors)
    if (dependencyHintSurface) {
      const output = [...compileOutput, ...(compileResult.errors ?? []).map((e) => e.message)].join('\n')
      if (detectsMissingArduinoCore(output)) {
        const hint = missingArduinoCoreHint({ simulator: isSimulator, surface: dependencyHintSurface })
        emit({ stage: 'error', message: hint, level: 'error' })
      }
    }
    return failed
  }

  if (isSimulator) {
    if (!compileResult.binary) {
      return bailError(
        emit,
        'arduino-compile',
        'Simulator build did not produce a .hex artefact.',
        compileResult.errors,
      )
    }
    emit({ stage: 'done', message: 'Simulator firmware ready', level: 'info' })
    return { success: true, md5, binary: compileResult.binary, uploaded: false }
  }

  if (compileOnly) {
    emit({ stage: 'done', message: 'Compile only mode — skipping upload to Arduino board.', level: 'info' })
    return { success: true, md5, binary: compileResult.binary, uploaded: false }
  }

  emit({ stage: 'upload', message: 'Uploading firmware to Arduino board...', level: 'info' })
  const uploadResult = await port.uploadArduinoBoard(
    {
      compilationPath: '',
      fqbn: typeof boardEntry.platform === 'string' ? boardEntry.platform : '',
      port: communicationPort ?? '',
      uploadMethod: boardEntry.uploadMethod,
      ...(runtimeIpAddress ? { ipAddress: runtimeIpAddress } : {}),
    },
    makePlatformLog(emit, 'upload'),
  )
  if (!uploadResult.ok) {
    return bailError(emit, 'upload', 'Failed to upload to Arduino board.', uploadResult.errors)
  }

  emit({ stage: 'done', message: 'Arduino upload complete.', level: 'info' })
  return { success: true, md5, binary: compileResult.binary, uploaded: true }
}
