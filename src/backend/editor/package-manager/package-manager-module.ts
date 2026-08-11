import { app } from 'electron'
import extract from 'extract-zip'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { APP_VERSION } from '../../../frontend/data/constants/app-version'
import { isCompatibleEditorVersion } from '../../../frontend/utils/semver'
import {
  PackageManifestSchema,
  parseInstalledPackageManifest,
} from '../../../middleware/shared/ports/package-manifest-schema'
import type { VppDeviceMatch } from '../../shared/hardware/find-vpp-device'
import { findVppDeviceByBoardName } from '../../shared/hardware/find-vpp-device'
import { validatePathId } from '../../shared/utils/path-safety'
import { TRUSTED_PACKAGE_KEYS } from '../../shared/utils/vpp/trusted-keys'
import { verifyPackageSignature } from '../../shared/utils/vpp/verify-package-signature'
import { logger } from '../services/logger-service'
import { assertPathContained } from '../utils/path-containment'
import type { ImportResult, InstalledPackage, PackageIntegrityResult, PackageManifest, PackageRegistry } from './types'

/**
 * Enforce cryptographic signature verification on every import. Strict by
 * design. Flip to `false` ONLY for local/offline development with unsigned
 * packages — the committed value MUST stay `true`, mirroring the
 * `USE_LOCAL_MOCK` convention in the package adapter.
 */
const REQUIRE_SIGNATURE = true

class PackageManagerModule {
  private packagesDir: string
  private registryPath: string

  constructor() {
    this.packagesDir = join(app.getPath('userData'), 'packages')
    this.registryPath = join(this.packagesDir, 'registry.json')
    mkdirSync(this.packagesDir, { recursive: true })
  }

  async importFromFile(vppFilePath: string): Promise<ImportResult> {
    // mkdtempSync gives us a guaranteed-unique scratch directory per call
    // so two concurrent imports don't race on the same `_temp_import`
    // path and rmSync each other's extracted contents mid-flight. The
    // `.import-` prefix keeps the dotfile out of normal listings; we
    // remove the directory unconditionally before returning.
    let tempDir: string | null = null
    try {
      tempDir = mkdtempSync(join(this.packagesDir, '.import-'))

      await extract(vppFilePath, { dir: tempDir })

      const manifestPath = join(tempDir, 'manifest.json')
      if (!existsSync(manifestPath)) {
        return { success: false, error: 'Package does not contain a manifest.json file' }
      }

      // Parse + schema-validate. Doing this BEFORE any field is used as
      // a path component or rendered in the UI catches malformed/hostile
      // manifests at the trust boundary; everything past this point can
      // treat the manifest as well-formed.
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      } catch {
        return { success: false, error: 'Invalid manifest.json format' }
      }

      const parsed = PackageManifestSchema.safeParse(raw)
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid manifest schema: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`,
        }
      }
      const manifest: PackageManifest = parsed.data as unknown as PackageManifest

      // Cryptographically verify the package BEFORE trusting any of its
      // contents. This is the single trust boundary both flows converge on
      // (local "Add from file…" and remote install both extract here), so
      // one check covers both. It runs after the manifest is structurally
      // valid but before any field is used as a path or any HAL/plugin code
      // is ever compiled. Fails closed.
      if (REQUIRE_SIGNATURE) {
        const verification = verifyPackageSignature(tempDir, TRUSTED_PACKAGE_KEYS)
        if (!verification.valid) {
          return { success: false, error: `Package signature verification failed: ${verification.error}` }
        }
      }

      // Compatibility floor (DOPE-448). This is the ONLY place the editor
      // enforces `minEditorVersion`, and it sits here because both entry paths
      // — remote catalog install and the local "Add from file…" picker —
      // converge on this method. The catalog UI's "Editor outdated" button
      // state is a courtesy that stops the user earlier; it is not the gate,
      // and before this check existed a `.vpp` dragged in from disk bypassed
      // the constraint entirely.
      //
      // A package declares a floor when it needs an editor feature it cannot
      // work without — a UI engine, a new screen widget, a layout the renderer
      // learned in some release. Installing it on an older editor produces a
      // board that renders wrong rather than an error, so refuse up front.
      if (!isCompatibleEditorVersion(manifest.package.minEditorVersion, APP_VERSION)) {
        return {
          success: false,
          error:
            `Package "${manifest.package.name}" ${manifest.package.version} requires ` +
            `OpenPLC Editor ${manifest.package.minEditorVersion} or newer. This editor is ${APP_VERSION}. ` +
            `Update the editor, or install an older version of this package.`,
        }
      }

      // Validate package.id BEFORE using it as a path component. Without
      // this, a malicious .vpp with `"id": "../../something"` would have
      // `targetDir` resolve outside packagesDir and the rmSync below
      // could delete an arbitrary user directory.
      try {
        validatePathId(manifest.package.id, 'manifest.package.id')
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }

      const packageId = manifest.package.id
      const targetDir = join(this.packagesDir, packageId)

      // Defence in depth: even with the regex above, assert containment
      // post-resolve so any future relaxation of the regex can't reopen
      // the traversal vector silently.
      try {
        assertPathContained(this.packagesDir, targetDir, 'package install path')
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }

      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true })
      }

      renameSync(tempDir, targetDir)
      tempDir = null // ownership transferred; finally block must not delete

      const registry = this.readRegistry()
      registry.packages[packageId] = {
        version: manifest.package.version,
        installedAt: new Date().toISOString(),
        path: targetDir,
        devices: manifest.devices.map((d) => d.id),
      }
      this.writeRegistry(registry)

      return {
        success: true,
        packageId,
        packageName: manifest.package.name,
        devices: manifest.devices.map((d) => d.name),
      }
    } catch (err) {
      return { success: false, error: `Import failed: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
      // Cleanup any orphan temp directory left by an early return / throw.
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    }
  }

  /**
   * Re-verify every registry-listed package against the trusted keys and remove
   * any whose signature does not validate, returning the ids removed. For each
   * failing entry the package directory is deleted (when its recorded path
   * resolves inside packagesDir) and the registry entry is dropped, emitting a
   * warning per removal. No-op when REQUIRE_SIGNATURE is false. Directories with
   * no registry entry are not listed and are left as-is.
   */
  verifyInstalledSignatures(warn: (message: string) => void = (m) => logger.warn(m)): string[] {
    if (!REQUIRE_SIGNATURE) return []

    const registry = this.readRegistry()
    const removed: string[] = []
    let mutated = false

    for (const [packageId, info] of Object.entries(registry.packages)) {
      const reason = this.signatureRejectionReason(packageId, info?.path)
      if (!reason) continue

      // Drop the registry entry; delete on-disk contents only when the recorded
      // path resolves inside packagesDir.
      try {
        assertPathContained(this.packagesDir, info.path, 'registry package path')
        if (existsSync(info.path)) {
          rmSync(info.path, { recursive: true, force: true })
        }
      } catch {
        // Out-of-tree or unusable path: leave disk untouched, just de-list.
      }

      delete registry.packages[packageId]
      mutated = true
      removed.push(packageId)
      warn(`VPP package "${packageId}" was removed at startup due to an invalid or missing signature: ${reason}`)
    }

    if (mutated) this.writeRegistry(registry)
    return removed
  }

  /**
   * Re-verify the package that provides `boardName`, at the moment a build is
   * about to consume it (DOPE-539).
   *
   * The import check and the project-open sweep both happen strictly BEFORE
   * this point, and nothing between them and the compile stops the user from
   * editing the installed package: `getInstalledPackageManifest`, the HAL
   * source, the licence-store backend and the runtime-v4 plugin payload are
   * all read straight off `userData/packages/<id>/` when the build runs. So a
   * package that passed on open is not evidence about the package being
   * compiled — an edit lands in the firmware, or in C the runtime compiles on
   * a live PLC, and (because `capabilities.isLicensable` is a manifest field)
   * can switch the whole licensing flow off.
   *
   * This is the gate that actually protects a build, so it fails CLOSED and
   * the callers refuse to compile. It deliberately does NOT de-list or delete
   * the package the way the open-time sweep does: tearing a directory out from
   * under a build in flight is a worse failure than stopping the build and
   * saying why. The sweep still owns removal.
   *
   * A built-in hals.json board has no package behind it and is `ok` — the
   * common case, and the reason this costs nothing for most builds.
   */
  verifyBoardPackageIntegrity(boardName: string): PackageIntegrityResult {
    if (!REQUIRE_SIGNATURE) return { ok: true }

    const match = this.findDeviceByBoardName(boardName)
    if (!match) return { ok: true }

    const reason = this.signatureRejectionReason(match.pkg.packageId, match.pkg.path)
    if (!reason) return { ok: true }

    return { ok: false, packageId: match.pkg.packageId, reason }
  }

  /**
   * Returns null when the installed package recorded at `packagePath` is
   * genuinely signed by a trusted key, or a short human-readable reason when it
   * is not (bad id shape, path escaping packagesDir, missing files, or any
   * failure surfaced by `verifyPackageSignature`).
   */
  private signatureRejectionReason(packageId: string, packagePath: string | undefined): string | null {
    try {
      validatePathId(packageId, 'registry package id')
    } catch {
      return 'invalid package id'
    }
    if (typeof packagePath !== 'string' || packagePath.length === 0) {
      return 'registry entry has no package path'
    }
    try {
      assertPathContained(this.packagesDir, packagePath, 'registry package path')
    } catch {
      return 'package path resolves outside the packages directory'
    }
    if (!existsSync(packagePath)) {
      return 'package files are missing'
    }
    const verification = verifyPackageSignature(packagePath, TRUSTED_PACKAGE_KEYS)
    return verification.valid ? null : (verification.error ?? 'invalid signature')
  }

  listInstalled(): InstalledPackage[] {
    const registry = this.readRegistry()
    return Object.entries(registry.packages).map(([packageId, info]) => ({
      packageId,
      ...info,
    }))
  }

  uninstall(packageId: string): { success: boolean; error?: string } {
    try {
      // packageId reaches us through IPC from the renderer; validate it
      // shape-first so an invalid value can't be used to look up an
      // entry under a hostile registry key.
      validatePathId(packageId, 'packageId')

      const registry = this.readRegistry()
      const pkg = registry.packages[packageId]
      if (!pkg) {
        return { success: false, error: `Package ${packageId} is not installed` }
      }

      // The registry is editor-owned, but disk contents can drift
      // (manual edits, restored backups). Confirm the recorded path
      // still sits under packagesDir before any rmSync — a tampered
      // registry would otherwise be a delete-anywhere primitive.
      assertPathContained(this.packagesDir, pkg.path, 'registry package path')

      if (existsSync(pkg.path)) {
        rmSync(pkg.path, { recursive: true })
      }

      delete registry.packages[packageId]
      this.writeRegistry(registry)

      return { success: true }
    } catch (err) {
      return { success: false, error: `Uninstall failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  getInstalledPackageManifest(packageId: string): PackageManifest | null {
    try {
      validatePathId(packageId, 'packageId')
    } catch {
      return null
    }

    const registry = this.readRegistry()
    const pkg = registry.packages[packageId]
    if (!pkg) return null

    // Disk paths recorded in the registry must still sit under
    // packagesDir — same containment defence as in `uninstall`.
    try {
      assertPathContained(this.packagesDir, pkg.path, 'registry package path')
    } catch {
      return null
    }

    const manifestPath = join(pkg.path, 'manifest.json')
    if (!existsSync(manifestPath)) return null

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch {
      return null
    }
    // Read path, not the trust boundary: `importFromFile` above is where a
    // manifest is refused. Here the package is already installed, and a
    // manifest that was accepted by an older editor — one whose schema did
    // not yet check the floor format (DOPE-448) — must keep resolving, or the
    // boards it provides vanish from the board lookup with no message. An
    // unreadable floor is dropped and logged; everything else still rejects.
    return parseInstalledPackageManifest(raw)
  }

  getPackagePath(packageId: string): string | null {
    const registry = this.readRegistry()
    const pkg = registry.packages[packageId]
    return pkg?.path ?? null
  }

  /**
   * The installed VPP device named `boardName`, with its package and
   * manifest — or null when no installed package provides it.
   *
   * `boardTarget` travels through the compile pipeline as a device
   * *name*, so every consumer that needs the package behind a board
   * starts here. Delegates to the shared `findVppDeviceByBoardName` so
   * this and `board-info-resolver` (which cannot import this module)
   * resolve a board the same way.
   */
  findDeviceByBoardName(boardName: string): VppDeviceMatch | null {
    return findVppDeviceByBoardName(this, boardName)
  }

  /**
   * `package.minRuntimeVersion` of the installed package that provides
   * `boardName`, or null when no installed package does, when the
   * matching device is not a `runtime-v4` target, or when the package
   * declares no floor (DOPE-448).
   *
   * Only runtime-v4 devices can carry a meaningful floor: their HAL is
   * plugin code built against the runtime's API. An `arduino-cli`
   * device never talks to the runtime, so a floor there would be a
   * claim nothing can check — openplc-packages' `validate.ts` rejects
   * it at authoring time, and this returns null if one slips through.
   */
  getRuntimeFloorForBoard(boardName: string): string | null {
    const match = this.findDeviceByBoardName(boardName)
    if (!match || match.device.target.type !== 'runtime-v4') return null
    return match.manifest.package.minRuntimeVersion ?? null
  }

  private readRegistry(): PackageRegistry {
    if (!existsSync(this.registryPath)) {
      return { formatVersion: '1.0', packages: {} }
    }
    try {
      return JSON.parse(readFileSync(this.registryPath, 'utf-8')) as PackageRegistry
    } catch {
      return { formatVersion: '1.0', packages: {} }
    }
  }

  private writeRegistry(registry: PackageRegistry): void {
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8')
  }
}

/**
 * The one wording every build-time integrity refusal uses.
 *
 * Three call sites in the compiler abort on the same condition, and the user
 * reads exactly one of the three; they must not each explain it differently.
 * The message names the package (what to reinstall), the reason (what is
 * wrong) and the remedy, because "signature verification failed" on its own
 * reads as an editor bug rather than as "the file on your disk changed".
 */
function formatPackageIntegrityError(boardName: string, failure: { packageId: string; reason: string }): string {
  return (
    `Board "${boardName}" is provided by the VPP package "${failure.packageId}", which no longer matches ` +
    `its signature: ${failure.reason}. The package files appear to have been modified after installation, ` +
    'so they cannot be trusted for a build. Reinstall the package from a trusted .vpp file and try again.'
  )
}

export { formatPackageIntegrityError, PackageManagerModule }
