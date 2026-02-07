/**
 * Language to file extension mapping
 */
const LANGUAGE_TO_EXTENSION: Record<string, string> = {
  st: '.st',
  il: '.il',
  ld: '.ld',
  fbd: '.fbd',
  python: '.py',
  cpp: '.cpp',
}

/**
 * POU type to IEC start keyword mapping
 */
const POU_TYPE_TO_START_KEYWORD: Record<string, string> = {
  program: 'PROGRAM',
  function: 'FUNCTION',
  'function-block': 'FUNCTION_BLOCK',
}

/**
 * POU type to folder name mapping
 */
const POU_TYPE_TO_FOLDER: Record<string, string> = {
  program: 'programs',
  function: 'functions',
  'function-block': 'function-blocks',
}

/**
 * POU type to IEC end keyword mapping
 */
const POU_TYPE_TO_END_KEYWORD: Record<string, string> = {
  program: 'END_PROGRAM',
  function: 'END_FUNCTION',
  'function-block': 'END_FUNCTION_BLOCK',
}

/**
 * Get file extension for a given language
 * @param language - The language code (st, il, ld, fbd, python, cpp)
 * @returns The file extension including the dot (e.g., '.st')
 * @throws Error if language is not supported
 */
export const getExtensionFromLanguage = (language: string): string => {
  const extension = LANGUAGE_TO_EXTENSION[language.toLowerCase()]
  if (!extension) {
    throw new Error(`Unsupported language: ${language}`)
  }
  return extension
}

/**
 * Get language code from a file extension
 * @param extension - The file extension (with or without dot)
 * @returns The language code
 * @throws Error if extension is not supported
 */
export const getLanguageFromExtension = (extension: string): string => {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`

  const language = Object.entries(LANGUAGE_TO_EXTENSION).find(([, ext]) => ext === normalizedExtension)?.[0]

  if (!language) {
    throw new Error(`Unsupported extension: ${extension}`)
  }
  return language
}

/**
 * Get IEC start keyword for a given POU type
 * @param pouType - The POU type (program, function, function-block)
 * @returns The IEC start keyword (e.g., 'PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK')
 * @throws Error if POU type is not supported
 */
export const getStartKeyword = (pouType: string): string => {
  const keyword = POU_TYPE_TO_START_KEYWORD[pouType]
  if (!keyword) {
    throw new Error(`Unsupported POU type: ${pouType}`)
  }
  return keyword
}

/**
 * Get IEC end keyword for a given POU type
 * @param pouType - The POU type (program, function, function-block)
 * @returns The IEC end keyword (e.g., 'END_PROGRAM', 'END_FUNCTION', 'END_FUNCTION_BLOCK')
 * @throws Error if POU type is not supported
 */
export const getEndKeyword = (pouType: string): string => {
  const keyword = POU_TYPE_TO_END_KEYWORD[pouType]
  if (!keyword) {
    throw new Error(`Unsupported POU type: ${pouType}`)
  }
  return keyword
}

/**
 * Get folder name for a given POU type
 * @param pouType - The POU type (program, function, function-block)
 * @returns The folder name (e.g., 'programs', 'functions', 'function-blocks')
 */
export const getFolderFromPouType = (pouType: string): string => {
  const folder = POU_TYPE_TO_FOLDER[pouType]
  if (!folder) {
    return 'programs'
  }
  return folder
}
