import type { PackagePort } from '../../../shared/ports/package-port'
import type { ImportResult, InstalledPackage, PackageManifest } from '../../../shared/ports/types'
import { createEditorPackageAdapter } from '../package-adapter'

const validManifest: PackageManifest = {
  formatVersion: '1.0',
  package: {
    id: 'acme-controller',
    name: 'Acme Controller',
    version: '1.0.0',
    vendor: { name: 'Acme', logo: 'logo.png' },
    description: 'Acme PLC',
  },
  devices: [
    {
      id: 'acme-100',
      name: 'Acme 100',
      preview: 'acme-100.png',
      target: { type: 'runtime-v4' },
      hal: { type: 'native-plugin' },
    },
  ],
}

const importOk: ImportResult = {
  success: true,
  packageId: 'acme-controller',
  packageName: 'Acme Controller',
  devices: ['Acme 100'],
}

const installedPackages: InstalledPackage[] = [
  {
    packageId: 'acme-controller',
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00Z',
    path: '/u/data/packages/acme-controller',
    devices: ['acme-100'],
  },
]

let adapter: PackagePort

beforeEach(() => {
  window.bridge = {
    importPackageFromFile: jest.fn().mockResolvedValue(importOk),
    listInstalledPackages: jest.fn().mockResolvedValue(installedPackages),
    uninstallPackage: jest.fn().mockResolvedValue({ success: true }),
    getPackageManifest: jest.fn().mockResolvedValue(validManifest),
    onOpenPackageManager: jest.fn().mockImplementation(() => jest.fn()),
    onBoardsUpdated: jest.fn().mockImplementation(() => jest.fn()),
  } as unknown as typeof window.bridge

  adapter = createEditorPackageAdapter()
})

describe('createEditorPackageAdapter', () => {
  describe('importFromFile', () => {
    it('delegates to window.bridge.importPackageFromFile and returns the wire result', async () => {
      const result = await adapter.importFromFile()
      expect(window.bridge.importPackageFromFile).toHaveBeenCalledTimes(1)
      expect(result).toEqual(importOk)
    })

    it('forwards failure results unchanged', async () => {
      ;(window.bridge.importPackageFromFile as jest.Mock).mockResolvedValue({ success: false, error: 'boom' })
      const result = await adapter.importFromFile()
      expect(result).toEqual({ success: false, error: 'boom' })
    })
  })

  describe('listInstalled', () => {
    it('delegates and returns the list verbatim', async () => {
      const result = await adapter.listInstalled()
      expect(window.bridge.listInstalledPackages).toHaveBeenCalledTimes(1)
      expect(result).toEqual(installedPackages)
    })

    it('returns an empty array when nothing is installed', async () => {
      ;(window.bridge.listInstalledPackages as jest.Mock).mockResolvedValue([])
      expect(await adapter.listInstalled()).toEqual([])
    })
  })

  describe('uninstall', () => {
    it('passes the packageId and unwraps a successful response', async () => {
      const result = await adapter.uninstall('acme-controller')
      expect(window.bridge.uninstallPackage).toHaveBeenCalledWith('acme-controller')
      expect(result.success).toBe(true)
    })

    it('surfaces the bridge error on failure', async () => {
      ;(window.bridge.uninstallPackage as jest.Mock).mockResolvedValue({ success: false, error: 'not installed' })
      const result = await adapter.uninstall('acme-controller')
      expect(result).toEqual({ success: false, error: 'not installed' })
    })

    it('falls back to a generic message when the bridge omits the error string', async () => {
      ;(window.bridge.uninstallPackage as jest.Mock).mockResolvedValue({ success: false })
      const result = await adapter.uninstall('acme-controller')
      expect(result).toEqual({ success: false, error: 'Uninstall failed' })
    })
  })

  describe('getManifest', () => {
    it('returns the parsed manifest when the bridge returns a valid one', async () => {
      const result = await adapter.getManifest('acme-controller')
      expect(window.bridge.getPackageManifest).toHaveBeenCalledWith('acme-controller')
      expect(result?.package.id).toBe('acme-controller')
    })

    it('returns null when the bridge returns null', async () => {
      ;(window.bridge.getPackageManifest as jest.Mock).mockResolvedValue(null)
      expect(await adapter.getManifest('missing')).toBeNull()
    })

    it('returns null when the bridge returns undefined', async () => {
      ;(window.bridge.getPackageManifest as jest.Mock).mockResolvedValue(undefined)
      expect(await adapter.getManifest('missing')).toBeNull()
    })

    it('returns null when the bridge returns a malformed manifest (zod rejection)', async () => {
      // Suppress the validation warning the schema emits; we want to
      // assert the rejection, not the noise.
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      ;(window.bridge.getPackageManifest as jest.Mock).mockResolvedValue({ totally: 'wrong shape' })
      expect(await adapter.getManifest('bad')).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('event subscriptions', () => {
    it('forwards onOpenManager registration to the bridge and returns its unsubscribe', () => {
      const unsubscribe = jest.fn()
      ;(window.bridge.onOpenPackageManager as jest.Mock).mockImplementation(() => unsubscribe)
      const cb = jest.fn()
      const off = adapter.onOpenManager(cb)
      expect(window.bridge.onOpenPackageManager).toHaveBeenCalledWith(cb)
      expect(off).toBe(unsubscribe)
    })

    it('forwards onBoardsUpdated registration similarly', () => {
      const unsubscribe = jest.fn()
      ;(window.bridge.onBoardsUpdated as jest.Mock).mockImplementation(() => unsubscribe)
      const cb = jest.fn()
      const off = adapter.onBoardsUpdated(cb)
      expect(window.bridge.onBoardsUpdated).toHaveBeenCalledWith(cb)
      expect(off).toBe(unsubscribe)
    })
  })
})
