// TODO: This file should NOT live in src/frontend/ — it belongs in src/middleware/adapters/web/.
// All current consumers are web-only middleware adapters, except for
// ai-inline-completion-provider.ts which should be migrated to use AIPort instead of calling
// the Edge API directly (the editor version already uses AIPort). Once that migration is done,
// move this file to src/middleware/adapters/web/utils/get-env.ts and update all import paths.

/**
 * Platform-agnostic environment variable access.
 *
 * Wraps `import.meta.env` so that consumer files avoid TS1343 when the
 * project tsconfig uses `module: "commonjs"` (Electron / webpack).
 * Vite (web) and webpack DefinePlugin (editor) replace `import.meta.env`
 * at build time, so this indirection has zero runtime cost after bundling.
 */

// NOTE: Must use `import.meta.env` (not `import.meta?.env`) so Vite's
// module transform recognises the expression and injects env values.
const metaEnv: Record<string, string | boolean | undefined> = import.meta.env ?? {}

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

/**
 * Returns the base URL for Edge API requests.
 *
 * In development, returns `/edge-api` so that all requests are routed through
 * the Vite dev proxy (which can inject an accessToken cookie when
 * VITE_DEV_ACCESS_TOKEN is set).
 *
 * In production, returns the value of VITE_EDGE_API_URL (or localhost fallback).
 */
export function getEdgeApiBaseUrl(): string {
  if (isDev()) return '/edge-api'
  return getEnv('VITE_EDGE_API_URL') || 'http://localhost:3333'
}
