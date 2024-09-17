import InstancesEditor from '@root/renderer/components/_organisms/instances-editor'
import TaskEditor from '@root/renderer/components/_organisms/task-editor'

import { GlobalVariablesEditor } from '../../../../_molecules/global-variables'

export default function ResourcesEditor() {
  return (
    <div className=' h-full w-full '>
      <div className='h-2/5 p-2'>
        <GlobalVariablesEditor />
      </div>
      <div className='h-[30%] p-2'>
        <TaskEditor />
      </div>
      <div className='h-[30%]  p-2'>
        <InstancesEditor />
      </div>
    </div>
  )
}
