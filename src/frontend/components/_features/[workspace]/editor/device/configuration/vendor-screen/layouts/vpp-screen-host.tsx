import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { createProjectPlcModel } from '@root/frontend/services/plc-model/project-plc-model'
import { readVendorDocumentSection } from '@root/frontend/utils/vpp/vendor-document-section'
import { useDevice } from '@root/middleware/shared/providers/platform-context'
import { createIframeTransport } from '@root/middleware/shared/vendor-document/configurator-client'
import { installHostQueryHandler } from '@root/middleware/shared/vendor-document/host-query-handler'
import { type HostRelayMethod, RELAY_CHANNEL } from '@root/middleware/shared/vendor-document/protocol'
import { useEffect, useMemo, useRef } from 'react'

import type { ScreenSection } from '../index'

const IFRAME_SANDBOX = 'allow-scripts allow-forms'

type VppScreenHostProps = {
  section: ScreenSection
}

/**
 * Host for a VPP screen that uses the vendor-document layout but does not drive a legacy configurator.
 * Serves guest-to-host queries (`getPlcVariables`, `getPlcAddress`, `getPersistence`, `setPersistence`)
 * from the PlcModelPort and the project store, so the VPP screen inside the iframe can list the
 * project's variables and persist opaque screen data without a native vendor bundle.
 */
function VppScreenHost({ section }: VppScreenHostProps) {
  const store = useOpenPLCStoreApi()
  const devicePort = useDevice()
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const packageId = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards.get(deviceBoard)?.vpp?.packageId)

  const config = useMemo(() => readVendorDocumentSection(section), [section])
  const url = useMemo(
    () => (packageId && config?.documentPath ? devicePort.getVendorDocumentUrl(packageId, config.documentPath) : null),
    [devicePort, packageId, config?.documentPath],
  )
  const screenId = section.id

  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !url || !packageId) return
    const plcModel = createProjectPlcModel(store)
    const transport = createIframeTransport(iframe)
    const session = installHostQueryHandler(transport, async (method: HostRelayMethod, args: unknown[]) => {
      switch (method) {
        case 'getPlcVariables':
          return plcModel.listExportableVariables()
        case 'getPlcAddress': {
          const qualifier = args[0]
          if (typeof qualifier !== 'string') throw new Error('getPlcAddress needs a qualifier string')
          return plcModel.resolveAddress(qualifier)
        }
        case 'getPersistence':
          return store.getState().projectActions.getVppExtension(packageId, screenId) ?? null
        case 'setPersistence': {
          const data = args[0]
          store.getState().projectActions.setVppExtension(packageId, screenId, data)
          return true
        }
      }
    })
    // Push PLC-model changes to the guest so it can refresh its variable list without polling.
    const unsubscribeModel = plcModel.onModelChanged(() => {
      transport.post({ channel: RELAY_CHANNEL, kind: 'host-event', topic: 'plcModel/changed' })
    })
    return () => {
      unsubscribeModel()
      session.dispose()
    }
  }, [store, url, packageId, screenId])

  if (!config) {
    return (
      <p className='text-sm text-neutral-600 dark:text-neutral-400'>
        VPP screen misconfigured: document, bundleVersion and controllers are required.
      </p>
    )
  }

  if (!url) {
    return <p className='text-sm text-neutral-600 dark:text-neutral-400'>VPP screen host not available yet.</p>
  }

  return (
    <iframe
      ref={iframeRef}
      title={section.title}
      src={url}
      sandbox={IFRAME_SANDBOX}
      className='min-h-[500px] w-full flex-1 rounded-md border border-neutral-200 bg-white dark:border-neutral-800'
    />
  )
}

export { VppScreenHost }
