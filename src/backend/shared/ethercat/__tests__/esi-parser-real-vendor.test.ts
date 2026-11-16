/**
 * Parser checks against byte-exact excerpts of vendor ESI files (the first device and a
 * few modules cut from the shipped XML, nothing else edited). Hand-written fixtures hid
 * how real files encode padding, flags, InitCmds and slot classes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'

import { parseESIDeviceFull, parseESILight, parseESIModuleFull } from '../esi-parser-main'

const read = (name: string): string =>
  decodeXmlBytes(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'esi-real', name))))

const moduleByIdent = (file: string, ident: string) => {
  const r = parseESIModuleFull(read(file))
  if (!r.success) throw new Error(r.error)
  const m = r.modules?.find((x) => x.ident.toUpperCase() === ident.toUpperCase())
  if (m === undefined) throw new Error(`module ${ident} not in ${file}`)
  return m
}

describe('Weidmueller UR20 I/O module library (EtherCATModule root)', () => {
  test('light parse reads the decimal vendor id and plain class names', () => {
    const r = parseESILight(read('weidmueller-ur20-io.xml'))
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(Number(r.vendor?.id)).toBe(0x230)
    expect(r.modules?.map((m) => m.moduleClass).sort()).toEqual(['Ai', 'Di', 'Di', 'Do'])
  })

  test('UR20-4DI-P: fixed mandatory TxPDO, slot-dependent entries, padding kept unshifted', () => {
    const m = moduleByIdent('weidmueller-ur20-io.xml', '0x00091F84')
    expect(m.moduleClass).toBe('Di')
    expect(m.modulePdoGroup).toBe(1)
    const pdo = m.txPdo[0]
    expect(pdo).toMatchObject({ index: '0x1A00', fixed: true, mandatory: true, dependOnSlot: true })
    expect(pdo?.entries.map((e) => `${e.index}:${e.subIndex}:${e.bitLen}:${e.dependOnSlot === true}`)).toEqual([
      '0x6000:0x1:1:true',
      '0x6000:0x2:1:true',
      '0x6000:0x3:1:true',
      '0x6000:0x4:1:true',
      '0x0000:0x00:4:false',
      '0x6000:0x5:8:true',
    ])
  })

  test('UR20-4DI-P: both CoE InitCmds under <CoE> are read as byte strings with decimal sub-indices', () => {
    const m = moduleByIdent('weidmueller-ur20-io.xml', '0x00091F84')
    expect(m.initCmds).toEqual([
      expect.objectContaining({
        transition: 'PS',
        index: '0x8000',
        subIndex: 3,
        data: '0x555232302D3444492D50',
        dependOnSlot: true,
      }),
      expect.objectContaining({ index: '0x8000', subIndex: 10, data: '0x841F0900', dependOnSlot: true }),
    ])
  })
})

describe('Weidmueller UR20-FBC-EC coupler', () => {
  const xml = read('weidmueller-ur20-fbc.xml')

  test('coupler flags, slot classes, module groups and its own InitCmd', () => {
    const r = parseESIDeviceFull(xml, 0)
    if (!r.success || !r.device) throw new Error(r.error)
    const d = r.device
    expect(d.coeFlags).toEqual({ pdoAssign: false, pdoConfig: true, completeAccess: true })
    expect(d.isModularCoupler).toBe(true)
    expect(d.slots).toMatchObject({ slotIndexIncrement: 16, slotPdoIncrement: 1, downloadModuleIdentList: true })
    expect(d.slots?.slots[0]?.maxInstances).toBe(64)
    expect(d.slots?.slots[0]?.moduleClasses).toEqual(['Do', 'Di', 'Ao', 'Ai', 'Sf', 'Fc', 'SAI', 'IOLink', 'Ts'])
    expect(d.modulePdoGroups).toEqual([
      { group: 0, alignment: 1, sm: undefined, rxPdoIndex: '0x16FF', txPdoIndex: '0x1AFF' },
      { group: 1, alignment: 1, sm: undefined, rxPdoIndex: '0x1600', txPdoIndex: '0x1A00' },
    ])
    expect(d.initCmds).toEqual([expect.objectContaining({ index: '0xF810', subIndex: 1, data: '0x00100100' })])
  })

  test("the coupler's own status PDOs are Fixed and Mandatory", () => {
    const r = parseESIDeviceFull(xml, 0)
    if (!r.success || !r.device) throw new Error(r.error)
    expect(r.device.rxPdo.map((p) => [p.index, p.fixed, p.mandatory])).toEqual([['0x16FF', true, true]])
    expect(r.device.txPdo.map((p) => [p.index, p.fixed, p.mandatory])).toEqual([['0x1AFF', true, true]])
  })
})

describe('WAGO 750-354 coupler with inline module library', () => {
  const xml = read('wago-750-354.xml')

  test('no PdoAssign/PdoConfig, no ident-list download, `#x0` group PDOs read as absent', () => {
    const r = parseESIDeviceFull(xml, 0)
    if (!r.success || !r.device) throw new Error(r.error)
    expect(r.device.coeFlags).toEqual({ pdoAssign: false, pdoConfig: false, completeAccess: true })
    expect(r.device.slots?.downloadModuleIdentList).toBe(false)
    expect(r.device.slots?.slots[0]?.moduleClasses?.slice(0, 3)).toEqual(['750-DI', '750-DI_DIAG', '750-DO'])
    expect(r.device.modulePdoGroups?.map((g) => [g.group, g.rxPdoIndex, g.txPdoIndex])).toEqual([
      [0, undefined, undefined],
      [1, undefined, undefined],
      [2, '0x1701', '0x1B01'],
    ])
  })

  test('750-404: a "Gap" entry is padding whatever its name', () => {
    const m = moduleByIdent('wago-750-354.xml', '0x4043940')
    const out = m.rxPdo[0]
    expect(out?.fixed).toBe(true)
    expect(out?.entries.map((e) => [e.index, e.name, e.dataType])).toEqual([
      ['0x7000', 'Control', 'USINT'],
      ['0x0000', 'Gap', 'BIT'],
      ['0x7000', 'DWord 1', 'UDINT'],
    ])
  })
})

describe('Phoenix Contact AXL F BK EC (ISO-8859-1 files)', () => {
  test('coupler: SlotIndexIncrement 1 and ident-list download', () => {
    const r = parseESIDeviceFull(read('phoenix-axl-f-bk-ec.xml'), 0)
    if (!r.success || !r.device) throw new Error(r.error)
    expect(r.device.slots).toMatchObject({ slotIndexIncrement: 1, slotPdoIncrement: 1, downloadModuleIdentList: true })
    expect(r.device.slots?.slots[0]?.moduleClasses).toContain('DO_TERM')
  })

  test('module names and classes come through the declared encoding', () => {
    const m = moduleByIdent('phoenix-axl-f-io-modules.xml', '0x000D0D03')
    expect(m.moduleClass).toBe('DI_TERM')
    expect(m.name.startsWith('AXL F DI8/2 24DC 1F')).toBe(true)
    expect(m.txPdo[0]?.entries).toHaveLength(8)
  })
})

describe('Plain slaves are unaffected', () => {
  test('Beckhoff EK1818: fixed mandatory PDOs, no slots', () => {
    const r = parseESIDeviceFull(read('beckhoff-ek1818.xml'), 0)
    if (!r.success || !r.device) throw new Error(r.error)
    expect(r.device.isModularCoupler).toBe(false)
    expect(r.device.rxPdo.every((p) => p.fixed && p.mandatory)).toBe(true)
  })

  test('Delta ASDA-A2-E: PdoAssign drive, single-byte InitCmd data keeps its leading zero', () => {
    const r = parseESIDeviceFull(read('delta-asda2e.xml'), 0)
    if (!r.success || !r.device) throw new Error(r.error)
    expect(r.device.coeFlags?.pdoAssign).toBe(true)
    expect(r.device.initCmds?.[0]).toMatchObject({ index: '0x6060', subIndex: 0, data: '0x08' })
  })
})
