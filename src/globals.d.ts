/**
 * Global constants injected by webpack DefinePlugin at build time
 */

/**
 * Application version from package.json
 * @example "4.1.1"
 */
declare const APP_VERSION: string

/**
 * Build date in YYYY-MM-DD format
 * Set by CI during release builds, or current date during development
 * @example "2026-01-26"
 */
declare const BUILD_DATE: string
