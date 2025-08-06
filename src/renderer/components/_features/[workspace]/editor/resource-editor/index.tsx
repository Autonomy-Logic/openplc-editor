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
    workspace: { editingState },
    workspaceActions: { setEditingState },
    fileActions: { updateFile, getFile },
  } = useOpenPLCStore()

  useEffect(() => {
    const { file: resourceFile } = getFile({ name: 'Resource' })
    if (resourceFile?.saved)
      updateFile({
        name: 'Resource',
        saved: false,
      })
    if (editingState !== 'unsaved') setEditingState('unsaved')
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
