import { app } from 'electron'
import extract from 'extract-zip'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { PackageManifestSchema } from '../../../middleware/shared/ports/package-manifest-schema'
import { validatePathId } from '../../shared/utils/path-safety'
import { assertPathContained } from '../utils/path-containment'
import type { ImportResult, InstalledPackage, PackageManifest, PackageRegistry } from './types'

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
    const parsed = PackageManifestSchema.safeParse(raw)
    return parsed.success ? (parsed.data as unknown as PackageManifest) : null
  }

  getPackagePath(packageId: string): string | null {
    const registry = this.readRegistry()
    const pkg = registry.packages[packageId]
    return pkg?.path ?? null
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

export { PackageManagerModule }
