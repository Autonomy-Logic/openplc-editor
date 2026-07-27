// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * CiA 402 (DS402) SoftMotion axis recognition & mapping.
 *
 * Detects whether an EtherCAT device is a CiA 402 servo drive and resolves its
 * standard CiA 402 objects (Controlword, Statusword, Target/Actual position,
 * …) to the editor-allocated IEC located addresses. This is the bridge between
 * a generic EtherCAT slave and the strucpp AXIS_REF_SM3 / MC_* motion library:
 * a recognized drive becomes a SoftMotion axis whose name is used directly in
 * MC_*(Axis := <deviceName>) calls, with the glue generated at compile time
 * (see generate-softmotion.ts).
 */

import type {
  Cia402AxisConfig,
  ESIDevice,
  ESIPdo,
  EtherCATChannelMapping,
  PersistedChannelInfo,
} from '@root/middleware/shared/ports/esi-types'

export type { Cia402AxisConfig }

/** A CiA 402 object role used by the AXIS_REF_SM3 drive bridge. */
export type Cia402Role =
  | 'controlWord'
  | 'modesOfOperation'
  | 'targetPosition'
  | 'profileVelocity'
  | 'targetVelocity'
  | 'targetTorque'
  | 'statusWord'
  | 'modesDisplay'
  | 'positionActual'
  | 'velocityActual'
  | 'torqueActual'

interface Cia402ObjectDef {
  role: Cia402Role
  index: number
  direction: 'output' | 'input'
}

/**
 * The single-axis CiA 402 object dictionary entries the drive bridge maps.
 * Controlword/Statusword are mandatory; the rest are optional and only wired
 * when the drive exposes them as PDOs.
 */
export const CIA402_OBJECTS: readonly Cia402ObjectDef[] = [
  { role: 'controlWord', index: 0x6040, direction: 'output' },
  { role: 'modesOfOperation', index: 0x6060, direction: 'output' },
  { role: 'targetPosition', index: 0x607a, direction: 'output' },
  { role: 'profileVelocity', index: 0x6081, direction: 'output' },
  { role: 'targetVelocity', index: 0x60ff, direction: 'output' },
  { role: 'targetTorque', index: 0x6071, direction: 'output' },
  { role: 'statusWord', index: 0x6041, direction: 'input' },
  { role: 'modesDisplay', index: 0x6061, direction: 'input' },
  { role: 'positionActual', index: 0x6064, direction: 'input' },
  { role: 'velocityActual', index: 0x606c, direction: 'input' },
  { role: 'torqueActual', index: 0x6077, direction: 'input' },
]

/** The CiA 402 objects that MUST be present for a device to be an axis. */
const MANDATORY_INDICES = [0x6040, 0x6041] as const

/**
 * Default axis config for a newly-recognized drive (1:1 scaling). See the
 * Cia402AxisConfig type in the esi-types ports module.
 */
export const DEFAULT_CIA402_AXIS_CONFIG: Cia402AxisConfig = {
  enabled: true,
  scaleNum: 1,
  scaleDenom: 1,
  scaleFactor: 1,
}

/** Parse a hex object index in any ESI form (`#x6040`, `0x6040`, `6040`, `24640`). */
export function normalizeObjectIndex(raw: string | number): number {
  if (typeof raw === 'number') return raw
  const s = raw.trim().replace(/^#x/i, '').replace(/^0x/i, '')
  // ESI indices are hex; a bare token like "6040" is hex, not decimal. Reject
  // anything that isn't a pure hex string (parseInt would leniently read a
  // leading hex prefix like "b" out of "bogus").
  if (!/^[0-9a-f]+$/i.test(s)) return -1
  return parseInt(s, 16)
}

function pdosContainIndex(pdos: ESIPdo[], index: number): boolean {
  return pdos.some((pdo) => pdo.entries.some((e) => normalizeObjectIndex(e.index) === index))
}

/**
 * True when the device exposes the mandatory CiA 402 objects as PDOs
 * (Controlword out, Statusword in) — i.e. it can be driven as a SoftMotion axis.
 */
export function isCia402Drive(device: ESIDevice): boolean {
  return pdosContainIndex(device.rxPdo, MANDATORY_INDICES[0]) && pdosContainIndex(device.txPdo, MANDATORY_INDICES[1])
}

/** A resolved CiA 402 object: its role, IEC located address, and IEC type. */
export interface ResolvedCia402Object {
  role: Cia402Role
  index: number
  iecLocation: string
  iecType: string
}

/**
 * Resolve the CiA 402 objects present on a device to their editor-allocated IEC
 * located addresses, by joining channel metadata (which carries the object
 * index) with the channel mappings (which carry the allocated address) on
 * `channelId`. Objects without a mapping (unassigned) are omitted.
 */
export function resolveCia402Objects(
  channelInfo: PersistedChannelInfo[],
  mappings: EtherCATChannelMapping[],
): ResolvedCia402Object[] {
  const locationByChannel = new Map(mappings.map((m) => [m.channelId, m.iecLocation]))
  const resolved: ResolvedCia402Object[] = []
  for (const def of CIA402_OBJECTS) {
    const info = channelInfo.find(
      (c) => normalizeObjectIndex(c.entryIndex) === def.index && c.direction === def.direction,
    )
    if (!info) continue
    const iecLocation = locationByChannel.get(info.channelId)
    if (!iecLocation) continue
    resolved.push({ role: def.role, index: def.index, iecLocation, iecType: info.iecType })
  }
  return resolved
}
