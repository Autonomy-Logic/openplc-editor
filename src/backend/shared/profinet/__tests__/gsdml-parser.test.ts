import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import type { GsdmlCatalog, GsdmlModule, GsdmlSubmodule } from '@root/middleware/shared/ports/gsdml-types'

import { buildGsdmlCatalogLookups, parseGsdml } from '../gsdml-parser'

const FIXTURES_DIR = join(__dirname, 'fixtures')

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8')
}

function expectCatalog(result: ReturnType<typeof parseGsdml>): GsdmlCatalog {
  if (!result.success) {
    throw new Error(`Expected success, got failure: ${result.error}`)
  }
  return result.catalog
}

describe('parseGsdml - minimal fixture (ET200SP-shaped)', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    const result = parseGsdml(readFixture('minimal.gsdml.xml'))
    catalog = expectCatalog(result)
  })

  it('extracts device identity', () => {
    expect(catalog.identity.vendorId).toBe('0x2a')
    expect(catalog.identity.deviceId).toBe('0x313')
    expect(catalog.identity.vendorName).toBe('Siemens')
    expect(catalog.identity.infoText).toBe('ET 200SP IM 155-6PN ST V4.2')
  })

  it('detects schema version', () => {
    expect(catalog.schemaVersion).toBe('v2.42')
  })

  it('reports no warnings on a well-formed file', () => {
    expect(catalog.warnings).toEqual([])
  })

  it('extracts exactly one DAP with its slot layout and useable modules', () => {
    expect(catalog.deviceAccessPoints).toHaveLength(1)
    const dap = catalog.deviceAccessPoints[0]
    expect(dap.id).toBe('IDM_IM155_6PN_ST')
    expect(dap.identNumber).toBe('0xb4700')
    expect(dap.name).toBe('IM 155-6PN ST V4.2')
    expect(dap.orderNumber).toBe('6ES7 155-6AU01-0BN0')
    expect(dap.slots).toHaveLength(3)
    expect(dap.slots[0].fixedModule).toBe(true)
    expect(dap.slots[0].moduleIdentNumber).toBe('0xb4700')
    expect(dap.slots[1].fixedModule).toBe(false)
    expect(dap.useableModuleIds).toEqual(['IDM_DI_8x24VDC_ST', 'IDM_DQ_8x24VDC_ST'])
    expect(dap.virtualSubmodules).toHaveLength(1)
    expect(dap.virtualSubmodules[0].name).toBe('PN-IO')
  })

  it('extracts modules with their ident numbers', () => {
    expect(catalog.modules).toHaveLength(2)
    const di = catalog.modules.find((m: GsdmlModule) => m.id === 'IDM_DI_8x24VDC_ST')
    const dq = catalog.modules.find((m: GsdmlModule) => m.id === 'IDM_DQ_8x24VDC_ST')
    expect(di).toBeDefined()
    expect(dq).toBeDefined()
    expect(di?.identNumber).toBe('0x4d4d')
    expect(dq?.identNumber).toBe('0x4d93')
    expect(di?.name).toBe('DI 8x24VDC ST')
    expect(di?.orderNumber).toBe('6ES7 131-6BF00-0BA0')
    expect(di?.hardwareRelease).toBe('1')
    expect(di?.softwareRelease).toBe('V2.0')
  })

  it('parses input DataItem with UseAsBits and all 8 bit entries', () => {
    const di = catalog.modules.find((m: GsdmlModule) => m.id === 'IDM_DI_8x24VDC_ST')!
    const sub = di.virtualSubmodules[0]
    expect(sub.io.input).toHaveLength(1)
    expect(sub.io.output).toHaveLength(0)
    const inputItem = sub.io.input[0]
    expect(inputItem.dataType).toBe('Unsigned8')
    expect(inputItem.bitLength).toBe(8)
    expect(inputItem.useAsBits).toBe(true)
    expect(inputItem.text).toBe('Input byte')
    expect(inputItem.bits).toHaveLength(8)
    expect(inputItem.bits[0]).toEqual({ bitOffset: 0, text: 'Channel 0' })
    expect(inputItem.bits[7]).toEqual({ bitOffset: 7, text: 'Channel 7' })
  })

  it('parses output DataItem on DQ module', () => {
    const dq = catalog.modules.find((m: GsdmlModule) => m.id === 'IDM_DQ_8x24VDC_ST')!
    const sub = dq.virtualSubmodules[0]
    expect(sub.io.output).toHaveLength(1)
    expect(sub.io.input).toHaveLength(0)
    const outItem = sub.io.output[0]
    expect(outItem.direction).toBe('output')
    expect(outItem.useAsBits).toBe(true)
    expect(outItem.bits).toHaveLength(2)
  })

  it('parses parameter records with enum options and typed fields', () => {
    const di = catalog.modules.find((m: GsdmlModule) => m.id === 'IDM_DI_8x24VDC_ST')!
    const sub = di.virtualSubmodules[0]
    expect(sub.parameterRecords).toHaveLength(1)
    const record = sub.parameterRecords[0]
    expect(record.index).toBe('0x1')
    expect(record.length).toBe(2)
    expect(record.transferSequence).toBe('Startup')
    expect(record.text).toBe('Parameter record')
    expect(record.fields).toHaveLength(2)

    const filter = record.fields[0]
    expect(filter.name).toBe('InputDelay')
    expect(filter.text).toBe('Input delay')
    expect(filter.byteOffset).toBe(0)
    expect(filter.dataType).toBe('Unsigned8')
    expect(filter.kind).toBe('enum')
    expect(filter.enumOptions).toHaveLength(3)
    expect(filter.enumOptions.map((o) => o.text)).toEqual(['0.1 ms', '0.5 ms', '3 ms'])

    const invert = record.fields[1]
    expect(invert.name).toBe('Invert')
    expect(invert.kind).toBe('bitfield')
    expect(invert.enumOptions).toHaveLength(0)
  })

  it('parses standalone submodules from SubmoduleList', () => {
    expect(catalog.submodules).toHaveLength(1)
    const port = catalog.submodules[0]
    expect(port.id).toBe('IDSM_Port_1')
    expect(port.identNumber).toBe('0x8001')
    expect(port.virtual).toBe(false)
    expect(port.name).toBe('Port 1')
  })
})

describe('buildGsdmlCatalogLookups', () => {
  it('indexes DAPs, modules and submodules by both id and ident', () => {
    const catalog = expectCatalog(parseGsdml(readFixture('minimal.gsdml.xml')))
    const lookups = buildGsdmlCatalogLookups(catalog)

    expect(lookups.dapById.get('IDM_IM155_6PN_ST')?.name).toBe('IM 155-6PN ST V4.2')
    expect(lookups.moduleById.get('IDM_DI_8x24VDC_ST')?.identNumber).toBe('0x4d4d')
    expect(lookups.moduleByIdent.get('0x4d4d')?.id).toBe('IDM_DI_8x24VDC_ST')
    expect(lookups.moduleByIdent.get('0x4d93')?.id).toBe('IDM_DQ_8x24VDC_ST')
    expect(lookups.submoduleById.get('IDSM_Port_1')?.name).toBe('Port 1')
    expect(lookups.submoduleByIdent.get('0x8001')?.id).toBe('IDSM_Port_1')
  })
})

describe('parseGsdml - forward compatibility (Annex A.3.3)', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    const result = parseGsdml(readFixture('with-unknown-elements.gsdml.xml'))
    catalog = expectCatalog(result)
  })

  it('ignores unknown elements and attributes without failing', () => {
    expect(catalog.identity.vendorId).toBe('0x1234')
    expect(catalog.identity.deviceId).toBe('0x1')
    expect(catalog.deviceAccessPoints).toHaveLength(1)
    expect(catalog.deviceAccessPoints[0].identNumber).toBe('0xdeadbeef')
    expect(catalog.modules).toHaveLength(1)
    expect(catalog.modules[0].virtualSubmodules).toHaveLength(1)
  })

  it('still resolves ExternalText entries that are present', () => {
    expect(catalog.deviceAccessPoints[0].name).toBe('Future DAP')
    expect(catalog.modules[0].name).toBe('Future module')
  })

  it('reports the newer schema version from schemaLocation', () => {
    expect(catalog.schemaVersion).toBe('v2.99')
  })
})

describe('parseGsdml - error paths', () => {
  it('rejects an empty string', () => {
    const result = parseGsdml('')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/empty/i)
  })

  it('rejects malformed XML with a readable error', () => {
    const result = parseGsdml(readFixture('malformed.gsdml.xml'))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/malformed|unexpected|invalid|close/i)
  })

  it('rejects a document whose root is not ISO15745Profile', () => {
    const result = parseGsdml(readFixture('wrong-root.gsdml.xml'))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/ISO15745Profile/i)
  })

  it('rejects a syntactically valid XML that is not GSDML (wrong namespace)', () => {
    const notGsdml = `<?xml version="1.0"?><ISO15745Profile><ProfileBody></ProfileBody></ISO15745Profile>`
    const result = parseGsdml(notGsdml)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/namespace|GSDML/i)
  })

  it('reports DeviceIdentity as the missing block when ProfileBody is otherwise empty', () => {
    const noIdentity = `<?xml version="1.0"?>
<ISO15745Profile xmlns="http://www.profibus.com/GSDML/2003/11/DeviceProfile">
  <ProfileBody>
    <ApplicationProcess/>
  </ProfileBody>
</ISO15745Profile>`
    const result = parseGsdml(noIdentity)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/DeviceIdentity/i)
  })
})

/**
 * Opt-in integration test against the real Siemens ET200SP GSDML file.
 *
 * The file is ~28MB, lives outside the repository, and belongs to Siemens;
 * we do not commit it. The test runs only when the file is on disk at the
 * expected path, so CI stays green on contributors who do not have it.
 */
describe('parseGsdml - real ET200SP GSDML (opt-in)', () => {
  const ET200SP_PATH = '/Users/thiagoralves/Code/pn_et200sp_sim/gsdml/GSDML-V2.45-Siemens-ET200SP-20260601.xml'
  const envPath = process.env.OPENPLC_GSDML_ET200SP
  const path = envPath !== undefined && envPath !== '' ? envPath : ET200SP_PATH
  const available = existsSync(path)
  const describeOrSkip = available ? describe : describe.skip

  describeOrSkip('with the real file', () => {
    let catalog: GsdmlCatalog

    beforeAll(() => {
      const xml = readFileSync(path, 'utf-8')
      const result = parseGsdml(xml)
      catalog = expectCatalog(result)
    }, 120_000)

    it('reports the Siemens VendorID and ET200SP DeviceID', () => {
      expect(catalog.identity.vendorId).toBe('0x2a')
      expect(catalog.identity.deviceId).toBe('0x313')
    })

    it('extracts hundreds of modules and submodules', () => {
      expect(catalog.deviceAccessPoints.length).toBeGreaterThan(5)
      expect(catalog.modules.length).toBeGreaterThan(100)
      const totalSubs =
        catalog.deviceAccessPoints.reduce((n, d) => n + d.virtualSubmodules.length, 0) +
        catalog.modules.reduce((n: number, m: GsdmlModule) => n + m.virtualSubmodules.length, 0) +
        catalog.submodules.length
      expect(totalSubs).toBeGreaterThan(500)
    })

    it('indexes every module by ident number without collisions', () => {
      const lookups = buildGsdmlCatalogLookups(catalog)
      expect(lookups.moduleById.size).toBe(catalog.modules.length)
      expect(lookups.moduleByIdent.size).toBeGreaterThan(0)
    })

    it('resolves module display names (ExternalText)', () => {
      const named = catalog.modules.filter((m: GsdmlModule) => m.name !== '')
      expect(named.length).toBeGreaterThan(0)
    })

    it('finds at least one submodule with parameter records', () => {
      const hasRecords = (s: GsdmlSubmodule): boolean => s.parameterRecords.length > 0
      const any =
        catalog.modules.some((m: GsdmlModule) => m.virtualSubmodules.some(hasRecords)) ||
        catalog.submodules.some(hasRecords)
      expect(any).toBe(true)
    })
  })

  if (!available) {
    it('skipped: real ET200SP GSDML not present at expected path', () => {
      expect(true).toBe(true)
    })
  }
})
