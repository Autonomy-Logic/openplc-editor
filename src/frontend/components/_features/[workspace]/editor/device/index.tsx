import { useEffect } from 'react'

import { useOpenPLCStore } from '../../../../../store'
import { EditingLockBoundary } from '../../../../_molecules/editing-lock-boundary'
import { DeviceConfigurationEditor } from './configuration'
import { DeviceOrchestratorsEditor } from './orchestrators'
import { RuntimeStatusEditor } from './runtime-status'

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
      {derivation === 'orchestrators' && (
        <EditingLockBoundary>
          <DeviceOrchestratorsEditor />
        </EditingLockBoundary>
      )}
      {derivation === 'runtime-status' && <RuntimeStatusEditor />}
      {derivation !== 'orchestrators' && derivation !== 'runtime-status' && (
        <EditingLockBoundary>
          <DeviceConfigurationEditor />
        </EditingLockBoundary>
      )}
    </div>
  )
}

export { DeviceEditor }
