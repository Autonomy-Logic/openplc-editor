import * as Popover from '@radix-ui/react-popover'
import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { useOpenPLCStore } from '@root/frontend/store'
import type { InstalledPackage, PackageManifest } from '@root/middleware/shared/ports/types'
import { usePackages } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useState } from 'react'

const PackageManagerEditor = () => {
  const packages = usePackages()
  const [installedPackages, setInstalledPackages] = useState<InstalledPackage[]>([])
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null)
  const [selectedManifest, setSelectedManifest] = useState<PackageManifest | null>(null)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)

  const refreshPackages = useCallback(async () => {
    if (!packages) return
    const result = await packages.listInstalled()
    setInstalledPackages(result)
  }, [packages])

  useEffect(() => {
    void refreshPackages()
  }, [refreshPackages])

  useEffect(() => {
    if (!selectedPackageId || !packages) {
      setSelectedManifest(null)
      return
    }
    const fetchManifest = async () => {
      const manifest = await packages.getManifest(selectedPackageId)
      setSelectedManifest(manifest)
    }
    void fetchManifest()
  }, [selectedPackageId, packages])

  const handleImportFromFile = async () => {
    if (!packages) return
    setIsPopoverOpen(false)
    const result = await packages.importFromFile()
    if (result.success) {
      await refreshPackages()
      if (result.packageId) {
        setSelectedPackageId(result.packageId)
      }
    }
  }

  const handleImportFromInternet = () => {
    setIsPopoverOpen(false)
    openModal('debugger-message', {
      type: 'info',
      title: 'Coming Soon',
      message: 'Online package browsing will be available in a future update.',
      buttons: ['OK'],
      onResponse: () => {},
    })
  }

  const handleUninstall = async () => {
    if (!selectedPackageId || !packages) return
    const result = await packages.uninstall(selectedPackageId)
    if (result.success) {
      setSelectedPackageId(null)
      await refreshPackages()
    }
  }

  if (!packages) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
        Package management is not available on this platform.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 overflow-y-auto'>
      {/* Left panel: Installed packages list */}
      <div className='flex w-1/2 min-w-[325px] flex-col gap-4 overflow-y-auto p-4'>
        <div className='flex items-center justify-between'>
          <h2 className='select-none text-lg font-medium text-neutral-950 dark:text-white'>Installed Packages</h2>
          <div className='flex gap-1'>
            <Popover.Root open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <Popover.Trigger asChild>
                <button
                  type='button'
                  aria-label='Add package'
                  className='rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                >
                  <PlusIcon className='!stroke-brand' />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  sideOffset={5}
                  align='end'
                  className='flex w-[200px] flex-col gap-1 rounded-lg border border-neutral-100 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-950'
                >
                  <button
                    type='button'
                    onClick={() => void handleImportFromFile()}
                    className='flex w-full items-center rounded-md px-3 py-2 text-left font-caption text-cp-sm font-medium text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-850'
                  >
                    Add from file...
                  </button>
                  <button
                    type='button'
                    onClick={handleImportFromInternet}
                    className='flex w-full items-center rounded-md px-3 py-2 text-left font-caption text-cp-sm font-medium text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-850'
                  >
                    Add from the internet...
                  </button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            <button
              type='button'
              aria-label='Remove package'
              onClick={() => void handleUninstall()}
              disabled={!selectedPackageId}
              className='rounded-md p-1 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-900'
            >
              <MinusIcon className='!stroke-brand' />
            </button>
          </div>
        </div>

        <div className='flex flex-col overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700'>
          {installedPackages.length === 0 ? (
            <div className='flex items-center justify-center p-8 text-sm text-neutral-500 dark:text-neutral-400'>
              No packages installed. Click + to add a package.
            </div>
          ) : (
            installedPackages.map((pkg) => (
              <button
                key={pkg.packageId}
                type='button'
                onClick={() => setSelectedPackageId(pkg.packageId)}
                className={`flex w-full items-center justify-between border-b border-neutral-100 px-3 py-2 text-left last:border-b-0 dark:border-neutral-800 ${
                  selectedPackageId === pkg.packageId
                    ? 'bg-brand/10 dark:bg-brand/20'
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
                }`}
              >
                <div className='flex flex-col gap-0.5'>
                  <span className='font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>
                    {pkg.packageId}
                  </span>
                  <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                    v{pkg.version} &middot; {pkg.devices.length} device{pkg.devices.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className='h-full w-[1px] bg-brand-light' />

      {/* Right panel: Package details */}
      <div className='flex w-1/2 min-w-[325px] flex-col gap-4 overflow-y-auto p-4'>
        {selectedManifest ? (
          <>
            <h2 className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
              {selectedManifest.package.name}
            </h2>
            <div className='flex flex-col gap-3'>
              <DetailRow label='Version' value={selectedManifest.package.version} />
              <DetailRow label='Vendor' value={selectedManifest.package.vendor.name} />
              {selectedManifest.package.vendor.url && (
                <DetailRow label='Website' value={selectedManifest.package.vendor.url} />
              )}
              <DetailRow label='Description' value={selectedManifest.package.description} />
              {selectedManifest.package.license && (
                <DetailRow label='License' value={selectedManifest.package.license} />
              )}
              <DetailRow label='Package ID' value={selectedManifest.package.id} />
              <div className='flex flex-col gap-1'>
                <span className='text-xs font-medium text-neutral-500 dark:text-neutral-400'>Devices</span>
                <div className='flex flex-col gap-1'>
                  {selectedManifest.devices.map((device) => (
                    <div
                      key={device.id}
                      className='rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-700'
                    >
                      <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                        {device.name}
                      </span>
                      {device.category && (
                        <span className='ml-2 text-[11px] text-neutral-400 dark:text-neutral-500'>
                          ({device.category})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
            Select a package to view details
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-xs font-medium text-neutral-500 dark:text-neutral-400'>{label}</span>
      <span className='font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'>{value}</span>
    </div>
  )
}

export { PackageManagerEditor }
