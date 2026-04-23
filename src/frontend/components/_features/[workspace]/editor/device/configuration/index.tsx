import { DeviceEditorTemplate } from '../../../../../_templates/[editors]/device-editor-template'
import { Board } from './board'

/**
 * The Device Configuration screen used to ship a built-in Communication
 * section (Modbus RTU / Modbus TCP) next to the Board slot. That block
 * was only meaningful for Arduino-family targets and has been removed —
 * Arduino targets are expected to come back as VPP packages, and each
 * package can declare its own vendor screen for its communication
 * settings.
 *
 * The supporting schema, store slice, selectors, and compiler-side
 * handling of `communicationConfiguration` are intentionally kept so a
 * future VPP screen can write back to the same store keys without any
 * core-editor changes.
 */
const DeviceConfigurationEditor = () => {
  return (
    <DeviceEditorTemplate id='device-configuration-editor'>
      <Board />
    </DeviceEditorTemplate>
  )
}

export { DeviceConfigurationEditor }
