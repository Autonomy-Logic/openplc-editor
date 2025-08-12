export const unsavedLabel = (label: string | undefined, associatedFile: { saved: boolean } | undefined) => {
  if (!associatedFile || associatedFile?.saved) return label
  return `* <i>${label}</i>`
}
