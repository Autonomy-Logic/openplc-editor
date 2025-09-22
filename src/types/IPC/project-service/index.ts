import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCPou, PLCProject } from '@root/types/PLC/open-plc'

export * from './create-project'
export * from './project-files-schema'
export * from './project-recent-history'

export type IProjectServiceResponse = {
  success: boolean
  error?: {
    title: string
    description: string
    error: unknown
  }
  message?: string
  data?: {
    meta: {
      path: string
    }
    content: {
      project: PLCProject
      pous: PLCPou[]
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }
}
