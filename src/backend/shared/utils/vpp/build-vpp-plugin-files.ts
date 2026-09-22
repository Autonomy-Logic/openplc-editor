/**
 * Build the VPP files that ride in a runtime-v4 upload bundle.
 *
 * ONE implementation for both IDEs. The desktop used to compose these files
 * inline while writing them to disk, and openplc-web had to reproduce the same
 * bytes from an archive in memory — two writers for one format, with the
 * runtime as the only thing that would notice a drift. The content decisions
 * live here now; each platform supplies bytes in and writes bytes out.
 *
 * What it produces, unchanged from the desktop's original writer:
 *
 *   conf/<pluginName>.json   the generated vendor plugin config
 *   vpp_plugins.conf         the loader line the runtime reads
 *   vpp_plugin/**            the HAL tree, minus the editor-only files
 *   vpp_plugin/trusted_keys.c   only for a licensable package
 *   vpp_plugin/checksum.sha256  over everything in vpp_plugin/
 *   vpp_signature.json       the package's detached signature + pluginDir
 *
 * The hash is injected because Node hashes synchronously and WebCrypto does
 * not; nothing else about the output may differ between platforms.
 */

import type { PackageManifest, VppModuleDefinition } from '../../../../middleware/shared/ports/types'
import { generateVendorPluginConfig } from './generate-vendor-plugin-config'
import {
  describeVppPinDrift,
  type InstalledVppIdentity,
  type VppPackagePin,
} from './vpp-package-pin'

/** Files the editor turns into something else and the runtime must not receive. */
const EXCLUDED_PLUGIN_FILES = new Set(['config_template.json', 'requirements.txt'])

const CHECKSUM_FILENAME = 'checksum.sha256'
const TRUSTED_KEYS_FILENAME = 'trusted_keys.c'

export type VppDevice = PackageManifest['devices'][number]

export interface VppPluginModule extends VppModuleDefinition {
  /** Parsed per-module config screen, pre-loaded so the generator stays pure. */
  configScreenDefinition?: unknown
}

export interface BuildVppPluginFilesArgs {
  /** The device entry whose HAL is being packed. */
  device: VppDevice
  /** Every file of the VERIFIED package, POSIX paths relative to its root. */
  packageFiles: ReadonlyMap<string, Uint8Array>
  /** Parsed `signature.json` of the package, or null for an unsigned one. */
  packageSignature: unknown
  /** The project's vendor screen values. */
  vendorScreenData: Record<string, unknown>
  /** GPIO pin table for pin-mapping boards; empty for module-based ones. */
  devicePins?: Array<Record<string, unknown>>
  /** Module definitions with their config screens already parsed. */
  modules?: VppPluginModule[]
  /** Generated trusted-keys unit for a licensable package; null otherwise. */
  trustedKeysC?: string | null
  /** What the project was authored against, and what is actually being packed. */
  pin?: { recorded?: VppPackagePin; installed: InstalledVppIdentity | null }
  /** Lower-case hex sha256 of the given bytes. */
  sha256Hex: (bytes: Uint8Array) => string | Promise<string>
}

export interface BuildVppPluginFilesResult {
  /** Bundle-relative path -> bytes. Empty when the board packs nothing. */
  files: Record<string, Uint8Array>
  pluginName: string | null
  /** How the HAL is provisioned, so the caller's log can name it. */
  provisioning: 'source' | 'prebuilt' | null
  /** Plugin-tree paths relative to `vpp_plugin/`, in checksum order. */
  pluginFiles: string[]
  /** Non-fatal notes for the build log, in the order they occurred. */
  warnings: string[]
  /** Fatal problems; the caller aborts the upload on any. */
  errors: string[]
}

/**
 * A plugin name becomes a filename under `conf/`, so it is constrained to the
 * same shape the desktop's `validatePathId` enforces before any path is built
 * from it. Without this a `plugin_name` of `../../../etc/cron.d/runme` would
 * place package-controlled JSON outside the bundle.
 */
const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export async function buildVppPluginFiles(args: BuildVppPluginFilesArgs): Promise<BuildVppPluginFilesResult> {
  const { device, packageFiles, vendorScreenData, sha256Hex } = args
  const warnings: string[] = []
  const errors: string[] = []
  const files: Record<string, Uint8Array> = {}
  const empty = (pluginName: string | null = null): BuildVppPluginFilesResult => ({
    files,
    pluginName,
    provisioning: null,
    pluginFiles: [],
    warnings,
    errors,
  })

  // Said here rather than only at authoring: a package can move between the
  // last time the board screen was open and the upload, and this is the last
  // point before the driver is built on the device.
  if (args.pin) {
    const drift = describeVppPinDrift(args.pin.recorded, args.pin.installed)
    if (drift) warnings.push(drift)
  }

  if (device.target?.type !== 'runtime-v4') {
    warnings.push(`VPP board is not runtime-v4 (target=${device.target?.type ?? 'unknown'}), skipping VPP packaging`)
    return empty()
  }

  let pluginName: string | null = null

  // --- conf/<pluginName>.json and vpp_plugins.conf ---
  const configTemplatePath = device.hal?.configTemplate
  if (!configTemplatePath) {
    warnings.push('VPP board has no HAL configTemplate, skipping plugin config generation')
  } else {
    const templateBytes = packageFiles.get(configTemplatePath)
    if (!templateBytes) {
      errors.push(`VPP config template not found in package: ${configTemplatePath}`)
      return empty()
    }
    let configTemplate: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(decodeUtf8(templateBytes))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config template is not an object')
      }
      configTemplate = parsed as Record<string, unknown>
    } catch (error) {
      errors.push(`Failed to read VPP config template at ${configTemplatePath}: ${describe(error)}`)
      return empty()
    }

    const rawPluginName = typeof configTemplate.plugin_name === 'string' ? configTemplate.plugin_name : 'vendor_plugin'
    if (!PLUGIN_NAME_PATTERN.test(rawPluginName)) {
      errors.push(`Invalid configTemplate.plugin_name: ${rawPluginName}`)
      return empty()
    }
    pluginName = rawPluginName

    const finalConfig = generateVendorPluginConfig(
      configTemplate,
      vendorScreenData as Parameters<typeof generateVendorPluginConfig>[1],
      (args.modules ?? []) as Parameters<typeof generateVendorPluginConfig>[2],
      (args.devicePins ?? []) as Parameters<typeof generateVendorPluginConfig>[3],
    )

    files[`conf/${pluginName}.json`] = encodeUtf8(JSON.stringify(finalConfig, null, 2))
    // name,path,enabled,type,config_path,venv_path — the deterministic
    // locations compile.sh and apply_vpp_plugin_conf() agree on.
    files['vpp_plugins.conf'] = encodeUtf8(
      `${pluginName},./build/vpp/lib${pluginName}_plugin.so,1,1,./build/vpp/${pluginName}.json,\n`,
    )
  }

  // --- vpp_plugin/** ---
  const pluginEntry = device.hal?.pluginEntry
  if (!pluginEntry) {
    warnings.push('VPP board has no HAL pluginEntry, skipping plugin source upload')
    return empty(pluginName)
  }

  // "source" (default): pluginEntry is the entry file, so the tree is its
  // parent. "prebuilt": pluginEntry IS the directory of precompiled objects.
  const isPrebuilt = device.hal?.provisioning === 'prebuilt'
  const pluginDir = isPrebuilt ? stripTrailingSlash(pluginEntry) : posixDirname(pluginEntry)
  if (pluginDir === '' || pluginDir === '.') {
    errors.push(`Invalid VPP pluginEntry: ${pluginEntry}`)
    return empty(pluginName)
  }

  const prefix = `${pluginDir}/`
  const copied: Array<{ rel: string; bytes: Uint8Array }> = []
  for (const [name, bytes] of packageFiles) {
    if (!name.startsWith(prefix)) continue
    const rel = name.slice(prefix.length)
    if (EXCLUDED_PLUGIN_FILES.has(basename(rel))) continue
    copied.push({ rel, bytes })
  }

  if (copied.length === 0) {
    warnings.push('VPP plugin source directory contained no files to copy')
    return empty(pluginName)
  }

  // The generated trusted-keys unit joins the link set AND the checksum: a key
  // rotation with unchanged plugin source must still change the checksum, or
  // compile.sh would skip the rebuild and the device would keep validating
  // blobs against the previous table.
  if (args.trustedKeysC != null) {
    copied.push({ rel: TRUSTED_KEYS_FILENAME, bytes: encodeUtf8(args.trustedKeysC) })
  }

  copied.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  // "<sha256>  <relative-path>\n" per file, then a sha256 over that listing.
  let listing = ''
  for (const entry of copied) {
    listing += `${await sha256Hex(entry.bytes)}  ${entry.rel}\n`
    files[`vpp_plugin/${entry.rel}`] = entry.bytes
  }
  const combinedHash = await sha256Hex(encodeUtf8(listing))
  files[`vpp_plugin/${CHECKSUM_FILENAME}`] = encodeUtf8(`${combinedHash}\n`)

  // --- vpp_signature.json ---
  // `vpp_plugin/` is the only upload content the runtime builds with a
  // Makefile that came from the upload itself, so it requires a trusted
  // signature. It cannot re-derive one: the tree it receives is a SUBSET of
  // the package (editor-only files dropped, checksum and trusted_keys.c
  // generated), so only the original detached signature can attest to it.
  // `pluginDir` tells it which signed subtree to compare against.
  if (args.packageSignature == null) {
    warnings.push(
      'VPP package has no usable signature.json; a runtime that requires signed plugins will refuse this upload',
    )
  } else {
    files['vpp_signature.json'] = encodeUtf8(
      `${JSON.stringify({ package: args.packageSignature, pluginDir }, null, 2)}\n`,
    )
  }

  return {
    files,
    pluginName,
    provisioning: isPrebuilt ? 'prebuilt' : 'source',
    pluginFiles: copied.map((entry) => entry.rel),
    warnings,
    errors,
  }
}

function posixDirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

function stripTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
