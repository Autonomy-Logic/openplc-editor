/**
 * Writes the StandardWidgets identity and sources as JSON for run.mjs.
 * Usage: ts-node tests/hmi-lib/library-sources.ts <out.json>
 */
import { writeFileSync } from 'node:fs'

import { STANDARD_WIDGETS_LIBRARY, STANDARD_WIDGETS_SOURCES } from '../../src/backend/shared/hmi/lib/standard-widgets'

const [out] = process.argv.slice(2)
if (!out) throw new Error('usage: library-sources.ts <out.json>')
writeFileSync(out, JSON.stringify({ library: STANDARD_WIDGETS_LIBRARY, sources: STANDARD_WIDGETS_SOURCES }))
