import { deviceSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'

import { DeviceConfigurationEditor } from './configuration'

const DeviceEditor = () => {
  const {
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const deviceUpdated = deviceSelectors.useDeviceUpdated()
  const resetDeviceUpdated = deviceSelectors.useResetDeviceUpdated()

  useEffect(() => {
    if (deviceUpdated) {
      handleFileAndWorkspaceSavedState('Configuration')
      resetDeviceUpdated()
    }
  }, [deviceUpdated])

  return <DeviceConfigurationEditor />
}

export { DeviceEditor }
