import { DeviceConfiguration, DevicePin } from '@root/backend/shared/types/PLC/devices'
import { PLCPou, PLCProject } from '@root/backend/shared/types/PLC/open-plc'

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
      /** Library projects only — raw bytes of `library.json`.
       *  Mirrors the on-disk shape: `project.json` carries no
       *  manifest, `library.json` does.  The renderer threads this
       *  straight into `project.data.libraryManifest` so the
       *  manifest tab sees the initial content without a follow-up
       *  disk read. */
      libraryManifest?: string
    }
  }
}
