import { newUuid } from './new-uuid'

export const newGraphicalEditorNodeID = (prefix = 'NODE', sep = '_'): string =>
  `${String(prefix).toUpperCase()}${sep}${newUuid()}`
