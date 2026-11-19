import { readFileSync } from 'node:fs'
import { delimiter } from 'node:path'

import type { GsdmlCatalog } from '@root/middleware/shared/ports/gsdml-types'
import { buildGsdmlCatalogLookups } from '@root/middleware/shared/utils/profinet/gsdml-catalog-lookups'

import {
  catalogOf,
  countCatalogElements,
  COUNTED_ELEMENTS,
  countRawElements,
  noticesOf,
  unresolvedPlacements,
} from './fixtures/gsdml-fixtures'

const REAL_FILE_TIMEOUT_MS = 120_000

/** The real GSDML files named by the opt-in environment variables; none when they are unset. */
function realFilePaths(): string[] {
  const single = [process.env.OPENPLC_GSDML_ET200SP, process.env.OPENPLC_GSDML_XINJE]
  const extra = (process.env.OPENPLC_GSDML_EXTRA ?? '').split(delimiter)
  return [...single, ...extra].filter((path): path is string => path !== undefined && path.trim() !== '')
}

const REAL_FILES = realFilePaths()

if (REAL_FILES.length === 0) {
  describe.skip('parseGsdml: real GSDML files (set OPENPLC_GSDML_ET200SP, OPENPLC_GSDML_XINJE or OPENPLC_GSDML_EXTRA)', () => {
    it('parses each real file into a complete catalog', () => undefined)
  })
} else {
  describe.each(REAL_FILES)('parseGsdml: real GSDML file %s', (path) => {
    let xml = ''
    let catalog: GsdmlCatalog

    beforeAll(() => {
      xml = readFileSync(path, 'utf-8')
      catalog = catalogOf(xml)
    }, REAL_FILE_TIMEOUT_MS)

    it(
      'exposes each FR20 element as often as the raw text holds it, less the skipped objects',
      () => {
        const raw = countRawElements(xml)
        const exposed = countCatalogElements(catalog)
        const skipped = noticesOf(catalog, 'object-skipped').length
        for (const element of COUNTED_ELEMENTS) {
          if (skipped === 0) expect([element, exposed[element]]).toEqual([element, raw[element]])
          else expect([element, exposed[element] <= raw[element]]).toEqual([element, true])
        }
        expect(exposed.DeviceAccessPointItem).toBeGreaterThan(0)
      },
      REAL_FILE_TIMEOUT_MS,
    )

    it(
      'makes every device access point, module and submodule reachable by ident',
      () => {
        const lookups = buildGsdmlCatalogLookups(catalog)
        const unreachable = [
          ...catalog.deviceAccessPoints.filter(
            (dap) => !(lookups.dapsByIdent.get(dap.identNumber) ?? []).includes(dap),
          ),
          ...catalog.modules.filter((mod) => !(lookups.modulesByIdent.get(mod.identNumber) ?? []).includes(mod)),
          ...catalog.submodules.filter((sub) => !(lookups.submodulesByIdent.get(sub.identNumber) ?? []).includes(sub)),
        ].map((item) => item.id)
        expect(unreachable).toEqual([])
      },
      REAL_FILE_TIMEOUT_MS,
    )

    it(
      'resolves every placement to a catalog object or the target of a dangling-reference notice',
      () => {
        expect(unresolvedPlacements(catalog)).toEqual([])
      },
      REAL_FILE_TIMEOUT_MS,
    )
  })
}
