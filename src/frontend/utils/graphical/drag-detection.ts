/**
 * Cross-browser drag detection utilities for ladder and FBD editors
 *
 * WebKit/Safari filters custom MIME types in drag events, replacing them with
 * only "text/plain". These utilities provide fallback detection to ensure
 * drag-and-drop works across all browsers.
 *
 * @see https://github.com/nicbarker/clay/issues/78 - WebKit custom MIME type issue
 */

/**
 * Valid ladder block types that can be dragged from the toolbox
 * Used to validate text/plain fallback and prevent false positives from external drags
 */
export const VALID_LADDER_BLOCK_TYPES = ['block', 'contact', 'coil'] as const
export type LadderBlockType = (typeof VALID_LADDER_BLOCK_TYPES)[number]

/**
 * Valid FBD block types that can be dragged from the toolbox
 */
export const VALID_FBD_BLOCK_TYPES = [
  'block',
  'variable',
  'variable-input',
  'variable-output',
  'variable-inout',
] as const
export type FbdBlockType = (typeof VALID_FBD_BLOCK_TYPES)[number]

/**
 * Custom MIME types used by the application
 */
export const MIME_TYPES = {
  LADDER_BLOCKS: 'application/reactflow/ladder-blocks',
  FBD_BLOCKS: 'application/reactflow/fbd-blocks',
  LIBRARY: 'application/library',
} as const

/**
 * Check if a drag event contains ladder block data
 * Works across all browsers by checking custom MIME type first,
 * then falling back to text/plain payload validation
 *
 * @param dataTransfer - The DataTransfer object from the drag event
 * @returns true if this is a valid ladder block drag
 */
export function isLadderBlockDrag(dataTransfer: DataTransfer): boolean {
  // First try custom MIME type (works in Chromium/Firefox)
  if (dataTransfer.types.includes(MIME_TYPES.LADDER_BLOCKS)) {
    return true
  }

  // Fallback: check text/plain for known block types (works in WebKit)
  // Note: In Safari/WebKit, getData() returns empty during dragenter/dragover for security
  // We can only read data during drop. So we check effectAllowed and types presence.
  if (dataTransfer.types.includes('text/plain')) {
    // Check if effectAllowed is 'move' - our toolbox sets this
    if (dataTransfer.effectAllowed === 'move' || dataTransfer.effectAllowed === 'all') {
      // During dragenter/dragover in Safari, we trust this is from our toolbox
      // The actual validation happens in getLadderBlockType during drop
      return true
    }

    // If effectAllowed doesn't match, try to read data (works during drop)
    try {
      const textData = dataTransfer.getData('text/plain')
      // Check if it's a known ladder block type
      if (textData && VALID_LADDER_BLOCK_TYPES.includes(textData as LadderBlockType)) {
        return true
      }
    } catch {
      // getData may throw in some security contexts, ignore and return false
    }
  }

  return false
}

/**
 * Check if a drag event contains FBD block data
 * Works across all browsers by checking custom MIME type first,
 * then falling back to text/plain payload validation
 *
 * @param dataTransfer - The DataTransfer object from the drag event
 * @returns true if this is a valid FBD block drag
 */
export function isFbdBlockDrag(dataTransfer: DataTransfer): boolean {
  // First try custom MIME type (works in Chromium/Firefox)
  if (dataTransfer.types.includes(MIME_TYPES.FBD_BLOCKS)) {
    return true
  }

  // Fallback: check text/plain for known block types (works in WebKit)
  // Note: In Safari/WebKit, getData() returns empty during dragenter/dragover for security
  if (dataTransfer.types.includes('text/plain')) {
    // Check if effectAllowed is 'move' - our toolbox sets this
    if (dataTransfer.effectAllowed === 'move' || dataTransfer.effectAllowed === 'all') {
      // During dragenter/dragover in Safari, we trust this is from our toolbox
      return true
    }

    // If effectAllowed doesn't match, try to read data (works during drop)
    try {
      const textData = dataTransfer.getData('text/plain')
      // Check if it's a known FBD block type
      if (textData && VALID_FBD_BLOCK_TYPES.includes(textData as FbdBlockType)) {
        return true
      }
    } catch {
      // getData may throw in some security contexts, ignore and return false
    }
  }

  return false
}

/**
 * Get the ladder block type from a drag event
 * Tries custom MIME type first, falls back to text/plain
 *
 * @param dataTransfer - The DataTransfer object from the drag event
 * @returns The block type string, or undefined if not a valid ladder drag
 */
export function getLadderBlockType(dataTransfer: DataTransfer): string | undefined {
  // First try custom MIME type (works in Chromium/Firefox)
  const customData = dataTransfer.getData(MIME_TYPES.LADDER_BLOCKS)
  if (customData && customData !== '') {
    return customData
  }

  // Fallback: try text/plain (works in WebKit)
  const textData = dataTransfer.getData('text/plain')
  if (textData && VALID_LADDER_BLOCK_TYPES.includes(textData as LadderBlockType)) {
    return textData
  }

  return undefined
}

/**
 * Get the FBD block type from a drag event
 * Tries custom MIME type first, falls back to text/plain
 *
 * @param dataTransfer - The DataTransfer object from the drag event
 * @returns The block type string, or undefined if not a valid FBD drag
 */
export function getFbdBlockType(dataTransfer: DataTransfer): string | undefined {
  // First try custom MIME type (works in Chromium/Firefox)
  const customData = dataTransfer.getData(MIME_TYPES.FBD_BLOCKS)
  if (customData && customData !== '') {
    return customData
  }

  // Fallback: try text/plain (works in WebKit)
  const textData = dataTransfer.getData('text/plain')
  if (textData && VALID_FBD_BLOCK_TYPES.includes(textData as FbdBlockType)) {
    return textData
  }

  return undefined
}

/**
 * Get the library path from a drag event
 * Library drags include both the block type and library path
 *
 * @param dataTransfer - The DataTransfer object from the drag event
 * @returns The library path string, or undefined if not a library drag
 */
export function getLibraryPath(dataTransfer: DataTransfer): string | undefined {
  const libraryData = dataTransfer.getData(MIME_TYPES.LIBRARY)
  if (libraryData && libraryData !== '') {
    return libraryData
  }
  return undefined
}
