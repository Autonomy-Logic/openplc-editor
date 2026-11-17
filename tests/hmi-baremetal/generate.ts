/**
 * Generates what run.mjs builds the baremetal host test with, through the real shared build steps: the sample project's
 * unit, its Overview screen with a sign-out button, (`unit/`, with `ids.h`), its font table as the firmware build chooses it (`fonts.c`), and the panel's
 * `hmi_config.h` for a product build (`product/`) and a test-readout build (`readout/`).
 * Usage: ts-node -r tsconfig-paths/register tests/hmi-baremetal/generate.ts <out-dir>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { hmiFirmwareFaces } from '../../src/backend/shared/hmi/firmware/compose-hmi-firmware'
import { hmiConfigHeader } from '../../src/backend/shared/hmi/firmware/hmi-config-header'
import { hmiFontTableFromSources } from '../../src/backend/shared/hmi/fonts/font-table-source'
import { generateHmiUnit } from '../../src/backend/shared/hmi/unit/generate-hmi-unit'
import { OVERVIEW, sampleProject } from '../../src/backend/shared/hmi/unit/__tests__/fixtures/sample-project'
import { resolveHmiPanel } from '../../src/middleware/shared/utils/target-capabilities/hmi-panel'

const FONT_DIR = join(__dirname, '..', '..', 'resources', 'sources', 'hmi', 'fonts')

/** The sample Overview screen with a Leave button that signs out. */
function overviewWithSignOut(): string {
  const source = OVERVIEW.replace(
    '    Next : HmiButton',
    "    Leave : HmiButton := (Text := 'Sign out', Parent := 'Body');\n    Next : HmiButton",
  ).replace('END_FUNCTION_BLOCK', 'IF Leave.Clicked THEN HMI_SignOut(); END_IF;\nEND_FUNCTION_BLOCK')
  if (!source.includes('HMI_SignOut')) throw new Error('the sample Overview screen changed: Leave was not added')
  return source
}

async function main(): Promise<void> {
  const [out] = process.argv.slice(2)
  if (!out) throw new Error('usage: generate.ts <out-dir>')
  const sample = sampleProject()
  const project = {
    ...sample,
    screens: sample.screens.map((s) => (s.name === 'Overview' ? { ...s, source: overviewWithSignOut() } : s)),
  }
  const unit = generateHmiUnit(project)
  if (!unit.ok) throw new Error(unit.errors.map((e) => `${e.file}: ${e.message}`).join('\n'))
  const unitDir = join(out, 'unit')
  mkdirSync(unitDir, { recursive: true })
  for (const [name, text] of Object.entries(unit.files)) writeFileSync(join(unitDir, name), text)
  writeFileSync(
    join(unitDir, 'ids.h'),
    unit.elementIds.map((e) => `#define ID_${e.screen.toUpperCase()}_${e.element.toUpperCase()} ${e.id}`).join('\n') +
      '\n',
  )

  const fonts: Record<string, Uint8Array> = {}
  for (const file of readdirSync(FONT_DIR)) fonts[`fonts/${file}`] = new Uint8Array(readFileSync(join(FONT_DIR, file)))
  const faces = hmiFirmwareFaces(unit.fonts.faces, project.settings.pin.enabled)
  writeFileSync(join(out, 'fonts.c'), await hmiFontTableFromSources(faces, unit.fonts.variant, fonts))

  const panel = resolveHmiPanel({ width: 320, height: 240, density: 1, touch: true, colorFormat: 'rgb565' })
  if (!panel) throw new Error('the test panel does not validate')
  for (const [dir, testReadout] of [
    ['product', false],
    ['readout', true],
  ] as const) {
    mkdirSync(join(out, dir), { recursive: true })
    writeFileSync(join(out, dir, 'hmi_config.h'), hmiConfigHeader(panel, unit.fonts.variant, { testReadout }))
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
