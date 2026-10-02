/**
 * Where the packaged skill files live.
 *
 * Packaged, they sit under `process.resourcesPath` — `electron-builder` copies
 * `resources/skills` there through `extraResources`. In development
 * `app.getAppPath()` is the BUILD directory, not the repo root, so a fixed
 * `../../` offset resolves somewhere that does not exist on one of the two.
 * Walking up to the nearest directory that actually contains `resources/skills`
 * works for both, and is the same approach `main.ts` takes to find the app name.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SkillSourceEnvironment {
  packaged: boolean
  resourcesPath: string
  appPath: string
}

/** Absolute path of the skills directory, or null when it is not shipped. */
export function resolveSkillRoot(environment: SkillSourceEnvironment): string | null {
  if (environment.packaged) {
    const packaged = join(environment.resourcesPath, 'skills')
    return existsSync(packaged) ? packaged : null
  }

  let directory = environment.appPath
  // Bounded by reaching the filesystem root, where `dirname` stops changing.
  for (;;) {
    const candidate = join(directory, 'resources', 'skills')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** Directory holding one named skill, or null when that skill is not shipped. */
export function resolveSkillPath(environment: SkillSourceEnvironment, name: string): string | null {
  const root = resolveSkillRoot(environment)
  if (!root) return null
  // A name is a single path segment naming a real skill. `''` and `'.'` both
  // join to the skills ROOT, which exists — the caller would then read
  // `<root>/SKILL.md`, which does not, and fail instead of reporting a skill
  // it does not ship.
  if (name.length === 0 || name === '.') return null
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null
  const path = join(root, name)
  return existsSync(path) ? path : null
}
