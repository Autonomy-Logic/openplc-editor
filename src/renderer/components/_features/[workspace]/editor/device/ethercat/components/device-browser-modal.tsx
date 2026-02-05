import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/renderer/components/_molecules/modal'
import type { ESIDevice, ESIDeviceRef, ESIRepositoryItem } from '@root/types/ethercat/esi-types'
import { cn } from '@root/utils'
import { useCallback, useMemo, useState } from 'react'

type DeviceBrowserModalProps = {
  isOpen: boolean
  onClose: () => void
  onSelectDevice: (ref: ESIDeviceRef, device: ESIDevice, repoItem: ESIRepositoryItem) => void
  repository: ESIRepositoryItem[]
}

/**
 * Device Browser Modal Component
 *
 * Modal for browsing and selecting devices from the ESI repository.
 * Groups devices by vendor for easier navigation.
 */
const DeviceBrowserModal = ({ isOpen, onClose, onSelectDevice, repository }: DeviceBrowserModalProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedRef, setSelectedRef] = useState<ESIDeviceRef | null>(null)
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())

  // Group devices by vendor
  const groupedDevices = useMemo(() => {
    const groups: Map<
      string,
      {
        vendorId: string
        vendorName: string
        devices: Array<{
          repoItem: ESIRepositoryItem
          device: ESIDevice
          deviceIndex: number
        }>
      }
    > = new Map()

    for (const repoItem of repository) {
      const vendorKey = repoItem.vendor.id
      if (!groups.has(vendorKey)) {
        groups.set(vendorKey, {
          vendorId: repoItem.vendor.id,
          vendorName: repoItem.vendor.name,
          devices: [],
        })
      }

      for (let i = 0; i < repoItem.devices.length; i++) {
        const device = repoItem.devices[i]
        // Apply search filter
        if (searchTerm) {
          const search = searchTerm.toLowerCase()
          const matches =
            device.name.toLowerCase().includes(search) ||
            device.type.productCode.toLowerCase().includes(search) ||
            repoItem.vendor.name.toLowerCase().includes(search)
          if (!matches) continue
        }

        groups.get(vendorKey)!.devices.push({
          repoItem,
          device,
          deviceIndex: i,
        })
      }
    }

    // Remove empty groups
    for (const [key, group] of groups) {
      if (group.devices.length === 0) {
        groups.delete(key)
      }
    }

    return Array.from(groups.values())
  }, [repository, searchTerm])

  const handleToggleVendor = useCallback((vendorId: string) => {
    setExpandedVendors((prev) => {
      const next = new Set(prev)
      if (next.has(vendorId)) {
        next.delete(vendorId)
      } else {
        next.add(vendorId)
      }
      return next
    })
  }, [])

  const handleSelectDevice = useCallback((repoItemId: string, deviceIndex: number) => {
    setSelectedRef({ repositoryItemId: repoItemId, deviceIndex })
  }, [])

  const handleConfirm = useCallback(() => {
    if (!selectedRef) return

    const repoItem = repository.find((r) => r.id === selectedRef.repositoryItemId)
    if (!repoItem) return

    const device = repoItem.devices[selectedRef.deviceIndex]
    if (!device) return

    onSelectDevice(selectedRef, device, repoItem)
    setSelectedRef(null)
    setSearchTerm('')
    onClose()
  }, [selectedRef, repository, onSelectDevice, onClose])

  const handleClose = useCallback(() => {
    setSelectedRef(null)
    setSearchTerm('')
    onClose()
  }, [onClose])

  // Auto-expand all vendors when searching
  const effectiveExpandedVendors = useMemo(() => {
    if (searchTerm) {
      return new Set(groupedDevices.map((g) => g.vendorId))
    }
    return expandedVendors
  }, [searchTerm, groupedDevices, expandedVendors])

  const totalDevices = groupedDevices.reduce((sum, g) => sum + g.devices.length, 0)

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <ModalContent className='h-[600px] w-[600px]' onClose={handleClose}>
        <ModalHeader>
          <ModalTitle>Add Device from Repository</ModalTitle>
        </ModalHeader>

        {/* Search */}
        <div className='mb-2'>
          <input
            type='text'
            placeholder='Search devices by name, product code, or vendor...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-[34px] w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
          />
        </div>

        {/* Device count */}
        <div className='mb-2 text-xs text-neutral-500 dark:text-neutral-400'>
          {totalDevices} device(s) in {groupedDevices.length} vendor(s)
        </div>

        {/* Device list */}
        <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
          {groupedDevices.length === 0 ? (
            <div className='flex h-full items-center justify-center p-4'>
              <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                {repository.length === 0
                  ? 'No ESI files loaded. Upload files in the Repository tab first.'
                  : 'No devices match your search.'}
              </p>
            </div>
          ) : (
            <div className='divide-y divide-neutral-200 dark:divide-neutral-800'>
              {groupedDevices.map((group) => (
                <div key={group.vendorId}>
                  {/* Vendor header */}
                  <button
                    onClick={() => handleToggleVendor(group.vendorId)}
                    className='flex w-full items-center gap-2 bg-neutral-100 px-3 py-2 text-left hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800'
                  >
                    <svg
                      className={cn(
                        'h-3 w-3 text-neutral-500 transition-transform',
                        effectiveExpandedVendors.has(group.vendorId) && 'rotate-90',
                      )}
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                    >
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
                    </svg>
                    <span className='text-sm font-medium text-neutral-700 dark:text-neutral-300'>
                      {group.vendorName}
                    </span>
                    <span className='font-mono text-xs text-neutral-500'>({group.vendorId})</span>
                    <span className='ml-auto text-xs text-neutral-500'>{group.devices.length} device(s)</span>
                  </button>

                  {/* Devices */}
                  {effectiveExpandedVendors.has(group.vendorId) && (
                    <div className='divide-y divide-neutral-100 dark:divide-neutral-900'>
                      {group.devices.map(({ repoItem, device, deviceIndex }) => {
                        const isSelected =
                          selectedRef?.repositoryItemId === repoItem.id && selectedRef?.deviceIndex === deviceIndex
                        return (
                          <div
                            key={`${repoItem.id}-${deviceIndex}`}
                            onClick={() => handleSelectDevice(repoItem.id, deviceIndex)}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 px-3 py-2 pl-8 hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                              isSelected && 'bg-brand/10 dark:bg-brand/20',
                            )}
                          >
                            <svg
                              className='h-4 w-4 flex-shrink-0 text-brand'
                              fill='none'
                              viewBox='0 0 24 24'
                              stroke='currentColor'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z'
                              />
                            </svg>
                            <div className='min-w-0 flex-1'>
                              <div className='flex items-center gap-2'>
                                <span className='truncate text-sm font-medium text-neutral-900 dark:text-neutral-100'>
                                  {device.name}
                                </span>
                                {device.groupName && (
                                  <span className='flex-shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'>
                                    {device.groupName}
                                  </span>
                                )}
                              </div>
                              <div className='flex gap-3 text-xs text-neutral-500 dark:text-neutral-400'>
                                <span className='font-mono'>{device.type.productCode}</span>
                                <span>Rev: {device.type.revisionNo}</span>
                                <span className='truncate'>from {repoItem.filename}</span>
                              </div>
                            </div>
                            {isSelected && (
                              <svg
                                className='h-4 w-4 flex-shrink-0 text-brand'
                                fill='none'
                                viewBox='0 0 24 24'
                                stroke='currentColor'
                              >
                                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                              </svg>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <ModalFooter className='flex justify-end gap-2 pt-3'>
          <button
            onClick={handleClose}
            className='rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedRef}
            className='rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
          >
            Add Device
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export { DeviceBrowserModal }
