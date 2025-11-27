export const unsavedLabel = (label: string | undefined, associatedFile: { saved: boolean } | undefined) => {
  if (!label) return label
  if (!associatedFile || associatedFile.saved) return label

  return `* ${label}`
}

export const isUnsaved = (associatedFile: { saved: boolean } | undefined): boolean => {
  return !!associatedFile && !associatedFile.saved
}
