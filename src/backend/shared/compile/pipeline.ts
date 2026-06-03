/**
 * Shared OpenPLC compile pipeline.
 *
 * Single source of truth for the full compile flow (Steps 0–13 in
 * the editor's canonical pipeline).  Editor and web both drive this
 * function through a `CompilerPlatformPort`; the platform port
 * abstracts the three places where platform truly differs (xml2st
 * transport, arduino-cli transport, runtime upload transport).
 * Everything else — preprocessing, XML generation, strucpp compile,
 * conf authoring, defines authoring, bundle composition, ordering,
 * error formatting, log messages — is shared.
 *
 * Editor-canonical behaviour: every byte and every log line matches
 * what editor's `handleCompile` used to emit before this refactor.
 * The web pipeline will produce identical output once it lands on
 * this function in a follow-up PR.
 *
 * The function is pure with respect to side effects EXCEPT for the
 * platform port calls (subprocess spawns / HTTP requests) and the
 * `emit` callback (progress events).  No disk I/O, no globals.
 */

import type {
  CompilerPlatformPort,
  PlatformDeviceContext,
  PlatformLog,
} from '../../../middleware/shared/ports/compiler-platform-port'
import type { StructuredCompileError } from '../../../middleware/shared/ports/types'
import { composeRuntimeV4Bundle } from '../../../middleware/shared/utils/library/compose-runtime-v4-bundle'
import type { BoardHalsCompileEntry } from '../firmware/build-arduino-cli-args'
import { buildArduinoCliCompileArgs } from '../firmware/build-arduino-cli-args'
import { describeIncompatibleRuntime, isStrucppCompatibleRuntime } from '../firmware/runtime-version-gate'
import { buildKnownPous, emitCompileErrorEvents } from '../library/program-build-helpers'
import { runProgramBuildPipeline } from '../library/program-build-pipeline'
import type { DevicePin } from '../types/PLC/devices'
// PLCProjectData is read from the schema-shape type (singular `configuration`)
// because that's the runtime shape the editor's pipeline operates on.
// The web adapter currently keeps the renderer store in the port-shape
// (plural `configurations`) and converts at the pipeline entry — see C1
// in the architectural plan.
import type { PLCProjectData } from '../types/PLC/open-plc'
import { XmlGenerator } from '../utils/PLC/xml-generator'
import { buildCBlocksFromPous, composeFirmwareBundle } from './steps/compose-firmware-bundle'
import { generateRuntimeConfs } from './steps/generate-confs'
import { generateDefinesContent } from './steps/generate-defines'
import { findEmptyFbdVariables } from './steps/validate-empty-variables'

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

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
    | 'xml'
    | 'st'
    | 'strucpp'
    | 'confs'
    | 'firmware-bundle'
    | 'runtime-v4-bundle'
    | 'embed-c-blocks'
    | 'core-install'
    | 'lib-install'
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
  /** Optional cache hook for the strucpp debug-map.json bytes — the
   *  debugger reads these out of memory to map debug variable
   *  addresses without re-reading the file.  Called once per
   *  successful strucpp compile. */
  cacheDebugData?: (md5: string, debugMapJson: string) => void
  /** Persisted VPP Modbus screen state for the target device,
   *  sourced from `DeviceConfiguration.vendorScreenData` under
   *  the `modbus_rtu` / `modbus_tcp` keys.  Threaded straight
   *  through to `generateDefinesContent`, which emits the
   *  matching `MBSERIAL_*` / `MBTCP_*` macros for non-simulator
   *  Arduino targets.  Web passes `undefined` until the VPP
   *  Modbus screen lands on the web build. */
  vppModbusState?: import('./steps/modbus-defines').VppModbusScreenState
}

export interface RunCompilePipelineResult {
  success: boolean
  /** Structured strucpp + xml2st diagnostics from this run.  Carries
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

// ---------------------------------------------------------------------------
// Internal: emit helpers
// ---------------------------------------------------------------------------

function makePlatformLog(
  emit: (event: PipelineProgressEvent) => void,
  stage: PipelineProgressEvent['stage'],
): PlatformLog {
  return (message, level) => emit({ stage, message, level })
}

// ---------------------------------------------------------------------------
// Internal: bail helpers (single point for the "stop the pipeline" message)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full compile pipeline for a single project.  Branches on
 * `isRuntimeV4` / `isRuntimeV3` / `isSimulator` to drive the four
 * editor-canonical paths:
 *
 *   - Runtime v4 (openplc-compiler runtime): preprocess → XML → ST →
 *     strucpp → confs → composeRuntimeV4Bundle → version check →
 *     uploadRuntimeV4.
 *   - Simulator (avr8js):                   preprocess → XML → ST →
 *     strucpp → defines → composeFirmwareBundle → installCore/Lib
 *     (no-op on web) → compileArduino → return hex.
 *   - Arduino direct (physical board):     same as simulator, then
 *     uploadArduinoBoard.
 *   - Runtime v3 (legacy):                  preprocess → XML → ST →
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
    // Any unhandled throw (data shape mismatch, port impl crash,
    // strucpp module load failure) surfaces here as a single error
    // event so the renderer's IPC channel doesn't hang waiting on a
    // success/failure that never arrives.
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
    cacheDebugData,
    vppModbusState,
  } = args

  // ---------------------------------------------------------------------
  // Step 0: Use the already-preprocessed project data.
  //
  // Preprocessing (Python POU → ST stub conversion + C/C++ POU
  // sidecar extraction) runs on each platform's renderer side
  // BEFORE the pipeline is called — editor does it in the
  // compile-action that posts the IPC message, web does it in its
  // compile-adapter before invoking the pipeline.  Doing it again
  // here would double-process the data (and on editor the IPC
  // shape-conversion makes preprocessPous's port-shape assumptions
  // fail at runtime).  The pipeline trusts that `projectData.pous`
  // are already in ST form and that `originalCppPous` is attached
  // when the project has C/C++ POUs.
  // ---------------------------------------------------------------------
  const processedData = projectData as PLCProjectData & {
    originalCppPous?: Array<{ name: string; code: string; variables: unknown[] }>
  }
  const originalCppPous = processedData.originalCppPous ?? []

  // ---------------------------------------------------------------------
  // Step 0b: Reject blank FBD variable blocks before XML generation.
  //
  // An unnamed FBD in/out variable serialises to an empty
  // `<expression/>`, which makes xml2st crash with the opaque
  // `'NoneType' object has no attribute 'split'`.  Catch it here and
  // tell the user exactly which POU to fix.
  // ---------------------------------------------------------------------
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

  // ---------------------------------------------------------------------
  // Step 1: Generate IEC 61131-3 XML from the project JSON.
  // ---------------------------------------------------------------------
  emit({ stage: 'xml', message: 'Generating IEC 61131-3 XML...', level: 'info' })
  // XmlGenerator accepts the schema-shape PLCProjectData (singular
  // `configuration`).  We pass through the preprocessor's output
  // which is structurally compatible at runtime — see Step 0's type
  // note.
  const xmlResult = XmlGenerator(processedData as never, 'old-editor')
  if (!xmlResult.ok || !xmlResult.data) {
    return bailError(emit, 'xml', `Error generating XML from JSON: ${xmlResult.message}`)
  }
  const plcXml = xmlResult.data

  // ---------------------------------------------------------------------
  // Step 2: Transpile XML to ST via the platform port (xml2st binary
  // on editor, HTTP /generate-st on web).
  // ---------------------------------------------------------------------
  emit({ stage: 'st', message: 'Generating Structured Text...', level: 'info' })
  // `['--keep-structs']` — strucpp parses native `STRUCT` declarations
  // and rejects matiec's legacy struct→FB rewrite as a type-vs-instance
  // mismatch.  Editor's local xml2st always passed `--keep-structs`;
  // pre-pipeline this was hardcoded inside its compiler-module while
  // the web's compile-service `/generate-st` endpoint ran without it,
  // causing structs to compile on the desktop and fail on the web.
  // The flag set is now part of the port contract so both adapters
  // observe the same tokens — future xml2st flags get appended here
  // at this single call site.
  const stResult = await port.transpileXmlToSt(
    { xml: plcXml, xml2stArgs: ['--keep-structs'] },
    makePlatformLog(emit, 'st'),
  )
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

  // ---------------------------------------------------------------------
  // Step 3: Strucpp compile.  Emits generated.cpp/hpp,
  // generated_debug.cpp, debug-map.json, per-POU *.cpp splits, and the
  // program.st.map.json offset map.
  // ---------------------------------------------------------------------
  emit({ stage: 'strucpp', message: 'Compiling Structured Text to C++ with STruC++...', level: 'info' })
  const hasCBlocks = originalCppPous.length > 0
  // `buildKnownPous` is typed against the port-shape `PLCPou`; cast
  // through `never` for the same reason described in Step 0.
  const knownPous = buildKnownPous(processedData.pous as never)
  // MD5 of program.st — the runtime embeds this into defines.h via
  // `generateDefinesContent` for stale-program detection.  Each
  // platform's adapter implements `computeMd5` (editor: Node crypto;
  // web: spark-md5) so the shared module doesn't carry a
  // heavyweight hash dependency.  Both implementations produce
  // byte-identical hex.
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

  // Cache the debug-map.json bytes so the debugger can map variable
  // addresses without re-reading them from disk later.
  const strucppFilesMap: Record<string, string> = {}
  for (const file of strucppResult.files) {
    strucppFilesMap[file.name] = file.content
  }
  const debugMapJson = strucppFilesMap['debug-map.json'] ?? ''
  if (cacheDebugData) {
    cacheDebugData(md5, debugMapJson)
  }

  // ---------------------------------------------------------------------
  // Step 4a: Runtime v4 branch — compose v4 bundle, run version
  // check, upload.
  // ---------------------------------------------------------------------
  if (isRuntimeV4) {
    let confs
    try {
      emit({ stage: 'confs', message: 'Generating Runtime v4 conf files...', level: 'info' })
      confs = generateRuntimeConfs({
        servers: processedData.servers as never,
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
      })
    } catch (error) {
      return bailError(
        emit,
        'confs',
        `Error generating Runtime v4 configs: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    emit({ stage: 'runtime-v4-bundle', message: 'Composing Runtime v4 upload bundle...', level: 'info' })
    const cBlocks = buildCBlocksFromPous(originalCppPous as never)
    const bundle = composeRuntimeV4Bundle({
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
        // `generateRuntimeConfs` validated EtherCAT before returning;
        // null here means "no EtherCAT devices" → composer skips.
        ethercat: confs.ethercat ?? '',
      },
    })
    emit({
      stage: 'runtime-v4-bundle',
      message: `Runtime v4 bundle composed: ${Object.keys(bundle).length} files`,
      level: 'info',
    })

    // VPP boards (those from an installed `.vpp` package) ship a
    // vendor I/O driver alongside the program.  The platform port's
    // `packageVppPlugin` returns the extra files to merge in
    // (driver source under `vpp_plugin/`, the generated plugin
    // config under `conf/`, and `vpp_plugins.conf` which enables
    // the driver on the device).  Non-VPP boards return an empty
    // map and the bundle is unchanged.  Without this, programs
    // upload but the runtime runs as a generic v4 with no physical
    // I/O — the diagnostic surface for that failure is silence.
    const vppResult = await port.packageVppPlugin({ boardTarget }, makePlatformLog(emit, 'runtime-v4-bundle'))
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

    if (compileOnly) {
      emit({ stage: 'done', message: 'Compile only mode — skipping upload to runtime.', level: 'info' })
      return { success: true, md5, uploaded: false }
    }

    if (!deviceContext) {
      emit({
        stage: 'upload',
        message: 'Runtime not configured or not logged in. Skipping upload to runtime.',
        level: 'warning',
      })
      return { success: true, md5, uploaded: false }
    }

    // Strucpp-compatibility gate: a 4.0.x runtime can't load the
    // strucpp artefacts.  Probe before uploading so the user gets
    // "upgrade your runtime" instead of a cryptic 500.
    emit({ stage: 'runtime-version', message: 'Checking runtime version...', level: 'info' })
    const versionCheck = await port.checkRuntimeVersion(
      { context: deviceContext },
      makePlatformLog(emit, 'runtime-version'),
    )
    if (!isStrucppCompatibleRuntime(versionCheck.version)) {
      return bailError(emit, 'runtime-version', describeIncompatibleRuntime(versionCheck.version))
    }

    emit({ stage: 'upload', message: 'Uploading Runtime v4 bundle...', level: 'info' })
    const uploadResult = await port.uploadRuntimeV4({ bundle, context: deviceContext }, makePlatformLog(emit, 'upload'))
    if (!uploadResult.ok) {
      return bailError(emit, 'upload', 'Failed to upload to runtime.', uploadResult.errors)
    }
    emit({ stage: 'done', message: 'Upload complete.', level: 'info' })
    return { success: true, md5, uploaded: true }
  }

  // ---------------------------------------------------------------------
  // Step 4b: Arduino / Simulator path — install core + lib (no-op on
  // web), generate defines.h, compose firmware bundle, compile via
  // arduino-cli.
  // ---------------------------------------------------------------------
  emit({ stage: 'core-install', message: 'Installing Arduino core...', level: 'info' })
  const coreInstall = await port.installArduinoCore(
    { coreId: typeof boardEntry.platform === 'string' ? deriveArduinoCoreFromPlatform(boardEntry.platform) : '' },
    makePlatformLog(emit, 'core-install'),
  )
  if (!coreInstall.ok) {
    return bailError(emit, 'core-install', 'Failed to install Arduino core.', coreInstall.errors)
  }

  emit({ stage: 'lib-install', message: 'Installing Arduino libraries...', level: 'info' })
  const libInstall = await port.installArduinoLib({ libId: '' }, makePlatformLog(emit, 'lib-install'))
  if (!libInstall.ok) {
    return bailError(emit, 'lib-install', 'Failed to install Arduino libraries.', libInstall.errors)
  }

  // Build defines.h using the shared content authoring step.
  const definesH = generateDefinesContent({
    boardEntry,
    devicePinMapping,
    stProgramFileContent: programSt,
    buildMD5Hash: md5,
    boardRuntime,
    ...(vppModbusState !== undefined ? { vppModbusState } : {}),
  })

  // Compose firmware bundle (firmware skeleton + strucpp output +
  // c_blocks header/code + defines.h).  Pure function.
  emit({ stage: 'firmware-bundle', message: 'Composing firmware bundle...', level: 'info' })
  const cBlocks = buildCBlocksFromPous(originalCppPous as never)
  const firmwareFiles = composeFirmwareBundle({
    strucppFiles: strucppFilesMap,
    cBlocks,
    definesH,
    firmwareSkeleton,
  })

  // Build arduino-cli argv via the shared helper.  Same input/output
  // on both platforms.  `boardEntry` carries `platform` / `core` /
  // `c_flags` / etc. straight from `hals.json`.
  const arduinoArgs = buildArduinoCliCompileArgs(boardEntry, {
    sketchPath: 'examples/Baremetal/Baremetal.ino',
    libraryPath: 'src',
    avrLibStdCppInclude,
    parallel: arduinoCliParallel,
  })

  // ---------------------------------------------------------------------
  // Step 4b (cont.): Runtime v3 branch is a sub-case that runs BEFORE
  // the arduino-cli compile — it embeds C blocks into program.st and
  // uploads the merged ST file directly to the device.
  // ---------------------------------------------------------------------
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
    emit({ stage: 'embed-c-blocks', message: 'Embedding C blocks into program.st...', level: 'info' })
    // Editor's port implementation embeds c_blocks.h + c_blocks_code.cpp
    // into program.st as (*FILE:...*) marked comments; web's port
    // implementation no-ops (web doesn't target v3).  The pipeline
    // delegates to the port so the embed details stay platform-specific.
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

  // Run arduino-cli compile.  Editor: spawns the binary.  Web: HTTP
  // POST.  Both consume the same `files` map + `argv`.
  emit({ stage: 'arduino-compile', message: 'Compiling Arduino firmware...', level: 'info' })
  const compileResult = await port.compileArduino(
    { files: firmwareFiles, argv: arduinoArgs, parallel: arduinoCliParallel },
    makePlatformLog(emit, 'arduino-compile'),
  )
  if (!compileResult.ok || !compileResult.binary) {
    if (compileResult.errors && compileResult.errors.length > 0) {
      emitCompileErrorEvents(
        compileResult.errors.map((e) => ({ formatted: e.message, raw: e as unknown as never })),
        (msg, level, compileError) => emit({ stage: 'arduino-compile', message: msg, level, compileError }),
      )
    }
    return bailError(emit, 'arduino-compile', 'Arduino compilation failed', compileResult.errors)
  }

  // Simulator: return the hex bytes for the caller to load into avr8js.
  if (isSimulator) {
    emit({ stage: 'done', message: 'Simulator firmware ready', level: 'info' })
    return { success: true, md5, binary: compileResult.binary, uploaded: false }
  }

  // Compile-only: skip the physical upload step.
  if (compileOnly) {
    emit({ stage: 'done', message: 'Compile only mode — skipping upload to Arduino board.', level: 'info' })
    return { success: true, md5, binary: compileResult.binary, uploaded: false }
  }

  // Physical Arduino direct upload.  Uses `communicationPort` (the
  // user's serial-port pick) — no `deviceContext` involved; that
  // shape is for the HTTPS/orchestrator runtime-v4 transports, which
  // already returned above.  Web's `uploadArduinoBoard` adapter
  // no-ops because web doesn't target physical Arduinos directly.
  emit({ stage: 'upload', message: 'Uploading firmware to Arduino board...', level: 'info' })
  const uploadResult = await port.uploadArduinoBoard(
    {
      compilationPath: '',
      fqbn: typeof boardEntry.platform === 'string' ? boardEntry.platform : '',
      // User-selected serial port from the device-board UI picker.
      // Forwarded verbatim; the adapter decides what to do if the
      // caller didn't supply one (editor: fall back to the disk-
      // persisted value in `devices/configuration.json`).
      port: communicationPort ?? '',
    },
    makePlatformLog(emit, 'upload'),
  )
  if (!uploadResult.ok) {
    return bailError(emit, 'upload', 'Failed to upload to Arduino board.', uploadResult.errors)
  }

  emit({ stage: 'done', message: 'Arduino upload complete.', level: 'info' })
  return { success: true, md5, binary: compileResult.binary, uploaded: true }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derive the arduino-cli core id from a fully-qualified board name.
 *
 *   `'arduino:avr:mega'` → `'arduino:avr'`
 *   `'arduino:samd:zero'` → `'arduino:samd'`
 *
 * Used to pass the core id to `port.installArduinoCore`.  On web
 * (where install is a no-op) this never actually drives anything;
 * on editor it gates arduino-cli's lazy install.
 */
function deriveArduinoCoreFromPlatform(platform: string): string {
  const parts = platform.split(':')
  if (parts.length < 2) return ''
  return `${parts[0]}:${parts[1]}`
}
