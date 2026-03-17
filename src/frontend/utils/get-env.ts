/**
 * Platform-agnostic environment variable access.
 *
 * Wraps `import.meta.env` so that consumer files avoid TS1343 when the
 * project tsconfig uses `module: "commonjs"` (Electron / webpack).
 * Vite (web) and webpack DefinePlugin (editor) replace `import.meta.env`
 * at build time, so this indirection has zero runtime cost after bundling.
 */

// @ts-expect-error TS1343 — import.meta is resolved at build time by Vite / webpack
const metaEnv: Record<string, string | boolean | undefined> = import.meta?.env ?? {}

/**
 * Read an environment variable by key.
 * Returns `undefined` when the key is absent or when `import.meta` is unavailable.
 */
export function getEnv(key: string): string | undefined {
  const val = metaEnv[key]
  return typeof val === 'string' ? val : undefined
}

/**
 * Returns `true` when running in a development build (Vite DEV / webpack development mode).
 */
export function isDev(): boolean {
  return metaEnv.DEV === true || metaEnv.MODE === 'development'
}
