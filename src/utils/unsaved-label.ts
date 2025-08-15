const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export const unsavedLabel = (label: string | undefined, associatedFile: { saved: boolean } | undefined) => {
  if (!label) return label
  if (!associatedFile || associatedFile.saved) return label

  const safe = escapeHtml(label)
  return `* <i>${safe}</i>`
}
