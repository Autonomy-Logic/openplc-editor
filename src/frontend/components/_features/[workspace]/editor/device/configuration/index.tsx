import { DeviceEditorTemplate } from '../../../../../_templates/[editors]/device-editor-template'
import { Board } from './board'

/**
 * Device Configuration screen.
 *
 * Used to ship a built-in Communication section (Modbus RTU / Modbus
 * TCP) next to the Board slot — it was only meaningful for Arduino-
 * family targets and has been removed along with its schema, store
 * slice, and compiler emission. Arduino targets come back as VPP
 * packages, and each package persists its own settings under
 * `configuration.vendorScreenData[screenId]`.
 */
const DeviceConfigurationEditor = () => {
  return (
    <DeviceEditorTemplate id='device-configuration-editor'>
      <Board />
    </DeviceEditorTemplate>
  )
}

export { DeviceConfigurationEditor }
