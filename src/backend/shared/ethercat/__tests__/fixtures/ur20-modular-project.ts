/**
 * Fixture: a Weidmueller UR20-FBC-EC station built from the vendor ESI excerpts in
 * `esi-real/`, the way the editor builds it: the coupler through `enrichDeviceData`, the
 * modules through `buildModuleForSlot`. Slot 1 UR20-4DI-P, slot 2 UR20-4DO-P, slot 4
 * UR20-4AI-UI-16 with slot 3 left empty.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { ConfiguredEtherCATDevice, ESIModule } from '@root/middleware/shared/ports/esi-types'
import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'
import { buildModuleForSlot } from '@root/middleware/shared/utils/ethercat/module-build'

import { createDefaultSlaveConfig } from '../../device-config-defaults'
import { enrichDeviceData } from '../../enrich-device-data'
import { parseESIDeviceFull, parseESIModuleFull } from '../../esi-parser-main'

const read = (name: string): string => decodeXmlBytes(new Uint8Array(readFileSync(join(__dirname, 'esi-real', name))))

const couplerResult = parseESIDeviceFull(read('weidmueller-ur20-fbc.xml'), 0)
if (!couplerResult.success || couplerResult.device === undefined) throw new Error('UR20-FBC-EC excerpt did not parse')
const esiCoupler = couplerResult.device

const moduleResult = parseESIModuleFull(read('weidmueller-ur20-io.xml'))
const esiModules: ESIModule[] = moduleResult.success ? (moduleResult.modules ?? []) : []
const esiModule = (ident: string): ESIModule => {
  const found = esiModules.find((m) => Number.parseInt(m.ident, 16) === Number.parseInt(ident, 16))
  if (found === undefined) throw new Error(`module ${ident} not in the UR20 I/O excerpt`)
  return found
}

const slots = esiCoupler.slots
if (slots === undefined) throw new Error('UR20-FBC-EC excerpt has no <Slots>')

const used = new Set<string>()
const { coeFlags, ...enriched } = enrichDeviceData(esiCoupler, used)
for (const m of enriched.channelMappings) used.add(m.iecLocation)

const modules = [
  { slot: 1, ident: '0x00091F84' },
  { slot: 2, ident: '0x01012FA0' },
  { slot: 4, ident: '0x040115C4' },
].map(({ slot, ident }) =>
  buildModuleForSlot({
    id: `module-${slot}`,
    slot,
    esiModule: esiModule(ident),
    increments: slots,
    repositoryItemId: 'ur20-io',
    usedAddresses: used,
  }),
)

const coupler: ConfiguredEtherCATDevice = {
  id: 'ur20-coupler',
  position: 1,
  name: 'UR20_Coupler',
  esiDeviceRef: { repositoryItemId: 'ur20-fbc', deviceIndex: 0 },
  vendorId: '0x00000230',
  productCode: esiCoupler.type.productCode,
  revisionNo: esiCoupler.type.revisionNo,
  addedFrom: 'repository',
  config: { ...createDefaultSlaveConfig(), coeFlags },
  ...enriched,
  modules,
}

export const ur20ModularProject: PLCRemoteDevice[] = [
  {
    name: 'bus_a',
    protocol: 'ethercat',
    ethercatConfig: {
      masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
      devices: [coupler],
    },
  },
]
