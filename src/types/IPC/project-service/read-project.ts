import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCPou, PLCProject, PLCRemoteDevice, PLCServer } from '@root/types/PLC/open-plc'

export type IProjectServiceReadFilesResponse = {
  success: boolean
  error?: {
    title: string
    description: string
    error: unknown
  }
  message?: string
  data?: {
    project: PLCProject
    pous: PLCPou[]
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
    servers?: PLCServer[]
    remoteDevices?: PLCRemoteDevice[]
  }
}
