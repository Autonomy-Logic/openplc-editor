import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Checks if a file or directory exists at the given path.
 * @param targetPath The path to check.
 * @returns {boolean} True if the file or directory exists, false otherwise.
 */
export function fileOrDirectoryExists(targetPath: string): boolean {
  try {
    return existsSync(resolve(targetPath))
  } catch (_error) {
    return false
  }
}
