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
      /**
       * POUs exposed as discrete files. Authoritative for save/export operations
       * (main process uses data.content.pous when writing POU files). The renderer
       * mirrors result.data.content.pous into project.data.pous for in‑memory state.
       *
       * To avoid divergence: either make content.pous the single source-of-truth
       * for POU data, or ensure the read/write paths deterministically sync both
       * content.pous and project.data.pous (see read-project.ts and create-project.ts).
       */
      pous: PLCPou[]
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }
}
