import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { ExampleSource } from './check-boundaries'

const SOURCE_FILE = /\.tsx?$/
const DECLARATION_FILE = /\.d\.ts$/

/** Reads every `.ts`/`.tsx` file under `root` (declaration files excluded) for `checkBoundaries`. */
export function collectSources(root: string, directory: string = root): ExampleSource[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectSources(root, path)
    if (!SOURCE_FILE.test(entry.name) || DECLARATION_FILE.test(entry.name)) return []
    return [{ path: relative(root, path).split(sep).join('/'), text: readFileSync(path, 'utf-8') }]
  })
}
