import { GlobalVariablesEditor } from '@root/renderer/components/_organisms/global-variables-editor'
import { InstancesEditor } from '@root/renderer/components/_organisms/instances-editor'
import { TaskEditor } from '@root/renderer/components/_organisms/task-editor'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'

const ResourcesEditor = () => {
  const {
    project: {
      data: {
        configuration: { resource },
      },
    },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  useEffect(() => {
    handleFileAndWorkspaceSavedState('Resource')
  }, [resource])

  return (
    <div className=' flex h-full w-full flex-col gap-8 overflow-y-auto'>
      <GlobalVariablesEditor />

      <TaskEditor />

      <InstancesEditor />
    </div>
  )
}

export { ResourcesEditor }
