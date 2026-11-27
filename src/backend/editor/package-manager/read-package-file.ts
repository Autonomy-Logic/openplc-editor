import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { InstalledPackage } from '../../../middleware/shared/ports/types'
import { assertPathContained } from '../utils/path-containment'

/**
 * UTF-8 text of a file inside an installed package.
 *
 * @param pkg - The installed package whose directory holds the file.
 * @param relPath - The file's package-relative path.
 * @returns The file's text.
 * @throws Error when `relPath` leaves the package directory or the file cannot be read.
 */
export function readPackageFile(pkg: InstalledPackage, relPath: string): string {
  const filePath = join(pkg.path, relPath)
  assertPathContained(pkg.path, filePath, `File "${relPath}" of package ${pkg.packageId}`)
  return readFileSync(filePath, 'utf-8')
}
