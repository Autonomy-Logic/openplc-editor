/**
 * DOPE-704 E1 enrichment tests.
 *
 * Covers the data the enrichment path lifts from a parsed ESIDevice into the shape the
 * composer puts on the project: CoE flags (so a fresh device starts with the correct
 * E2 flags and does not look like a pre-E2 project) and the `isModularCoupler` marker
 * (so the UI can offer the "Add module to slot N" affordance before any module is
 * attached). The composer tests at the UI level verify that `coeFlags` actually lands
 * on `device.config.coeFlags`; this file verifies the pure helper.
 */

import type { ESIDevice } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { enrichDeviceData, lacksE2Schema } from '../enrich-device-data'
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

describe('DOPE-704 E1 extras: enrichDeviceData returns the ESI extensions', () => {
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

describe('DOPE-704 E1 extras: freshly added device no longer looks like pre-E2', () => {
  test('a device whose config carries the enriched coeFlags does not satisfy lacksE2Schema', () => {
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
    expect(lacksE2Schema(device)).toBe(false)
  })
})
