/**
 * The pinned HMI widgets release as the setup installed it (`vendor/hmi-widgets/`, `npm run setup:hmi-widgets`), for
 * tests and harnesses that build HMIs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where the setup installs the release, from the repository root. */
export const HMI_WIDGETS_DIR = join(process.cwd(), 'vendor', 'hmi-widgets')

/** The text of an installed archive by library name. */
export function installedArchiveText(name: string): string {
  const file = join(HMI_WIDGETS_DIR, `${name}.stlib`)
  if (!existsSync(file)) throw new Error(`${file} is missing: run npm run setup:hmi-widgets`)
  return readFileSync(file, 'utf8')
}

/** Every installed archive of the release, parsed, in file name order. */
export function installedWidgetArchives(): unknown[] {
  if (!existsSync(HMI_WIDGETS_DIR)) throw new Error(`${HMI_WIDGETS_DIR} is missing: run npm run setup:hmi-widgets`)
  return readdirSync(HMI_WIDGETS_DIR)
    .filter((f) => f.endsWith('.stlib'))
    .sort()
    .map((f): unknown => JSON.parse(readFileSync(join(HMI_WIDGETS_DIR, f), 'utf8')))
}
