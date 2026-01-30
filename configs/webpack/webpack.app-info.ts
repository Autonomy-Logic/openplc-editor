/**
 * App info configuration for webpack DefinePlugin
 * Provides version from package.json and build date
 */

import { resolve } from 'path'

// Read version from package.json
const packageJson = require(resolve(__dirname, '../../package.json'))

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Get app info for DefinePlugin
 * In CI builds, BUILD_DATE can be set via environment variable
 */
export function getAppInfoDefines() {
  const version = packageJson.version as string
  const buildDate = process.env.BUILD_DATE || getCurrentDate()

  return {
    APP_VERSION: JSON.stringify(version),
    BUILD_DATE: JSON.stringify(buildDate),
  }
}
