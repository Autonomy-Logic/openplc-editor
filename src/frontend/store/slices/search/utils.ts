import DOMPurify from 'dompurify'

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const extractSearchQuery = (body: string, searchQuery: string): string => {
  const escapedSearchQuery = escapeRegExp(searchQuery)
  const regex = new RegExp(`(${escapedSearchQuery})`, 'gi')
  const match = body.match(regex)
  if (match) {
    const highlightedHTML = body.replace(
      regex,
      (matched) => `<span class='bg-brand-light dark:bg-brand-medium-dark border-0 rounded-sm'>${matched}</span>`,
    )

    return DOMPurify.sanitize(highlightedHTML)
  }

  return body
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Highlights ONE occurrence by position, so two rows for the same line do not look alike. */
const highlightOccurrence = ({
  preview,
  previewColumn,
  length,
}: {
  preview: string
  previewColumn: number
  length: number
}): string => {
  const start = Math.max(0, previewColumn - 1)
  const end = start + length
  const html = `${escapeHtml(preview.slice(0, start))}<span class='bg-brand-light dark:bg-brand-medium-dark border-0 rounded-sm'>${escapeHtml(
    preview.slice(start, end),
  )}</span>${escapeHtml(preview.slice(end))}`

  return DOMPurify.sanitize(html)
}

export { escapeRegExp, extractSearchQuery, highlightOccurrence }
