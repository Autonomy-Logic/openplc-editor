import { deviceSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'

import { DeviceConfigurationEditor } from './configuration'

const DeviceEditor = () => {
  const {
    workspace: { editingState },

    fileActions: { updateFile, getFile },
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  const deviceUpdated = deviceSelectors.useDeviceUpdated()
  const resetDeviceUpdated = deviceSelectors.useResetDeviceUpdated()

  useEffect(() => {
    if (deviceUpdated) {
      const { file: deviceFile } = getFile({ name: 'Configuration' })
      if (deviceFile) {
        updateFile({
          name: 'Configuration',
          saved: false,
        })
        return
      }

      if (editingState !== 'unsaved') {
        setEditingState('unsaved')
        return
      }
      resetDeviceUpdated()
    }
  }, [editingState, deviceUpdated])

  return <DeviceConfigurationEditor />
}

export { DeviceEditor }
