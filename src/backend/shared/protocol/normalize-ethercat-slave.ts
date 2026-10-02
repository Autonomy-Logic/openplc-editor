/**
 * Build an EtherCAT slave from an ESI file, the way the device screen does.
 *
 * The sequence mirrors the add-device handler in the EtherCAT editor: parse the
 * device in full, enrich it (channels, PDOs, SDOs, CiA 402), reserve the
 * addresses it just claimed so the next slave in the batch does not collide,
 * then name it. Composed from the same helpers rather than reimplemented — the
 * channel mappings and their IEC locations are what the runtime binds to, and a
 * second implementation of that allocation is exactly the drift to avoid.
 *
 * Takes the XML as a string: reading `devices/esi/<id>.xml` is the caller's job,
 * which keeps this pure and testable against a real vendor file.
 */

import { getShortDeviceName } from '../../../frontend/utils/short-device-name'
import { generateUniqueSlaveName } from '../../../frontend/utils/unique-slave-name'
import type { ConfiguredEtherCATDevice } from '../../../middleware/shared/ports/esi-types'
import { sanitizeAxisName } from '../../../middleware/shared/utils/ethercat/softmotion-axis-naming'
import { createDefaultSlaveConfig } from '../ethercat/device-config-defaults'
import { enrichDeviceData } from '../ethercat/enrich-device-data'
import { parseESIDeviceFull, parseESILight } from '../ethercat/esi-parser-main'
import { mergeOverrides } from './merge'
import type { NormalizeResult, SpecEtherCATSlave } from './types'

export interface EthercatSlaveInput {
  spec: SpecEtherCATSlave
  /** Raw `devices/esi/<repositoryItemId>.xml`. */
  xml: string
  /** IEC addresses already claimed project-wide; grows as slaves are built. */
  usedAddresses: Set<string>
  /** Slave names already taken across every master. */
  takenNames: Set<string>
  /** Position on the bus when the spec leaves it out. */
  fallbackPosition: number
  /** Stable per-slave identity; the GUI uses a uuid. */
  id: string
}

export function normalizeEthercatSlave(input: EthercatSlaveInput): NormalizeResult<ConfiguredEtherCATDevice> {
  const { spec, xml, usedAddresses, takenNames } = input
  const ref = spec.esiDeviceRef
  const where = `EtherCAT slave "${spec.name ?? ref.repositoryItemId}"`
  const deviceIndex = ref.deviceIndex ?? 0

  const parsed = parseESIDeviceFull(xml, deviceIndex)
  if (!parsed.success || !parsed.device) {
    return {
      ok: false,
      errors: [`${where}: could not read device ${deviceIndex} from its ESI file — ${parsed.error ?? 'unknown error'}`],
    }
  }
  const device = parsed.device

  // The vendor id lives on the file, not the device, so the light parse is the
  // only place to get it — the same value the repository shows in the GUI.
  const light = parseESILight(xml)
  if (!light.success || !light.vendor) {
    return { ok: false, errors: [`${where}: its ESI file declares no vendor — ${light.error ?? 'unknown error'}`] }
  }

  const enriched = enrichDeviceData(device, usedAddresses)
  for (const mapping of enriched.channelMappings) usedAddresses.add(mapping.iecLocation)

  // A CiA 402 drive's name becomes a SoftMotion AXIS_REF variable, so it has to
  // be a legal identifier.
  const rawName = spec.name ?? getShortDeviceName(device)
  const cia402 = spec.cia402 ? mergeOverrides(enriched.cia402 ?? DEFAULT_CIA402, spec.cia402) : enriched.cia402
  const baseName = cia402?.enabled ? sanitizeAxisName(rawName) : rawName
  const name = generateUniqueSlaveName(baseName, takenNames)
  takenNames.add(name)

  // An alias naming a channel the ESI does not have is dropped by the map
  // below, so `apply` would report success and the next `describe` would simply
  // not carry the alias. Name the channels instead.
  const channelIds = new Set(enriched.channelMappings.map((mapping) => mapping.channelId))
  const unknown = Object.keys(spec.aliases ?? {}).filter((channelId) => !channelIds.has(channelId))
  if (unknown.length > 0) {
    return {
      ok: false,
      errors: unknown.map(
        (channelId) =>
          `${where}: alias names channel "${channelId}", which this device does not have. ` +
          `Its channels are: ${[...channelIds].join(', ')}.`,
      ),
    }
  }

  const channelMappings = spec.aliases
    ? enriched.channelMappings.map((mapping) =>
        spec.aliases?.[mapping.channelId] ? { ...mapping, alias: spec.aliases[mapping.channelId] } : mapping,
      )
    : enriched.channelMappings

  return {
    ok: true,
    value: {
      id: input.id,
      position: spec.position ?? input.fallbackPosition,
      name,
      esiDeviceRef: { repositoryItemId: ref.repositoryItemId, deviceIndex },
      vendorId: light.vendor.id,
      productCode: device.type.productCode,
      revisionNo: device.type.revisionNo,
      // Authored from the repository, not read off a live bus.
      addedFrom: 'repository',
      config: mergeOverrides(createDefaultSlaveConfig(), spec.config),
      ...enriched,
      cia402,
      channelMappings,
    },
  }
}

/** Only reached when a spec enables CiA 402 on a device the ESI does not mark. */
const DEFAULT_CIA402 = { enabled: false, scaleNum: 1, scaleDenom: 1, scaleFactor: 1 }
