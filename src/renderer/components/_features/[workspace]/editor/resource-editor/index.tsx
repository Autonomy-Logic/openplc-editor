import InstancesEditor from '@root/renderer/components/_organisms/instances-editor'
import TaskEditor from '@root/renderer/components/_organisms/task-editor'

import { GlobalVariablesEditor } from '../../../../_molecules/global-variables'

export default function ResourcesEditor() {
  return (
    <div className=' h-full w-full gap-12 flex flex-col overflow-y-auto'>
      <GlobalVariablesEditor />

      <TaskEditor />

      <InstancesEditor />
    </div>
  )
}
