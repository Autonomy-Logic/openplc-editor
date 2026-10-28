/**
 * Load and run VPP screen runtime-config emitters (RTOP-306 PoC).
 *
 * The editor's compile pipeline, after assembling the Runtime v4 bundle, consults each installed VPP
 * package's manifest for a `runtimeEmitters` map on the active device. For every `(screenId, emitterPath)`
 * entry we read the emitter source off disk, run it in a Node `vm.Script` with a narrow sandbox, and
 * merge the files it returns into the bundle at `conf/<name>.json` paths. Pure guest-to-host contract:
 * input is `{ data, model, packageId, screenId }`, output is `{ files, errors? }`.
 */

import { readFileSync } from 'fs'
import { join, normalize, relative } from 'path'
import { Script, createContext } from 'vm'

import { PackageManagerModule } from '../package-manager/package-manager-module'

export interface EmitterExportableVariable {
  qualifier: string
  type: string
  isWritable: boolean
}

export interface EmitterInput {
  data: unknown
  model: {
    exportableVariables: ReadonlyArray<EmitterExportableVariable>
    resolveAddress(qualifier: string): string
  }
  packageId: string
  screenId: string
}

export interface EmitterOutput {
  files: Record<string, string | Uint8Array>
  errors?: string[]
}

type EmitterFn = (input: EmitterInput) => EmitterOutput

/** Collection of the vppExtensions stored in the project — passed in from the renderer at compile. */
export type VppExtensionsSnapshot = Record<string, Record<string, unknown>>

export interface CollectArgs {
  vppExtensions: VppExtensionsSnapshot
  deviceId: string
  exportableVariables: ReadonlyArray<EmitterExportableVariable>
  resolveAddress(qualifier: string): string
}

export interface CollectResult {
  files: Record<string, string | Uint8Array>
  errors: string[]
}

const EMITTER_TIMEOUT_MS = 2000

function loadEmitter(packageDir: string, relPath: string): EmitterFn {
  const resolved = normalize(join(packageDir, relPath))
  const rel = relative(packageDir, resolved)
  if (rel === '' || rel.startsWith('..') || rel.includes('..')) {
    throw new Error(`emitter path escapes package: ${relPath}`)
  }
  const source = readFileSync(resolved, 'utf-8')
  const sandbox: Record<string, unknown> = {
    module: { exports: null as unknown },
    exports: null as unknown,
    JSON,
    Uint8Array,
    Array,
    Object,
    String,
    Number,
    Boolean,
    console: { log: (...parts: unknown[]) => console.log('[vpp-emitter]', ...parts) },
  }
  const ctx = createContext(sandbox)
  const script = new Script(source, { filename: resolved })
  script.runInContext(ctx, { timeout: EMITTER_TIMEOUT_MS })
  const moduleExport = (sandbox.module as { exports: unknown }).exports
  if (typeof moduleExport !== 'function') {
    throw new Error('emitter must assign a function to module.exports')
  }
  return moduleExport as EmitterFn
}

export function collectVppScreenRuntimeArtifacts(args: CollectArgs): CollectResult {
  const files: Record<string, string | Uint8Array> = {}
  const errors: string[] = []
  const packageIds = Object.keys(args.vppExtensions ?? {})
  if (packageIds.length === 0) return { files, errors }

  const pkgManager = new PackageManagerModule()
  const installed = pkgManager.listInstalled()

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
    const device = manifest.devices.find((d) => (d as { name?: string }).name === args.deviceId || d.id === args.deviceId)
    if (!device) continue
    const emitters =
      typeof device === 'object' && device !== null && 'runtimeEmitters' in device
        ? (device as { runtimeEmitters?: Record<string, string> }).runtimeEmitters
        : undefined
    if (!emitters) continue

    const perPackage = args.vppExtensions[packageId] ?? {}

    for (const [screenId, emitterRel] of Object.entries(emitters)) {
      if (!(screenId in perPackage)) continue
      let emit: EmitterFn
      try {
        emit = loadEmitter(pkg.path, emitterRel)
      } catch (e) {
        errors.push(`VPP ${packageId}:${screenId} emitter failed to load: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      let result: EmitterOutput
      try {
        result = emit({
          data: perPackage[screenId],
          model: {
            exportableVariables: args.exportableVariables,
            resolveAddress: args.resolveAddress,
          },
          packageId,
          screenId,
        })
      } catch (e) {
        errors.push(`VPP ${packageId}:${screenId} emitter threw: ${e instanceof Error ? e.message : String(e)}`)
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

  return { files, errors }
}
