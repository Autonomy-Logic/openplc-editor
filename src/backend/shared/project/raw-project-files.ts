/**
 * Conversions between a project as a platform read it (`RawProjectFiles`) and the shapes other paths need, so no
 * platform lists the file categories itself.
 */
import type { RawProjectFile, WriteProjectFiles } from '../../../middleware/shared/ports/project-port'
import { iterateWriteProjectFiles } from './iterate-write-project-files'

/** The file categories of a project as read; `libraryManifest` is empty when there is none. */
export interface RawProjectContent {
  projectPath: string
  projectJson: string
  deviceConfig: string
  pinMapping: string
  libraryManifest: string
  pouFiles: RawProjectFile[]
  serverFiles: RawProjectFile[]
  remoteDeviceFiles: RawProjectFile[]
  dataTypeFiles: RawProjectFile[]
  hmiFiles: RawProjectFile[]
}

/** A project as read, to be written somewhere else as it is. */
export function writeFilesFromRaw(raw: RawProjectContent): WriteProjectFiles {
  return {
    projectPath: raw.projectPath,
    projectJson: raw.projectJson,
    deviceConfig: raw.deviceConfig,
    pinMapping: raw.pinMapping,
    libraryManifest: raw.libraryManifest.length > 0 ? raw.libraryManifest : undefined,
    pouFiles: raw.pouFiles,
    serverFiles: raw.serverFiles,
    remoteDeviceFiles: raw.remoteDeviceFiles,
    dataTypeFiles: raw.dataTypeFiles,
    hmiFiles: raw.hmiFiles,
    deletions: [],
  }
}

/** Every file of a project as read, by relative path, so unedited files are saved back byte for byte. */
export function rawLoadedFilesFromRaw(raw: RawProjectContent): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of iterateWriteProjectFiles(writeFilesFromRaw(raw))) map[entry.relativePath] = entry.content
  return map
}
