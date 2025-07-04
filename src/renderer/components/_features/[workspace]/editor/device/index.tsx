import { deviceSelectors, workspaceSelectors } from '@root/renderer/hooks'
import { useEffect } from 'react'

import { DeviceConfigurationEditor } from './configuration'

const DeviceEditor = () => {
  const deviceUpdated = deviceSelectors.useDeviceUpdated()
  const resetDeviceUpdated = deviceSelectors.useResetDeviceUpdated()
  const editingState = workspaceSelectors.useEditingState()
  const setEditingState = workspaceSelectors.useSetEditingState()

  useEffect(() => {
    if (deviceUpdated) {
      if (editingState !== 'unsaved') {
        setEditingState('unsaved')
        return
      }
      resetDeviceUpdated()
    }
  }, [editingState, deviceUpdated, setEditingState])

  return <DeviceConfigurationEditor />
}

export { DeviceEditor }
