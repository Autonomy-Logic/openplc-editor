import { app } from 'electron'
import extract from 'extract-zip'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

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
    try {
      const tempDir = join(this.packagesDir, '_temp_import')
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true })
      }

      await extract(vppFilePath, { dir: tempDir })

      const manifestPath = join(tempDir, 'manifest.json')
      if (!existsSync(manifestPath)) {
        rmSync(tempDir, { recursive: true })
        return { success: false, error: 'Package does not contain a manifest.json file' }
      }

      let manifest: PackageManifest
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageManifest
      } catch {
        rmSync(tempDir, { recursive: true })
        return { success: false, error: 'Invalid manifest.json format' }
      }

      if (!manifest.package?.id || !manifest.devices?.length) {
        rmSync(tempDir, { recursive: true })
        return { success: false, error: 'Manifest is missing required package.id or devices' }
      }

      const packageId = manifest.package.id
      const targetDir = join(this.packagesDir, packageId)

      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true })
      }

      renameSync(tempDir, targetDir)

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
      const registry = this.readRegistry()
      const pkg = registry.packages[packageId]
      if (!pkg) {
        return { success: false, error: `Package ${packageId} is not installed` }
      }

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
    const registry = this.readRegistry()
    const pkg = registry.packages[packageId]
    if (!pkg) return null

    const manifestPath = join(pkg.path, 'manifest.json')
    if (!existsSync(manifestPath)) return null

    try {
      return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageManifest
    } catch {
      return null
    }
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
