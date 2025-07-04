import { ComponentPropsWithoutRef } from 'react'

import { DeviceConfigurationEditor } from './configuration'

type DeviceEditorProps = ComponentPropsWithoutRef<'div'> & {
  editorDerivation: 'Configuration'
}

const DeviceEditor = ({ editorDerivation }: DeviceEditorProps) => {
  const deviceUpdated = deviceSelectors.useDeviceUpdated()
  const resetDeviceUpdated = deviceSelectors.useResetDeviceUpdated()
  const editingState = workspaceSelectors.useEditingState()
  const setEditingState = workspaceSelectors.useSetEditingState()

  useEffect(() => {
    if (deviceUpdated && editingState !== 'unsaved') {
      setEditingState('unsaved')
      return
    }

    resetDeviceUpdated()
  }, [editingState, deviceUpdated, setEditingState])

  return <>{editorDerivation === 'Configuration' && <DeviceConfigurationEditor />}</>
}

export { DeviceEditor }
