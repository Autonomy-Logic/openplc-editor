import { mkdirSync } from 'fs'
import { resolve } from 'path'

/**
 * Recursively creates a directory and all parent directories if they do not exist.
 * @param dirPath The directory path to create.
 * @returns {boolean} True if the directory was created or already exists, false if an error occurred.
 */
export function createDirectory(dirPath: string): boolean {
  try {
    mkdirSync(resolve(dirPath), { recursive: true })
    return true
  } catch (_error) {
    return false
  }
}
