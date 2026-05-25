export type FileSliceType =
  | 'function'
  | 'function-block'
  | 'program'
  | 'data-type'
  | 'device'
  | 'resource'
  | 'server'
  | 'remote-device'
  | 'ethercat-device'
  | 'library-manager'
  | 'library-manifest'
  | 'vendor-screen'
  | null

export type FileSliceData = {
  type: FileSliceType
  filePath: string
  saved: boolean
  isNew?: boolean
  cleanState?: unknown
}

export type FileSliceDataObject = Record<string, FileSliceData>

export type FileActions = {
  setFiles: (args: { files: FileSliceDataObject }) => void
  addFile: (args: {
    name: string
    type: FileSliceType
    filePath: string
    isNew?: boolean
    cleanState?: unknown
  }) => boolean
  removeFile: (args: { name: string }) => void
  updateFile: (args: {
    name: string
    saved?: boolean
    filePath?: string
    newName?: string
    isNew?: boolean
    cleanState?: unknown
  }) => void
  getFile: (args: { name: string }) => { file: FileSliceData | undefined }
  setAllToSaved: () => void
  setAllToUnsaved: () => void
  getSavedState: (args: { name: string }) => boolean
  checkIfAllFilesAreSaved: () => boolean
  clearFiles: () => void
}

export type FileSlice = {
  files: FileSliceDataObject
  fileActions: FileActions
}
