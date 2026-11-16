/**
 * Every module in a vendor's own ESI must pass the coupler's `<Slots>` check, or the module
 * browser and the scan apply would hide valid modules.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'
import {
  canonicalVendorId,
  isModuleCompatibleWithCoupler,
} from '@root/middleware/shared/utils/ethercat/module-compatibility'

import { parseESIDeviceFull, parseESILight } from '../esi-parser-main'

const read = (name: string): string =>
  decodeXmlBytes(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'esi-real', name))))

const stations: Array<{ coupler: string; modules: string }> = [
  { coupler: 'weidmueller-ur20-fbc.xml', modules: 'weidmueller-ur20-io.xml' },
  { coupler: 'wago-750-354.xml', modules: 'wago-750-354.xml' },
  { coupler: 'phoenix-axl-f-bk-ec.xml', modules: 'phoenix-axl-f-io-modules.xml' },
]

describe.each(stations)('$coupler accepts every module of $modules', ({ coupler, modules }) => {
  test('vendor and slot class or ident', () => {
    const device = parseESIDeviceFull(read(coupler), 0)
    const light = parseESILight(read(modules))
    if (!device.success || device.device === undefined || !light.success) throw new Error('fixture parse failed')
    const vendorId = light.vendor?.id ?? ''
    const list = light.modules ?? []
    expect(list.length).toBeGreaterThan(0)
    const rejected = list.filter(
      (m) =>
        !isModuleCompatibleWithCoupler({ vendor: { id: vendorId, name: '' } }, m, {
          vendorId,
          slots: device.device?.slots,
        }),
    )
    expect(rejected.map((m) => `${m.ident} ${m.moduleClass ?? ''}`)).toEqual([])
  })
})

describe('module compatibility gates', () => {
  test('vendor ids compare across notations', () => {
    expect(canonicalVendorId('#x230')).toBe('0x00000230')
    expect(canonicalVendorId('0x00000230')).toBe('0x00000230')
    expect(canonicalVendorId('560')).toBe('0x00000230')
    expect(canonicalVendorId(' junk ')).toBe('junk')
  })

  test('another vendor, or a class no slot accepts, is refused', () => {
    const slots = {
      slots: [{ minInstances: 0, maxInstances: 8, moduleClasses: ['Di'] }],
      slotIndexIncrement: 16,
      slotPdoIncrement: 1,
      downloadModuleIdentList: true,
    }
    const repo = { vendor: { id: '0x230', name: 'W' } }
    expect(isModuleCompatibleWithCoupler(repo, { ident: '0x1', moduleClass: 'Di' }, { vendorId: '#x21', slots })).toBe(
      false,
    )
    expect(isModuleCompatibleWithCoupler(repo, { ident: '0x1', moduleClass: 'Ai' }, { vendorId: '560', slots })).toBe(
      false,
    )
    expect(isModuleCompatibleWithCoupler(repo, { ident: '0x1', moduleClass: 'Di' }, { vendorId: '560', slots })).toBe(
      true,
    )
  })
})
