/**
 * App info configuration for webpack DefinePlugin.
 *
 * APP_VERSION is no longer injected here: the shared About modal imports it
 * from src/frontend/data/constants/app-version.ts — the single source of
 * truth shared byte-for-byte with openplc-web, so the two IDEs always show
 * the same version. This file now only provides the per-app product name
 * (APP_NAME, "OpenPLC Editor") and the build date.
 */

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
  const buildDate = process.env.BUILD_DATE || getCurrentDate()

  return {
    APP_NAME: JSON.stringify('OpenPLC Editor'),
    BUILD_DATE: JSON.stringify(buildDate),
  }
}
