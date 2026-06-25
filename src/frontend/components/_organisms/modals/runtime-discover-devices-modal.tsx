import { useCallback, useEffect, useRef, useState } from 'react'

import type { DiscoveredRuntimeDevice } from '../../../../middleware/shared/ports'
import { useRuntime } from '../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const RuntimeDiscoverDevicesModal = () => {
  const { modals, modalActions, deviceActions } = useOpenPLCStore()
  const runtime = useRuntime()

  const isOpen = modals['runtime-discover-devices']?.open || false

  const [phase, setPhase] = useState<'scanning' | 'done'>('scanning')
  const [devices, setDevices] = useState<DiscoveredRuntimeDevice[]>([])
  const [selectedIp, setSelectedIp] = useState<string | null>(null)
  const [error, setError] = useState<string>('')
  // Latest-scan token so live "discovered" callbacks from a stale scan
  // can be ignored without races.
  const scanIdRef = useRef(0)

  const runScan = useCallback(async () => {
    setError('')
    setDevices([])
    setSelectedIp(null)
    setPhase('scanning')

    const myScanId = ++scanIdRef.current
    if (!runtime.discoverDevices) {
      setError('Device discovery is not supported by this platform.')
      setPhase('done')
      return
    }

    const result = await runtime.discoverDevices({ durationMs: 3000 })
    if (myScanId !== scanIdRef.current) return

    if (!result.success) {
      setError(result.error || 'Discovery failed')
      setPhase('done')
      return
    }

    // The live subscription has been appending devices throughout the
    // scan; this final merge guarantees we end up with the authoritative
    // list even if some "discovered" events were missed.
    setDevices((prev) => {
      const merged = new Map(prev.map((d) => [d.ipAddress, d]))
      for (const d of result.devices ?? []) {
        merged.set(d.ipAddress, d)
      }
      return Array.from(merged.values())
    })
    setPhase('done')
  }, [runtime])

  useEffect(() => {
    if (!isOpen) return

    if (!runtime.onDeviceDiscovered) {
      void runScan()
      return
    }

    // Subscribe BEFORE kicking off the scan so the first replies aren't
    // dropped on the floor.
    const unsubscribe = runtime.onDeviceDiscovered((device) => {
      setDevices((prev) => {
        if (prev.some((d) => d.ipAddress === device.ipAddress)) {
          return prev.map((d) => (d.ipAddress === device.ipAddress ? device : d))
        }
        return [...prev, device]
      })
    })

    void runScan()
    return () => {
      unsubscribe()
    }
    // runScan is stable per-runtime; we want this to re-run only on
    // open/close of the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, runtime])

  const handleClose = () => {
    scanIdRef.current++ // invalidate any in-flight scan callbacks
    setDevices([])
    setSelectedIp(null)
    setError('')
    setPhase('scanning')
    modalActions.closeModal()
  }

  const handleOk = () => {
    if (!selectedIp) return
    deviceActions.setRuntimeIpAddress(selectedIp)
    handleClose()
  }

  const headline =
    phase === 'scanning'
      ? 'Searching devices...'
      : devices.length === 0
        ? 'No devices found'
        : `Found ${devices.length} device${devices.length === 1 ? '' : 's'}`

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
        modalActions.onOpenChange('runtime-discover-devices', open)
      }}
    >
      <ModalContent className='flex h-[480px] w-[480px] select-none flex-col rounded-lg p-6'>
        <ModalTitle className='mb-2 text-xl font-semibold'>Search for Devices</ModalTitle>

        <p className='mb-4 text-sm text-neutral-600 dark:text-neutral-400'>
          Broadcasting on the local network to find OpenPLC runtime devices.
        </p>

        <div className='mb-3 flex items-center justify-between'>
          <span className='text-sm font-medium text-neutral-850 dark:text-neutral-300'>
            {phase === 'scanning' && (
              <span className='mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-brand align-middle' />
            )}
            {headline}
          </span>
          <button
            type='button'
            onClick={() => void runScan()}
            disabled={phase === 'scanning'}
            className='rounded-md bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Rescan
          </button>
        </div>

        <div className='flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
          {devices.length === 0 ? (
            <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
              {phase === 'scanning' ? 'Waiting for responses...' : 'No devices replied.'}
            </div>
          ) : (
            <ul className='divide-y divide-neutral-200 dark:divide-neutral-800'>
              {devices.map((device) => {
                const isSelected = selectedIp === device.ipAddress
                return (
                  <li key={device.ipAddress}>
                    <button
                      type='button'
                      onClick={() => setSelectedIp(device.ipAddress)}
                      aria-selected={isSelected}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm',
                        isSelected
                          ? 'bg-brand/20 dark:bg-brand/30 font-bold shadow-[inset_3px_0_0_var(--primary-default)]'
                          : 'text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-850',
                      )}
                    >
                      <span
                        className={cn('text-neutral-950 dark:text-white', isSelected ? 'font-bold' : 'font-medium')}
                      >
                        {device.hostname || '(unknown host)'}
                      </span>
                      <span
                        className={cn(
                          'text-xs',
                          isSelected
                            ? 'font-bold text-neutral-950 dark:text-white'
                            : 'text-neutral-600 dark:text-neutral-400',
                        )}
                      >
                        {device.ipAddress}
                        {device.runtimeVersion ? ` · ${device.runtimeVersion}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && <p className='mt-3 text-sm text-red-600 dark:text-red-400'>{error}</p>}

        <div className='mt-4 flex gap-3'>
          <button
            type='button'
            onClick={handleOk}
            disabled={!selectedIp}
            className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
          >
            OK
          </button>
          <button
            type='button'
            onClick={handleClose}
            className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { RuntimeDiscoverDevicesModal }
