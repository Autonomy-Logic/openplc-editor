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
      (matched) => `<span class='text-brand-medium dark:text-brand-light'>${matched}</span>`,
    )

    return DOMPurify.sanitize(highlightedHTML)
  }

  return body
}

export { extractSearchQuery }