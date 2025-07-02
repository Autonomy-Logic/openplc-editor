import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCProject } from '@root/types/PLC/open-plc'

/**
 * Project.json file structure
 * This file is used to create a new project in OpenPLC Editor.
 */
export type CreateProjectFileProps = {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
  type: 'plc-project' | 'plc-library'
  name: string
  path: string
}

/**
 * devices/configuration.json file structure
 * devices/pin-mapping.json file structure
 * This file is used to create a new device configuration in OpenPLC Editor.
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
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }
}
