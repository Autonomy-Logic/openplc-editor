/**
 * Enrichment tests.
 *
 * Covers the data the enrichment path lifts from a parsed ESIDevice into the shape the
 * composer puts on the project: CoE flags (so a fresh device starts with the correct
 * CoE flags and does not look like an older save) and the `isModularCoupler` marker
 * (so the UI can offer the "Add module to slot N" affordance before any module is
 * attached). The composer tests at the UI level verify that `coeFlags` actually lands
 * on `device.config.coeFlags`; this file verifies the pure helper.
 */

import type { ConfiguredEtherCATDevice, ESIDevice } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { enrichDeviceData, esiStartupData, lacksPdoFlags, lacksEsiStartupData } from '../enrich-device-data'
import { parseESIDeviceFull } from '../esi-parser-main'

const MODULAR_COUPLER_ESI = `<?xml version="1.0" encoding="UTF-8"?>
<EtherCATInfo>
  <Vendor><Id>#x00000230</Id><Name>Weidmueller</Name></Vendor>
  <Descriptions>
    <Devices>
      <Device Physics="YY">
        <Type ProductCode="#x1334910000" RevisionNo="#x00000001">UR20-FBC-EC</Type>
        <Name>UR20-FBC-EC</Name>
        <Mailbox><CoE PdoAssign="0" PdoConfig="1" CompleteAccess="1"/></Mailbox>
        <Slots SlotIndexIncrement="16" SlotPdoIncrement="1" MaxSlotCount="64">
          <Slot MinInstances="0" MaxInstances="64"><Name>I/O slot</Name></Slot>
        </Slots>
      </Device>
    </Devices>
  </Descriptions>
</EtherCATInfo>`

const PLAIN_DRIVE_ESI = `<?xml version="1.0" encoding="UTF-8"?>
<EtherCATInfo>
  <Vendor><Id>#x000001DD</Id><Name>Delta Electronics</Name></Vendor>
  <Descriptions>
    <Devices>
      <Device Physics="YY">
        <Type ProductCode="#x10305070" RevisionNo="#x02040608">ASDA-A2-E</Type>
        <Name>ASDA-A2-E</Name>
        <Mailbox><CoE PdoAssign="1" PdoConfig="1" CompleteAccess="0"/></Mailbox>
      </Device>
    </Devices>
  </Descriptions>
</EtherCATInfo>`

const esiFrom = (xml: string): ESIDevice => {
  const r = parseESIDeviceFull(xml, 0)
  if (!r.success || !r.device) throw new Error('fixture parse failed')
  return r.device
}

describe('enrichDeviceData returns the ESI extensions', () => {
  test('coeFlags are lifted from the ESI mailbox and included on the enrichment', () => {
    const enriched = enrichDeviceData(esiFrom(PLAIN_DRIVE_ESI))
    expect(enriched.coeFlags).toEqual({ pdoAssign: true, pdoConfig: true, completeAccess: false })
  })

  test('a modular coupler ESI emits isModularCoupler = true on the enrichment', () => {
    const enriched = enrichDeviceData(esiFrom(MODULAR_COUPLER_ESI))
    expect(enriched.isModularCoupler).toBe(true)
    expect(enriched.coeFlags).toEqual({ pdoAssign: false, pdoConfig: true, completeAccess: true })
  })

  test('a plain-slave ESI emits isModularCoupler = false', () => {
    const enriched = enrichDeviceData(esiFrom(PLAIN_DRIVE_ESI))
    expect(enriched.isModularCoupler).toBe(false)
  })
})

describe('freshly added device does not look like an older save', () => {
  test('a device whose config carries the enriched coeFlags does not satisfy lacksPdoFlags', () => {
    const enriched = enrichDeviceData(esiFrom(PLAIN_DRIVE_ESI))
    // What the composer builds: default config + coeFlags from enrichment.
    const device = {
      id: 'd',
      name: 'd',
      esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
      vendorId: '0x1DD',
      productCode: '0x10305070',
      revisionNo: '0x02040608',
      addedFrom: 'repository' as const,
      channelMappings: [],
      config: { ...createDefaultSlaveConfig(), coeFlags: enriched.coeFlags },
      rxPdos: enriched.rxPdos,
      txPdos: enriched.txPdos,
    }
    expect(lacksPdoFlags(device)).toBe(false)
  })
})

describe('a slave saved without the ESI startup data gets it back on open', () => {
  const device = (over: Partial<ConfiguredEtherCATDevice> = {}): ConfiguredEtherCATDevice => ({
    id: 'c',
    name: 'c',
    esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
    vendorId: '0x230',
    productCode: '0x1',
    revisionNo: '0x1',
    addedFrom: 'repository',
    config: createDefaultSlaveConfig(),
    channelMappings: [],
    ...over,
  })

  test('a modular coupler without slotsSpec needs it; one with it does not', () => {
    const esi = esiFrom(MODULAR_COUPLER_ESI)
    expect(lacksEsiStartupData(device(), esi)).toBe(true)
    const refill = esiStartupData(esi)
    expect(refill.slotsSpec?.slots[0]?.maxInstances).toBe(64)
    expect(lacksEsiStartupData(device(refill), esi)).toBe(false)
  })

  test('a plain slave without InitCmds needs nothing', () => {
    expect(lacksEsiStartupData(device(), esiFrom(PLAIN_DRIVE_ESI))).toBe(false)
  })

  test('InitCmds listing several transitions keep all of them', () => {
    const xml = PLAIN_DRIVE_ESI.replace(
      '<Mailbox><CoE PdoAssign="1" PdoConfig="1" CompleteAccess="0"/></Mailbox>',
      `<Mailbox><CoE PdoAssign="1" PdoConfig="1" CompleteAccess="0"><InitCmd><Transition>IP</Transition><Transition>PS</Transition><Index>#x6060</Index><SubIndex>0</SubIndex><Data>08</Data></InitCmd></CoE></Mailbox>`,
    )
    const esi = esiFrom(xml)
    expect(esi.initCmds?.[0]?.transition).toBe('IP,PS')
    expect(lacksEsiStartupData(device(), esi)).toBe(true)
    expect(esiStartupData(esi).esiInitCmdSdos?.[0]).toMatchObject({ transition: 'IP,PS', valueBytes: '0x08' })
  })
})
