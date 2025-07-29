import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCPou, PLCProject } from '@root/types/PLC/open-plc'

/**
 * Type designed to create a new project file in OpenPLC Editor.
 */
export type CreateProjectFileProps = {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
  type: 'plc-project' | 'plc-library'
  name: string
  path: string
}

/**
 * Type designed to create default directories for a new project in OpenPLC Editor.
 */
export type CreateProjectDefaultDirectoriesResponse = {
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
