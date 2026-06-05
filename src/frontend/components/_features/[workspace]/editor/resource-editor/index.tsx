import { GlobalVariablesEditor } from '../../../../_organisms/global-variables-editor'
import { InstancesEditor } from '../../../../_organisms/instances-editor'
import { TaskEditor } from '../../../../_organisms/task-editor'

const ResourcesEditor = () => {
  return (
    <div className=' flex h-full w-full flex-col gap-8 overflow-y-auto'>
      <GlobalVariablesEditor />

      <TaskEditor />

      <InstancesEditor />
    </div>
  )
}

export { ResourcesEditor }
