import { useEffect } from 'react'

import { useOpenPLCStore } from '../../../../../store'
import { DeviceConfigurationEditor } from './configuration'
import { DeviceOrchestratorsEditor } from './orchestrators'

const DeviceEditor = () => {
  const {
    editor,
    deviceUpdated: { updated: deviceUpdated },
    deviceActions: { resetDeviceUpdated },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const derivation = editor.type === 'plc-device' ? editor.meta.derivation : null

  useEffect(() => {
    if (deviceUpdated) {
      handleFileAndWorkspaceSavedState('Configuration')
      resetDeviceUpdated()
    }
  }, [deviceUpdated])

  return (
    <div aria-label='Device content container' className='h-full w-full overflow-hidden'>
      {derivation === 'orchestrators' ? <DeviceOrchestratorsEditor /> : <DeviceConfigurationEditor />}
    </div>
  )
}

export { DeviceEditor }
