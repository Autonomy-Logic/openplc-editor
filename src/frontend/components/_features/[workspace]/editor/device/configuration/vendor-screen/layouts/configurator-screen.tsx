import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { applyConfiguratorSnapshot } from '@root/frontend/services/apply-configurator-snapshot'
import { markTabsUnsaved } from '@root/frontend/services/mark-tabs-unsaved'
import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { type ConfiguratorSessionStatus, startConfiguratorSession } from '@root/frontend/utils/vpp/configurator-session'
import { configuratorScreenNames, DEVICE_SETUP_KEY } from '@root/frontend/utils/vpp/persistence-keys'
import { readVendorDocumentSection } from '@root/frontend/utils/vpp/vendor-document-section'
import { useDevice } from '@root/middleware/shared/providers/platform-context'
import { createIframeConfiguratorClient } from '@root/middleware/shared/vendor-document/configurator-client'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ScreenSection } from '../index'
import { notifyDroppedAliases } from '../notify-dropped-aliases'

/** Never add `allow-same-origin`: with it the guest could reach the host. */
const IFRAME_SANDBOX = 'allow-scripts allow-forms'

function readStoredArchive(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('archive' in value)) return null
  return typeof value.archive === 'string' && value.archive.length > 0 ? value.archive : null
}

function readStoredModuleGuids(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('modules' in value) || !Array.isArray(value.modules)) return []
  return value.modules.flatMap((module: unknown) =>
    module && typeof module === 'object' && 'guid' in module && typeof module.guid === 'string' ? [module.guid] : [],
  )
}

function Notice({ children }: { children: string }) {
  return <p className='text-sm text-neutral-600 dark:text-neutral-400'>{children}</p>
}

type ConfiguratorScreenProps = {
  section: ScreenSection
}

function ConfiguratorScreen({ section }: ConfiguratorScreenProps) {
  const store = useOpenPLCStoreApi()
  const devicePort = useDevice()
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const packageId = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards.get(deviceBoard)?.vpp?.packageId)

  const config = useMemo(() => readVendorDocumentSection(section), [section])
  const documentPath = config?.documentPath ?? null
  const bundleVersion = config?.bundleVersion ?? null
  const configuratorKey = config?.configuratorKey ?? null
  const controller = config?.controllers[deviceBoard] ?? null
  const url = useMemo(
    () => (packageId && documentPath ? devicePort.getVendorDocumentUrl(packageId, documentPath) : null),
    [devicePort, packageId, documentPath],
  )
  const storedArchive = useOpenPLCStore((s) =>
    configuratorKey ? readStoredArchive(s.deviceDefinitions.configuration.vendorScreenData?.[configuratorKey]) : null,
  )
  // The archive the guest holds: loaded at boot or delivered by its snapshots.
  const guestArchive = useRef(storedArchive)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (storedArchive !== guestArchive.current) setGeneration((g) => g + 1)
  }, [storedArchive])
  // Keys the iframe: a new board, document or externally replaced archive mounts a fresh guest and session.
  const frameKey = `${deviceBoard}\n${url ?? ''}\n${generation}`

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<ConfiguratorSessionStatus>({ kind: 'booting' })

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !controller || !configuratorKey || !bundleVersion) return
    const { deviceDefinitions, deviceAvailableOptions } = store.getState()
    const { vendorScreenData, deviceBoard: board } = deviceDefinitions.configuration
    const tabNames = configuratorScreenNames(deviceAvailableOptions.availableBoards.get(board)?.vpp?.screens)
    let restoreSaved: (() => void) | null = null
    guestArchive.current = readStoredArchive(vendorScreenData?.[configuratorKey])
    const session = startConfiguratorSession({
      port: createIframeConfiguratorClient(iframe),
      controller,
      storedArchive: readStoredArchive(vendorScreenData?.[configuratorKey]),
      storedModuleGuids: readStoredModuleGuids(vendorScreenData?.[DEVICE_SETUP_KEY]),
      onStatus: setStatus,
      onPending: () => {
        restoreSaved = markTabsUnsaved(store, tabNames)
      },
      onUnchanged: () => {
        restoreSaved?.()
        restoreSaved = null
      },
      onSnapshot: (snapshot) => {
        restoreSaved = null
        guestArchive.current = snapshot.archive
        const applied = applyConfiguratorSnapshot(store, { configuratorKey, controller, bundleVersion }, snapshot)
        notifyDroppedAliases(applied.dropped)
      },
      onError: (message) => toast({ title: 'I/O Configurator', description: message, variant: 'fail' }),
    })
    return () => session.dispose()
  }, [store, frameKey, controller, configuratorKey, bundleVersion])

  if (!config) return null

  if (!controller) {
    return (
      <Notice>{`The I/O Configurator works only with these devices: ${Object.keys(config.controllers).join(', ')}. Select one of them to configure its I/O.`}</Notice>
    )
  }

  if (!url) return <Notice>The I/O Configurator is not available in this host yet.</Notice>

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      {status.kind === 'booting' && <Notice>Loading the I/O Configurator…</Notice>}
      {status.kind === 'failed' && (
        <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
          {status.message}
        </p>
      )}
      {/* The vendor draws the backplane at a fixed scale, about 520px tall, and never scrolls it vertically. */}
      <iframe
        key={frameKey}
        ref={iframeRef}
        title='I/O Configurator'
        src={url}
        sandbox={IFRAME_SANDBOX}
        className={`min-h-[640px] w-full flex-1 rounded-md border border-neutral-200 bg-white dark:border-neutral-800 ${status.kind === 'failed' ? 'hidden' : ''} ${status.kind === 'booting' ? 'pointer-events-none' : ''}`}
      />
    </div>
  )
}

export { ConfiguratorScreen }
