/**
 * Backend-specific types for VPP package management.
 *
 * These types are used only by the PackageManagerModule (main process).
 * Platform-agnostic types shared with the frontend live in
 * src/middleware/shared/ports/types.ts.
 */

type PackageManifest = {
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
    }
    specs?: Record<string, string>
    hal: {
      type: string
      pluginType?: string
      pluginEntry?: string
      configTemplate?: string
      requirements?: string
      source?: string
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
    moduleSystem?: {
      enabled: boolean
      maxSlots: number
      discoverySupported?: boolean
      discoveryCommand?: string
      modules: Array<{
        id: string
        name: string
        hwId?: string
        image?: string
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
      }>
    }
  }>
}

type InstalledPackage = {
  packageId: string
  version: string
  installedAt: string
  path: string
  devices: string[]
}

type PackageRegistry = {
  formatVersion: string
  packages: Record<string, Omit<InstalledPackage, 'packageId'>>
}

type ImportResult = {
  success: boolean
  canceled?: boolean
  packageId?: string
  packageName?: string
  devices?: string[]
  error?: string
}

export type { ImportResult, InstalledPackage, PackageManifest, PackageRegistry }
