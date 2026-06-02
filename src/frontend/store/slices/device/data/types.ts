import type { DeviceConfiguration } from '../../../../../middleware/shared/ports/types'

export const defaultDeviceConfiguration: DeviceConfiguration = {
  deviceBoard: 'OpenPLC Simulator',
  communicationPort: '',
  runtimeIpAddress: '',
  selectedPlatformOptions: {},
}
