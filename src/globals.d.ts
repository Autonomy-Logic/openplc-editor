/**
 * Global constants injected by webpack DefinePlugin at build time
 */

/**
 * Per-app product name (e.g. "OpenPLC Editor"), injected per build. The
 * shared About modal reads this; the app version itself is now imported from
 * src/frontend/data/constants/app-version.ts, not injected as a global.
 */
declare const APP_NAME: string

/**
 * Build date in YYYY-MM-DD format
 * Set by CI during release builds, or current date during development
 * @example "2026-01-26"
 */
declare const BUILD_DATE: string

/**
 * Vitest-compatible `vi` global — aliased to `jest` in Jest via jest-vi-shim.ts
 * so shared test files can use `vi.spyOn()` in both Jest and Vitest.
 */

declare const vi: typeof jest

/**
 * PNG asset imports resolve to the emitted asset URL (webpack asset/resource).
 * Declared here because the renderer's tsconfig only includes `src/`, so the
 * root `assets/assets.d.ts` declaration isn't visible to shared `src/frontend`
 * code (e.g. the retro theme icons).
 */
declare module '*.png' {
  const content: string
  export default content
}
