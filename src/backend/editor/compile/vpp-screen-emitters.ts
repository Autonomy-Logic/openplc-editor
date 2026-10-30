/**
 * Load and run VPP screen runtime-config emitters.
 *
 * The editor's compile pipeline, after assembling the Runtime v4 bundle, consults each installed VPP
 * package's manifest for a `runtimeEmitters` map on the active device. For every `(screenId, emitterPath)`
 * entry we read the emitter source off disk, run it in a Node `vm.Script` with a narrow sandbox, and
 * merge the files it returns into the bundle at `conf/<name>.json` paths. Pure guest-to-host contract:
 * input is `{ data, model, packageId, screenId }`, output is `{ files, errors? }`.
 */

import { normalize } from 'path'

import type { ExportableVariable } from '../../../middleware/shared/ports/plc-model-port'
import { PackageManagerModule } from '../package-manager/package-manager-module'
import { createWorkerThreadEmitterSandbox, type EmitterSandbox } from './vpp-emitter-sandbox'

/** Alias kept for emitter-side readability — the actual type lives in `plc-model-port`. */
export type EmitterExportableVariable = ExportableVariable

/** Per-leaf debug-map entry: the (arr, elem) address inside the STruC++ debug Entry tables
 *  plus the compiler-authoritative IEC datatype. The plugin side consumes these verbatim
 *  through `plugin_runtime_args_t.debug_read/debug_write`. */
export interface EmitterDebugEntry {
  arr: number
  elem: number
  datatype: string
}

export interface EmitterInput {
  data: unknown
  model: {
    exportableVariables: ReadonlyArray<EmitterExportableVariable>
    /** Resolve a qualifier to its IEC location (`%IX0.0`, `%QW1.2`, …). Hardware VPPs
     *  (Modbus master, EtherCAT, Weidmüller HAL) pin exports to a located variable. */
    resolveAddress(qualifier: string): string
    /** Resolve a qualifier to its STruC++ debug-map entry. Publisher VPPs (Data Hub,
     *  future OPC-UA-like bridges) use this to export any program variable through the
     *  runtime's debugger surface, not just located ones. Returns `null` when the
     *  qualifier is not in the debug map (e.g. no debug compile ran, or the picker
     *  outran the stored project). */
    resolveDebugEntry(qualifier: string): EmitterDebugEntry | null
  }
  packageId: string
  screenId: string
}

export interface EmitterOutput {
  files: Record<string, string | Uint8Array>
  errors?: string[]
}

/** Collection of the vppExtensions stored in the project — passed in from the renderer at compile. */
export type VppExtensionsSnapshot = Record<string, Record<string, unknown>>

export interface CollectArgs {
  vppExtensions: VppExtensionsSnapshot
  deviceId: string
  exportableVariables: ReadonlyArray<EmitterExportableVariable>
  resolveAddress(qualifier: string): string
  /** Optional on the collector args so callers that only care about `resolveAddress` (hardware
   *  VPP emitters, legacy unit tests) do not have to build a debug-map resolver. Absent means
   *  the sandbox sees a resolver that always returns `null`, and a publisher emitter that
   *  depends on it refuses the compile with its own error. */
  resolveDebugEntry?(qualifier: string): EmitterDebugEntry | null
  /** Injected execution boundary. Production callers leave it unset to get the worker-threads
   *  sandbox; tests inject the in-process sandbox for determinism and speed. */
  sandbox?: EmitterSandbox
}

export interface CollectResult {
  files: Record<string, string | Uint8Array>
  errors: string[]
}

/** Hard deadline enforced inside the sandbox. Short because emitters are pure config transforms
 *  — anything longer is a runaway loop, not a slow computation. */
const EMITTER_TIMEOUT_MS = 2000

export async function collectVppScreenRuntimeArtifacts(args: CollectArgs): Promise<CollectResult> {
  const files: Record<string, string | Uint8Array> = {}
  const errors: string[] = []
  const packageIds = Object.keys(args.vppExtensions ?? {})
  if (packageIds.length === 0) return { files, errors }

  const pkgManager = new PackageManagerModule()
  const installed = pkgManager.listInstalled()
  const sandbox = args.sandbox ?? createWorkerThreadEmitterSandbox()
  const resolveDebugEntry = args.resolveDebugEntry ?? ((): EmitterDebugEntry | null => null)

  try {
    for (const packageId of packageIds) {
      const pkg = installed.find((p) => p.packageId === packageId)
      if (!pkg) {
        errors.push(`Project uses VPP ${packageId} but it is not installed; skipping its runtime emitters.`)
        continue
      }
      const manifest = pkgManager.getInstalledPackageManifest(packageId)
      if (!manifest) {
        errors.push(`Could not read manifest for ${packageId}; skipping its runtime emitters.`)
        continue
      }
      // Match on name first (what the pipeline passes as `boardTarget`), fall back to id.
      const device = manifest.devices.find(
        (d) => (d as { name?: string }).name === args.deviceId || d.id === args.deviceId,
      )
      if (!device) continue
      const emitters =
        typeof device === 'object' && device !== null && 'runtimeEmitters' in device
          ? (device as { runtimeEmitters?: Record<string, string> }).runtimeEmitters
          : undefined
      if (!emitters) continue

      const perPackage = args.vppExtensions[packageId] ?? {}

      for (const [screenId, emitterRel] of Object.entries(emitters)) {
        if (!(screenId in perPackage)) continue
        let result: EmitterOutput
        try {
          result = await sandbox.run({
            packageDir: pkg.path,
            relPath: emitterRel,
            data: perPackage[screenId],
            packageId,
            screenId,
            exportableVariables: args.exportableVariables,
            resolveAddress: args.resolveAddress,
            resolveDebugEntry,
            deadlineMs: EMITTER_TIMEOUT_MS,
          })
        } catch (e) {
          errors.push(`VPP ${packageId}:${screenId} emitter failed: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        if (result.errors) errors.push(...result.errors.map((m) => `${packageId}:${screenId}: ${m}`))
        if (result.files) {
          for (const [path, content] of Object.entries(result.files)) {
            const normalized = normalize(path)
            if (normalized.startsWith('..') || normalized.includes('..')) {
              errors.push(`${packageId}:${screenId}: emitter tried to write outside bundle (${path})`)
              continue
            }
            files[normalized] = content
          }
        }
      }
    }
  } finally {
    sandbox.dispose()
  }

  return { files, errors }
}
