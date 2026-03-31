import { DeviceEditorTemplate } from '../../../../../_templates/[editors]/device-editor-template'
import { OrchestratorsList } from './orchestrators-list'

const DeviceOrchestratorsEditor = () => {
  return (
    <DeviceEditorTemplate id='device-orchestrators-editor'>
      <OrchestratorsList />
    </DeviceEditorTemplate>
  )
}

export { DeviceOrchestratorsEditor }
