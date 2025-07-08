import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCProject } from '@root/types/PLC/open-plc'

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
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
  }
}
