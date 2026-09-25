/**
 * Driven against the real CiA 402 ESI fixture, not a hand-written stub: the
 * whole point of this module is that the channels, PDOs and SDOs come out of a
 * vendor file. A stub would only prove the spread operators work.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { normalizeEthercatSlave } from '../normalize-ethercat-slave'
import type { SpecEtherCATSlave } from '../types'

const XML = readFileSync(join(__dirname, '../../ethercat/__tests__/fixtures/cia402-servo-esi.xml'), 'utf8')

const build = (spec: SpecEtherCATSlave, overrides: Partial<Parameters<typeof normalizeEthercatSlave>[0]> = {}) =>
  normalizeEthercatSlave({
    spec,
    xml: XML,
    usedAddresses: new Set<string>(),
    takenNames: new Set<string>(),
    fallbackPosition: 0,
    id: 'slave-1',
    ...overrides,
  })

const ref = { repositoryItemId: 'oss-servo', deviceIndex: 0 }

describe('authoring a slave from a real ESI file', () => {
  it('carries the vendor, product and revision off the file', () => {
    const result = build({ esiDeviceRef: ref })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The parser normalizes the ESI's `#x` literals to `0x`, so these are the
    // bytes that reach the runtime's startup checks.
    expect(result.value.vendorId).toBe('0x00000B95')
    expect(result.value.productCode).toBe('0x00020192')
    expect(result.value.revisionNo).toBe('0x42')
    expect(result.value.addedFrom).toBe('repository')
  })

  it('produces channel mappings with IEC locations', () => {
    const result = build({ esiDeviceRef: ref })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.channelMappings.length).toBeGreaterThan(0)
    for (const mapping of result.value.channelMappings) {
      expect(mapping.iecLocation).toMatch(/^%[IQ][XBWDL]\d+/)
    }
  })

  it('carries the PDOs and channel info the runtime binds to', () => {
    const result = build({ esiDeviceRef: ref })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.rxPdos?.length).toBeGreaterThan(0)
    expect(result.value.txPdos?.length).toBeGreaterThan(0)
    expect(result.value.channelInfo?.length).toBe(result.value.channelMappings.length)
  })

  it('recognizes the CiA 402 drive and gives it a legal axis name', () => {
    const result = build({ esiDeviceRef: ref })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.cia402?.enabled).toBe(true)
    // A SoftMotion axis name becomes an IEC identifier.
    expect(result.value.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })

  it('never reuses an address across two slaves on the same bus', () => {
    const usedAddresses = new Set<string>()
    const takenNames = new Set<string>()
    const first = build({ esiDeviceRef: ref }, { usedAddresses, takenNames, id: 'a' })
    const second = build({ esiDeviceRef: ref }, { usedAddresses, takenNames, id: 'b', fallbackPosition: 1 })

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const firstLocations = first.value.channelMappings.map((m) => m.iecLocation)
    const secondLocations = second.value.channelMappings.map((m) => m.iecLocation)
    expect(firstLocations.some((location) => secondLocations.includes(location))).toBe(false)
    expect(second.value.name).not.toBe(first.value.name)
  })

  it('takes the name, position and slave config the spec overrides', () => {
    const result = build({
      esiDeviceRef: ref,
      name: 'Axis1',
      position: 7,
      config: { addressing: { ethercatAddress: 1002 }, timeouts: { sdoTimeoutMs: 2500 } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.name).toBe('Axis1')
    expect(result.value.position).toBe(7)
    expect(result.value.config.addressing.ethercatAddress).toBe(1002)
    expect(result.value.config.timeouts.sdoTimeoutMs).toBe(2500)
    // An override of one field leaves its siblings at the default.
    expect(result.value.config.startupChecks.checkVendorId).toBe(true)
  })

  it('applies an alias to the channel it names, and only that one', () => {
    const plain = build({ esiDeviceRef: ref })
    expect(plain.ok).toBe(true)
    if (!plain.ok) return
    const channelId = plain.value.channelMappings[0].channelId

    const result = build({ esiDeviceRef: ref, aliases: { [channelId]: 'DriveStatus' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.channelMappings[0].alias).toBe('DriveStatus')
    expect(result.value.channelMappings.filter((m) => m.alias === 'DriveStatus')).toHaveLength(1)
  })

  it('turns CiA 402 off when the spec says so', () => {
    const result = build({ esiDeviceRef: ref, name: 'Drive One', cia402: { enabled: false } })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.cia402?.enabled).toBe(false)
    // Not an axis any more, so the name is left as written.
    expect(result.value.name).toBe('Drive One')
  })

  it('reports a device index the file does not have', () => {
    const result = build({ esiDeviceRef: { repositoryItemId: 'oss-servo', deviceIndex: 99 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('could not read device 99')
  })

  it('reports an ESI file that is not ESI at all', () => {
    const result = build({ esiDeviceRef: ref }, { xml: '<nope/>' })
    expect(result.ok).toBe(false)
  })
})
