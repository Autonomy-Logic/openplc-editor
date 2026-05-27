import { DeviceConfiguration, DevicePin } from '@root/backend/shared/types/PLC/devices'
import { PLCPou, PLCProject } from '@root/backend/shared/types/PLC/open-plc'

export * from './create-project'
// project-files-schema moved to backend/shared/project so it can be
// safely imported from cross-platform shared code without dragging
// the Electron IPC types namespace along with it.  Re-export here
// for back-compat with Electron-only callers that still resolve the
// schema through this IPC index.
export * from './project-recent-history'
export * from '@root/backend/shared/project/project-files-schema'

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
