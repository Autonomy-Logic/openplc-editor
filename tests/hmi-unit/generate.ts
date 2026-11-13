/**
 * Generates the sample project's HMI unit (shared Jest fixture) into a directory for run.mjs: its C++ files and
 * preview setters, `ids.h` with the bounds id of each element (`ID_<SCREEN>_<ELEMENT>`), `setters.h` with each live
 * setter (`SET_<SCREEN>_<ELEMENT>_<PROPERTY>`), and `result.json` with the diagnostics and the tag table.
 * Usage: ts-node -r tsconfig-paths/register tests/hmi-unit/generate.ts <out-dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { generateHmiUnit } from '../../src/backend/shared/hmi/unit/generate-hmi-unit'
import { sampleProject } from '../../src/backend/shared/hmi/unit/__tests__/fixtures/sample-project'

const [out] = process.argv.slice(2)
if (!out) throw new Error('usage: generate.ts <out-dir>')
mkdirSync(out, { recursive: true })
const result = generateHmiUnit(sampleProject())
for (const [name, text] of Object.entries({ ...result.files, ...result.preview.files }))
  writeFileSync(join(out, name), text)
writeFileSync(
  join(out, 'ids.h'),
  result.elementIds
    .map((e) => `#define ID_${e.screen}_${e.element} ${e.id}`.toUpperCase().replace('#DEFINE', '#define'))
    .join('\n') + '\n',
)
writeFileSync(
  join(out, 'setters.h'),
  Object.entries(result.preview.setters)
    .map(([key, s]) => `#define SET_${key.replace(/\./g, '_').toUpperCase()} ${s.index}`)
    .join('\n') + '\n',
)
const { ok, errors, warnings, tags, fonts, preview } = result
writeFileSync(
  join(out, 'result.json'),
  JSON.stringify({ ok, errors, warnings, tags, fonts, units: preview.units }, null, 1),
)
if (!ok) {
  console.error(errors.map((e) => `${e.file}${e.line === undefined ? '' : `:${e.line}`}: ${e.message}`).join('\n'))
  process.exit(1)
}
