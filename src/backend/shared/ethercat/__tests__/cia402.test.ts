// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'


import {
  CIA402_OBJECTS,
  DEFAULT_CIA402_AXIS_CONFIG,
  isCia402Drive,
  normalizeObjectIndex,
  resolveCia402Objects,
} from '../cia402'
import { enrichDeviceData } from '../enrich-device-data'
import { parseESIDeviceFull } from '../esi-parser-main'

const ESI_XML = readFileSync(
  resolve(__dirname, 'fixtures/cia402-servo-esi.xml'),
  'utf-8',
)

function loadDevice() {
  const result = parseESIDeviceFull(ESI_XML, 0)
  expect(result.success).toBe(true)
  expect(result.device).toBeDefined()
  return result.device!
}

describe('cia402 recognition', () => {
  it('normalizes object indices in every ESI notation', () => {
    expect(normalizeObjectIndex('#x6040')).toBe(0x6040)
    expect(normalizeObjectIndex('0x6040')).toBe(0x6040)
    expect(normalizeObjectIndex('6040')).toBe(0x6040)
    expect(normalizeObjectIndex(0x6040)).toBe(0x6040)
    expect(normalizeObjectIndex('bogus')).toBe(-1)
  })

  it('recognizes a real CiA 402 servo ESI as a SoftMotion drive', () => {
    const device = loadDevice()
    expect(isCia402Drive(device)).toBe(true)
  })

  it('does not recognize a device lacking the mandatory objects', () => {
    const device = loadDevice()
    // strip Controlword (0x6040) from the RxPDOs → no longer a valid axis
    const stripped = {
      ...device,
      rxPdo: device.rxPdo.map((p) => ({
        ...p,
        entries: p.entries.filter((e) => normalizeObjectIndex(e.index) !== 0x6040),
      })),
    }
    expect(isCia402Drive(stripped)).toBe(false)
  })

  it('resolves CiA 402 objects to editor-allocated IEC addresses', () => {
    const device = loadDevice()
    const enriched = enrichDeviceData(device)
    const resolved = resolveCia402Objects(enriched.channelInfo, enriched.channelMappings)

    const byRole = Object.fromEntries(resolved.map((r) => [r.role, r]))
    // The real fixture maps: 0x6040 Controlword, 0x607A Target position (out);
    // 0x6041 Statusword, 0x6064 Position actual (in).
    expect(byRole.controlWord).toBeDefined()
    expect(byRole.statusWord).toBeDefined()
    expect(byRole.targetPosition).toBeDefined()
    expect(byRole.positionActual).toBeDefined()

    // Controlword is a 16-bit output → %Q word address, WORD/UINT type.
    expect(byRole.controlWord.iecLocation).toMatch(/^%Q/)
    expect(byRole.statusWord.iecLocation).toMatch(/^%I/)
    // Every resolved object carries a concrete address + IEC type.
    for (const r of resolved) {
      expect(r.iecLocation).toMatch(/^%[IQ]/)
      expect(r.iecType).toMatch(/\S/)
    }
  })

  it('omits CiA 402 objects that have no channel mapping', () => {
    const device = loadDevice()
    const enriched = enrichDeviceData(device)
    // Channel info present, but no address mappings → nothing resolves.
    expect(resolveCia402Objects(enriched.channelInfo, [])).toEqual([])
  })

  it('defines the single-axis CiA 402 object set including mandatory objects', () => {
    // Controlword + Statusword must be in the object table.
    const indices = CIA402_OBJECTS.map((o) => o.index)
    expect(indices).toContain(0x6040)
    expect(indices).toContain(0x6041)
    expect(DEFAULT_CIA402_AXIS_CONFIG.enabled).toBe(true)
    expect(DEFAULT_CIA402_AXIS_CONFIG.scaleFactor).toBe(1)
  })
})
