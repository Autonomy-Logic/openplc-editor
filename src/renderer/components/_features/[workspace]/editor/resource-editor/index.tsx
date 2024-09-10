import TaskEditor from '@root/renderer/components/_organisms/task-editor'

import { GlobalVariablesEditor } from '../../../../_molecules/global-variables'
import InstancesTable from '../../../../_molecules/instances'

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
        <InstancesTable />
      </div>
    </div>
  )
}
