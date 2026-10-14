/**
 * Turn the datapoints an embedded vendor configurator reports into I/O
 * mapping entries with IEC 61131-3 addresses.
 *
 * The prefix comes from `access` (`ro` → `%I`, `wo` → `%Q`) and the size
 * from `bitlength` (1 → X, 8 → B, 16 → W, 32 → D). A `Bitarea` of n bits
 * becomes n bit channels. Anything else is returned in `unaddressable`
 * rather than dropped silently. Addresses taken here are provisional:
 * `recalculateIecAddresses` owns the final allocation.
 */

import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import type { AddressPool } from '@root/middleware/shared/utils/iec-address/address-pool'
import { nextFreeAddress } from '@root/middleware/shared/utils/iec-address/address-pool'
import type { DataPoint, DeviceSetup } from '@root/middleware/shared/vendor-document/protocol'

/** A module of the configurator's device setup, in the shape stored under `vendorScreenData['device-setup']`. */
export interface DeviceSetupModule {
  guid: string
  instanceName: string
  typeId: string
  /** 1-based position on the system bus. */
  slot: number
}

export interface DeviceSetupRecord {
  modules: DeviceSetupModule[]
}

export type UnaddressableReason = 'unsupported-access' | 'unsupported-width' | 'unsupported-datatype' | 'unknown-module'

export interface UnaddressableDataPoint {
  datapointId: string
  name: string
  reason: UnaddressableReason
}

export interface DataPointMapping {
  entries: IoMappingEntry[]
  unaddressable: UnaddressableDataPoint[]
}

export function toDeviceSetupRecord(setup: DeviceSetup): DeviceSetupRecord {
  return {
    modules: setup.devices.map((device, index) => ({
      guid: device.guid,
      instanceName: device.name,
      typeId: device.typeId,
      slot: index + 1,
    })),
  }
}

const DIRECTION_BY_ACCESS: Readonly<Record<string, 'I' | 'Q'>> = { ro: 'I', wo: 'Q' }
const SIZE_BY_BITLENGTH: Readonly<Record<number, 'X' | 'B' | 'W' | 'D'>> = { 1: 'X', 8: 'B', 16: 'W', 32: 'D' }

/** Vendor integer names to their IEC 61131-3 equivalents; IEC names pass through unchanged. */
const IEC_TYPE_BY_VENDOR_TYPE: Readonly<Record<string, string>> = {
  UInt8: 'USINT',
  Int8: 'SINT',
  UInt16: 'UINT',
  Int16: 'INT',
  UInt32: 'UDINT',
  Int32: 'DINT',
}

const IEC_SCALAR_TYPES = new Set(['BOOL', 'SINT', 'INT', 'DINT', 'USINT', 'UINT', 'UDINT'])

/** The module a datapoint belongs to: its id is `<module guid>_<index>[_<bit>]`. */
function findModule(modules: readonly DeviceSetupModule[], datapointId: string): DeviceSetupModule | undefined {
  return modules.find((module) => datapointId.startsWith(`${module.guid}_`))
}

function iecTypeOf(dataPoint: DataPoint): string | null {
  if (dataPoint.bitlength === 1) return 'BOOL'
  if (IEC_SCALAR_TYPES.has(dataPoint.datatype)) return dataPoint.datatype
  return IEC_TYPE_BY_VENDOR_TYPE[dataPoint.datatype] ?? null
}

export function datapointsToIoMapping(
  dataPoints: readonly DataPoint[],
  deviceSetup: DeviceSetupRecord,
  pool: AddressPool,
): DataPointMapping {
  const entries: IoMappingEntry[] = []
  const unaddressable: UnaddressableDataPoint[] = []
  const inFlight = new Set<string>()

  const report = (dataPoint: DataPoint, reason: UnaddressableReason): void => {
    unaddressable.push({ datapointId: dataPoint.id, name: dataPoint.name, reason })
  }

  const push = (
    module: DeviceSetupModule,
    prefix: string,
    datapointId: string,
    channelName: string,
    dataType: string,
    channelType: string,
  ): void => {
    const iecAddress = nextFreeAddress(pool, prefix, prefix.endsWith('X'), undefined, inFlight)
    inFlight.add(iecAddress)
    entries.push({
      slot: module.slot,
      moduleId: module.typeId,
      moduleName: module.instanceName,
      channelName,
      channelType,
      dataType,
      iecAddress,
      alias: '',
      datapointId,
    })
  }

  for (const dataPoint of dataPoints) {
    const module = findModule(deviceSetup.modules, dataPoint.id)
    if (!module) {
      report(dataPoint, 'unknown-module')
      continue
    }
    const direction = DIRECTION_BY_ACCESS[dataPoint.access ?? '']
    if (!direction) {
      report(dataPoint, 'unsupported-access')
      continue
    }

    if (dataPoint.datatype === 'Bitarea') {
      if (dataPoint.bitlength < 1) {
        report(dataPoint, 'unsupported-width')
        continue
      }
      for (let bit = 0; bit < dataPoint.bitlength; bit++) {
        push(module, `%${direction}X`, `${dataPoint.id}_${bit}`, `${dataPoint.name}.${bit}`, 'BOOL', dataPoint.datatype)
      }
      continue
    }

    const size = SIZE_BY_BITLENGTH[dataPoint.bitlength]
    if (!size) {
      report(dataPoint, 'unsupported-width')
      continue
    }
    const dataType = iecTypeOf(dataPoint)
    if (!dataType) {
      report(dataPoint, 'unsupported-datatype')
      continue
    }
    push(module, `%${direction}${size}`, dataPoint.id, dataPoint.name, dataType, dataPoint.datatype)
  }

  return { entries, unaddressable }
}

export interface DroppedAlias {
  alias: string
  datapointId: string
  channelName: string
}

/**
 * Carry each alias onto the entry with the same `datapointId`. An alias whose
 * datapoint is gone (module removed, or re-added under a new guid) is
 * returned in `dropped`; entries without a `datapointId` never match.
 */
export function restoreAliasesByDatapointId(
  previous: readonly IoMappingEntry[],
  next: readonly IoMappingEntry[],
): { entries: IoMappingEntry[]; dropped: DroppedAlias[] } {
  const aliasById = new Map<string, IoMappingEntry>()
  for (const entry of previous) {
    if (entry.datapointId && entry.alias) aliasById.set(entry.datapointId, entry)
  }

  const kept = new Set<string>()
  const entries = next.map((entry) => {
    const prior = entry.datapointId ? aliasById.get(entry.datapointId) : undefined
    if (!prior || !entry.datapointId) return entry
    kept.add(entry.datapointId)
    return { ...entry, alias: prior.alias }
  })

  const dropped: DroppedAlias[] = []
  for (const [datapointId, prior] of aliasById) {
    if (!kept.has(datapointId)) dropped.push({ alias: prior.alias, datapointId, channelName: prior.channelName })
  }
  return { entries, dropped }
}
