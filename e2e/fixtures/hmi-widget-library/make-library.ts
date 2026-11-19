/**
 * Writes a user widget library for the e2e suite: one widget, HmiDial, on top of the pre-installed standard-widgets,
 * as a .stlib with the metadata a widget library release carries. A second argument sets its HMI core API version.
 * Usage: ts-node -T -r tsconfig-paths/register e2e/fixtures/hmi-widget-library/make-library.ts <out.stlib> [coreApi]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildWidgetCatalog } from '../../../src/backend/shared/hmi/lib/widget-catalog'
import { loadStrucpp } from '../../../src/backend/shared/library/strucpp-runtime'
import { HMI_CORE_API_VERSION } from '../../../src/middleware/shared/utils/hmi/widget-libraries'

const [out, coreApi] = process.argv.slice(2)
if (!out) throw new Error('usage: make-library.ts <out.stlib> [coreApi]')
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
`,
    },
  ],
  {
    name: 'extra-widgets',
    version: '1.0.0',
    namespace: 'extra_widgets',
    headers: ['hmi_core.h'],
    dependencies: [base],
  },
)
if (compiled.errors.length > 0) throw new Error(compiled.errors.map((e) => e.message).join('\n'))
const catalog = buildWidgetCatalog([base.manifest, compiled.archive.manifest])
writeFileSync(
  out,
  JSON.stringify({
    ...compiled.archive,
    manifest: { ...compiled.archive.manifest, displayName: 'Extra Widgets' },
    openplc: {
      formatVersion: 1,
      kind: 'hmi',
      license: 'GPL-3.0-only',
      hmiCoreApi: coreApi ? Number(coreApi) : HMI_CORE_API_VERSION,
      catalog: { widgets: [...catalog.widgets.values()].filter((w) => w.library === 'extra-widgets'), colors: [] },
    },
  }),
)
