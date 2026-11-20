/**
 * Writes a user library for the e2e suite: one widget, HmiDial, on top of the pre-installed standard-widgets, and one
 * plain function, DialScale, compiled like any library. A second argument sets the HMI core API version its chunks
 * require.
 * Usage: ts-node -T -r tsconfig-paths/register e2e/fixtures/hmi-widget-library/make-library.ts <out.stlib> [coreApi]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadStrucpp } from '../../../src/backend/shared/library/strucpp-runtime'
import { HMI_CORE_API_VERSION } from '../../../src/middleware/shared/utils/hmi/widget-libraries'

const [out, coreApi] = process.argv.slice(2)
if (!out) throw new Error('usage: make-library.ts <out.stlib> [coreApi]')
const core = String(HMI_CORE_API_VERSION)
const strucpp = loadStrucpp()
const base = strucpp.loadStlibFromString(
  readFileSync(join(process.cwd(), 'vendor', 'hmi-widgets', 'standard-widgets.stlib'), 'utf8'),
  'standard-widgets',
)
const compiled = strucpp.compileStlib(
  [
    {
      fileName: 'dial.st',
      source: `{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiDial EXTENDS HmiLamp
  VAR_INPUT Sweep : INT := 270; END_VAR
END_FUNCTION_BLOCK
FUNCTION DialScale : INT
  VAR_INPUT X : INT; END_VAR
  DialScale := X * 2;
END_FUNCTION
`,
    },
  ],
  {
    name: 'extra-widgets',
    version: '1.0.0',
    namespace: 'extra_widgets',
    headers: [{ name: 'hmi_core.h', version: core }],
    dependencies: [base],
  },
)
if (compiled.errors.length > 0) throw new Error(compiled.errors.map((e) => e.message).join('\n'))
const text = JSON.stringify({
  ...compiled.archive,
  manifest: { ...compiled.archive.manifest, displayName: 'Extra Widgets' },
})
const required = coreApi ?? core
writeFileSync(
  out,
  required === core
    ? text
    : text
        .replaceAll(`"name":"hmi_core.h","version":"${core}"`, `"name":"hmi_core.h","version":"${required}"`)
        .replace(`"hmi_core.h":"${core}"`, `"hmi_core.h":"${required}"`),
)
