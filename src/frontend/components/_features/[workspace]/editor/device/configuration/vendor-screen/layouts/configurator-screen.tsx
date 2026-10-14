import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { applyConfiguratorSnapshot } from '@root/frontend/services/apply-configurator-snapshot'
import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { type ConfiguratorSessionStatus, startConfiguratorSession } from '@root/frontend/utils/vpp/configurator-session'
import type { UnaddressableDataPoint } from '@root/frontend/utils/vpp/datapoints-to-io-mapping'
import { DEVICE_SETUP_KEY } from '@root/frontend/utils/vpp/persistence-keys'
import { readVendorDocumentSection } from '@root/frontend/utils/vpp/vendor-document-section'
import { useDevice } from '@root/middleware/shared/providers/platform-context'
import { createIframeConfiguratorClient } from '@root/middleware/shared/vendor-document/configurator-client'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ScreenSection } from '../index'

/** Never add `allow-same-origin`: with it the guest could reach the host. */
const IFRAME_SANDBOX = 'allow-scripts allow-forms'

const UNADDRESSABLE_REASON: Record<UnaddressableDataPoint['reason'], string> = {
  'unsupported-access': 'neither input nor output',
  'unsupported-width': 'unsupported size',
  'unsupported-datatype': 'unsupported data type',
  'unknown-module': 'module not in the device setup',
}

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
  // The iframe is keyed on this, so a new board or document mounts a fresh guest and session.
  const frameKey = `${deviceBoard}\n${url ?? ''}`

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<ConfiguratorSessionStatus>({ kind: 'booting' })
  const [unaddressable, setUnaddressable] = useState<UnaddressableDataPoint[]>([])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !controller || !configuratorKey || !bundleVersion) return
    const vendorScreenData = store.getState().deviceDefinitions.configuration.vendorScreenData
    setUnaddressable([])
    const session = startConfiguratorSession({
      port: createIframeConfiguratorClient(iframe),
      controller,
      storedArchive: readStoredArchive(vendorScreenData?.[configuratorKey]),
      storedModuleGuids: readStoredModuleGuids(vendorScreenData?.[DEVICE_SETUP_KEY]),
      onStatus: setStatus,
      onSnapshot: (snapshot) => {
        const applied = applyConfiguratorSnapshot(store, { configuratorKey, controller, bundleVersion }, snapshot)
        setUnaddressable(applied.unaddressable)
        if (applied.dropped.length > 0) {
          toast({
            title: 'Aliases removed',
            description: `The channels of ${applied.dropped.map((d) => d.alias).join(', ')} no longer exist, so their aliases were removed.`,
            variant: 'warn',
          })
        }
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
      <iframe
        key={frameKey}
        ref={iframeRef}
        title='I/O Configurator'
        src={url}
        sandbox={IFRAME_SANDBOX}
        className={`min-h-[480px] w-full flex-1 rounded-md border border-neutral-200 bg-white dark:border-neutral-800 ${status.kind === 'failed' ? 'hidden' : ''}`}
      />
      {unaddressable.length > 0 && (
        <Notice>{`These datapoints have no IEC address: ${unaddressable
          .map((point) => `${point.name} (${UNADDRESSABLE_REASON[point.reason]})`)
          .join(', ')}.`}</Notice>
      )}
    </div>
  )
}

export { ConfiguratorScreen }
