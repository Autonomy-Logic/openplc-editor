/**
 * Writes the HMI font table for the C tests through the real font build step.
 * Usage: ts-node tests/hmi-core/font-table.ts <out.c> [faces] [variant]
 *   faces: "all" (default), "regular" or "none"; variant: "full" or "compact" (default).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildHmiFontTableSource, type HmiFontBytes } from '../../src/backend/shared/hmi/fonts/font-table-source'
import {
  DEFAULT_HMI_FONT_VARIANT,
  HMI_FONT_REGULAR,
  type HmiFontVariant,
  VETTED_HMI_FONTS,
} from '../../src/backend/shared/hmi/fonts/vetted-fonts'

function isVariant(v: string): v is HmiFontVariant {
  return v === 'full' || v === 'compact'
}

const FONT_DIR = join(__dirname, '..', '..', 'resources', 'sources', 'hmi', 'fonts')

async function main(): Promise<void> {
  const [out, faces = 'all', variant = DEFAULT_HMI_FONT_VARIANT] = process.argv.slice(2)
  if (!out || !['all', 'regular', 'none'].includes(faces) || !isVariant(variant))
    throw new Error('usage: font-table.ts <out.c> [all|regular|none] [full|compact]')
  const chosen = VETTED_HMI_FONTS.filter(
    (f) => f.variant === variant && (faces === 'all' || (faces === 'regular' && f.id === HMI_FONT_REGULAR)),
  )
  const fonts: HmiFontBytes[] = chosen.map((f) => ({
    id: f.id,
    variant: f.variant,
    bytes: new Uint8Array(readFileSync(join(FONT_DIR, f.file))),
  }))
  writeFileSync(out, await buildHmiFontTableSource(fonts))
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
