import { DeviceEditorTemplate } from '../../../../../_templates/[editors]'
import { OrchestratorsList } from './orchestrators-list'

const DeviceOrchestratorsEditor = () => {
  return (
    <DeviceEditorTemplate id='device-orchestrators-editor'>
      <OrchestratorsList />
    </DeviceEditorTemplate>
  )
}

export { DeviceOrchestratorsEditor }
