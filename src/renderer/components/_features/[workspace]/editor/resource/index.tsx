import GlobalVariables from './global-variables'
import InstancesTable from './instances'
import TasksTable from './tasks'

export default function ResourcesEditor() {
  return (
    <div>
      <GlobalVariables tableData={[]} filterValue="" columnFilters={{}} />
      <InstancesTable />
      <TasksTable />
    </div>
  )
}
