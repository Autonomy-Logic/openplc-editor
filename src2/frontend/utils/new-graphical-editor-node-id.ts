import { v4 as uuidv4 } from 'uuid'

export const newGraphicalEditorNodeID = (prefix = 'NODE', sep = '_'): string => {
  const rand = crypto && crypto.randomUUID ? crypto.randomUUID() : uuidv4()
  return `${String(prefix).toUpperCase()}${sep}${rand}`
}
