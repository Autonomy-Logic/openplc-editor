import { catalogOf } from '@root/backend/shared/profinet/__tests__/fixtures/gsdml-fixtures'
import type { GsdmlCatalog } from '@root/middleware/shared/ports/gsdml-types'

import { buildGsdmlCatalogLookups } from '../gsdml-catalog-lookups'

const HEADER =
  '<ISO15745Profile xmlns="http://www.profibus.com/GSDML/2003/11/DeviceProfile" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xsi:schemaLocation="http://www.profibus.com/GSDML/2003/11/DeviceProfile GSDML-DeviceProfile-v2.45.xsd">'

/** A synthetic GSDML document with the given ApplicationProcess content. */
function gsdml(applicationProcess: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    HEADER,
    '<ProfileBody>',
    '<DeviceIdentity VendorID="0x0F20" DeviceID="0x0001"><VendorName Value="Lookup Vendor" /></DeviceIdentity>',
    `<ApplicationProcess>${applicationProcess}</ApplicationProcess>`,
    '</ProfileBody>',
    '</ISO15745Profile>',
  ].join('\n')
}

/** A device access point element with the given ID and ident number. */
const dap = (id: string, ident: string): string =>
  `<DeviceAccessPointItem ID="${id}" PhysicalSlots="0..2" ModuleIdentNumber="${ident}" FixedInSlots="0" />`

const DUPLICATES = gsdml(
  [
    `<DeviceAccessPointList>${dap('D1', '0x0010')}${dap('D2', '0x00000010')}${dap('D3', '0x0011')}</DeviceAccessPointList>`,
    '<ModuleList>',
    '<ModuleItem ID="M1" ModuleIdentNumber="0x0020"><VirtualSubmoduleList>',
    '<VirtualSubmoduleItem ID="V1" SubmoduleIdentNumber="0x0030" /></VirtualSubmoduleList></ModuleItem>',
    '<ModuleItem ID="M2" ModuleIdentNumber="0x20" />',
    '<ModuleItem ID="M3" ModuleIdentNumber="0x0021" />',
    '</ModuleList>',
    '<SubmoduleList>',
    '<SubmoduleItem ID="S1" SubmoduleIdentNumber="0x0030" />',
    '<SubmoduleItem ID="S2" SubmoduleIdentNumber="0x00000030" />',
    '<PortSubmoduleItem ID="P1" SubmoduleIdentNumber="0x0031" />',
    '<PortSubmoduleItem ID="P2" SubmoduleIdentNumber="0x0030" />',
    '</SubmoduleList>',
  ].join(''),
)

/** The ids of the items, sorted. */
function sortedIds(items: readonly { id: string }[] | undefined): string[] {
  return (items ?? []).map((item) => item.id).sort()
}

describe('buildGsdmlCatalogLookups', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    catalog = catalogOf(DUPLICATES)
  })

  it('finds each device access point, module and SubmoduleList entry by its ID, as the catalog object', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    for (const item of catalog.deviceAccessPoints) expect(lookups.dapById.get(item.id)).toBe(item)
    for (const item of catalog.modules) expect(lookups.moduleById.get(item.id)).toBe(item)
    for (const item of catalog.submodules) expect(lookups.submoduleById.get(item.id)).toBe(item)
    expect([lookups.dapById.size, lookups.moduleById.size]).toEqual([3, 3])
  })

  it('indexes every submodule kind of the SubmoduleList by ID and nothing else', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    expect([...lookups.submoduleById.keys()].sort()).toEqual(['P1', 'P2', 'S1', 'S2'])
    expect(lookups.submoduleById.get('P1')?.kind).toBe('port')
    expect(lookups.submoduleById.has('V1')).toBe(false)
  })

  it('groups device access points by normalised ident number, duplicates included', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    expect(sortedIds(lookups.dapsByIdent.get('0x10'))).toEqual(['D1', 'D2'])
    expect(sortedIds(lookups.dapsByIdent.get('0x11'))).toEqual(['D3'])
    expect(lookups.dapsByIdent.size).toBe(2)
  })

  it('groups modules by normalised ident number, duplicates included', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    expect(sortedIds(lookups.modulesByIdent.get('0x20'))).toEqual(['M1', 'M2'])
    expect(sortedIds(lookups.modulesByIdent.get('0x21'))).toEqual(['M3'])
    expect(lookups.modulesByIdent.size).toBe(2)
  })

  it('groups every submodule kind of the SubmoduleList by normalised ident number, duplicates included', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    expect(sortedIds(lookups.submodulesByIdent.get('0x30'))).toEqual(['P2', 'S1', 'S2'])
    expect(sortedIds(lookups.submodulesByIdent.get('0x31'))).toEqual(['P1'])
    expect(lookups.submodulesByIdent.size).toBe(2)
  })

  it('returns the catalog objects themselves in the ident groups', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    for (const item of catalog.modules) expect(lookups.modulesByIdent.get(item.identNumber)).toContain(item)
    for (const item of catalog.submodules) expect(lookups.submodulesByIdent.get(item.identNumber)).toContain(item)
  })

  it('leaves the catalog unchanged', () => {
    const before = JSON.stringify(catalog)
    buildGsdmlCatalogLookups(catalog)
    expect(JSON.stringify(catalog)).toBe(before)
  })

  it('returns empty lookups for a catalog with no device access point, module or submodule', () => {
    const lookups = buildGsdmlCatalogLookups(catalogOf(gsdml('<DeviceAccessPointList></DeviceAccessPointList>')))
    expect([
      lookups.dapById.size,
      lookups.moduleById.size,
      lookups.submoduleById.size,
      lookups.dapsByIdent.size,
      lookups.modulesByIdent.size,
      lookups.submodulesByIdent.size,
    ]).toEqual([0, 0, 0, 0, 0, 0])
  })
})
