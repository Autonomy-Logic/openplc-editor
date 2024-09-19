import { GlobalVariablesEditor } from '@root/renderer/components/_organisms/global-variables-editor'
import InstancesEditor from '@root/renderer/components/_organisms/instances-editor'
import TaskEditor from '@root/renderer/components/_organisms/task-editor'

export default function ResourcesEditor() {
  return (
    <div className=' flex h-full w-full flex-col gap-12 overflow-y-auto'>
      <GlobalVariablesEditor />

      <TaskEditor />

      <InstancesEditor />
    </div>
  )
}
