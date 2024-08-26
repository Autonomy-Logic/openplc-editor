import { GlobalVariablesEditor } from './global-variables'
import InstancesTable from './instances'
import TasksTable from './tasks'

export default function ResourcesEditor() {
  return (
    <div>
      <GlobalVariablesEditor />
      <InstancesTable />
      <TasksTable />
    </div>
  )
}
