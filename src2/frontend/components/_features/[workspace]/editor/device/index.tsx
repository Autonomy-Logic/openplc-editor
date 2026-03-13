import { useOpenPLCStore } from '../../../../../store'
import { useEffect } from 'react'

import { DeviceConfigurationEditor } from './configuration'

const DeviceEditor = () => {
  const {
    deviceUpdated: { updated: deviceUpdated },
    deviceActions: { resetDeviceUpdated },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  useEffect(() => {
    if (deviceUpdated) {
      handleFileAndWorkspaceSavedState('Configuration')
      resetDeviceUpdated()
    }
  }, [deviceUpdated])

  return <DeviceConfigurationEditor />
}

export { DeviceEditor }
