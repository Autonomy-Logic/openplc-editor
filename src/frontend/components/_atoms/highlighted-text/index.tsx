import DOMPurify from 'dompurify'
import { memo } from 'react'

interface HighlightedTextProps {
  text: string
  searchQuery?: string
  className?: string
  highlightClassName?: string
}

/**
 * A safe component for rendering text with optional search query highlighting.
 * Uses DOMPurify to sanitize HTML and prevents XSS vulnerabilities.
 */
const HighlightedText = memo<HighlightedTextProps>(
  ({
    text,
    searchQuery,
    className = '',
    highlightClassName = 'bg-brand-light dark:bg-brand-medium-dark border-0 rounded-sm',
  }) => {
    if (!text) return null

    // If no search query, just render plain text
    if (!searchQuery || !searchQuery.trim()) {
      return <span className={className}>{text}</span>
    }

    try {
      // Escape special regex characters
      const escapedSearchQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`(${escapedSearchQuery})`, 'gi')

      // Check if there's a match
      const match = text.match(regex)
      if (!match) {
        return <span className={className}>{text}</span>
      }

      // Create highlighted HTML
      const highlightedHTML = text.replace(regex, (matched) => `<span class='${highlightClassName}'>${matched}</span>`)

      // Sanitize the HTML
      const sanitizedHTML = DOMPurify.sanitize(highlightedHTML)

      return <span className={className} dangerouslySetInnerHTML={{ __html: sanitizedHTML }} />
    } catch (error) {
      // Fallback to plain text if anything goes wrong
      console.warn('Error in HighlightedText:', error)
      return <span className={className}>{text}</span>
    }
  },
)

HighlightedText.displayName = 'HighlightedText'

export { HighlightedText }
