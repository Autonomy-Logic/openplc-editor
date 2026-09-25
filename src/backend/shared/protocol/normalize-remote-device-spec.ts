/**
 * Author-shaped remote-device spec → the `PLCRemoteDevice` the project stores.
 *
 * I/O groups come back SEPARATELY from the device rather than inside it: their
 * points and IEC addresses are allocated by the store's `addIOGroup`, which
 * reads the project-wide address pool. A device carrying pre-built groups would
 * either skip that allocation or duplicate it.
 */

import { isLegalIdentifier } from '../../../frontend/utils/keywords'
import { clampIOGroupLength, MAX_IO_GROUP_LENGTH_BY_FC } from '../../../frontend/utils/modbus/io-group'
import { DEFAULT_MODBUS_TCP_DEVICE_CONFIG } from '../../../frontend/utils/protocol/server-defaults'
import type { ModbusIOGroup, PLCRemoteDevice } from '../types/PLC/open-plc'
import { PLCRemoteDeviceSchema } from '../types/PLC/open-plc'
import { mergeOverrides } from './merge'
import type { NormalizeResult, SpecIOGroup, SpecRemoteDevice } from './types'

/** A Modbus RTU address is 1..247; TCP allows 0 (broadcast) and up to 255. */
const SLAVE_ID_RANGE = { tcp: { min: 0, max: 255 }, rtu: { min: 1, max: 247 } }

const DEVICE_PROTOCOLS = new Set(['modbus-tcp', 'ethercat'])

export interface NormalizedRemoteDevice {
  device: PLCRemoteDevice
  /** Added one at a time by the driver, in this order. */
  ioGroups: ModbusIOGroup[]
  /** Point aliases per group id, positional — applied after allocation. */
  aliasesByGroupId: Map<string, string[]>
}

export function normalizeRemoteDeviceSpec(spec: SpecRemoteDevice): NormalizeResult<NormalizedRemoteDevice> {
  const errors: string[] = []
  const where = `remote device "${spec.name}"`

  if (!spec.name || spec.name.trim().length === 0) {
    return { ok: false, errors: ['A remote device needs a name.'] }
  }
  const [legal, why] = isLegalIdentifier(spec.name)
  if (!legal) {
    errors.push(`${where}: "${spec.name}" is not a legal name — it ${why}.`)
  }

  if (!DEVICE_PROTOCOLS.has(spec.protocol)) {
    errors.push(
      `${where}: protocol "${spec.protocol}" has no configuration surface or runtime generator. ` +
        `Use one of: ${[...DEVICE_PROTOCOLS].join(', ')}.`,
    )
    return { ok: false, errors }
  }

  if (spec.protocol === 'modbus-tcp' && spec.ethercat !== undefined) {
    errors.push(`${where}: has an "ethercat" block but its protocol is "modbus-tcp" — that block is ignored.`)
  }
  if (spec.protocol === 'ethercat' && spec.modbus !== undefined) {
    errors.push(`${where}: has a "modbus" block but its protocol is "ethercat" — that block is ignored.`)
  }

  const built =
    spec.protocol === 'modbus-tcp'
      ? buildModbusDevice(spec, errors)
      : { device: buildEthercatDevice(spec), ioGroups: [], aliasesByGroupId: new Map<string, string[]>() }

  const parsed = PLCRemoteDeviceSchema.safeParse(built.device)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${where}: ${issue.path.join('.') || '(root)'} — ${issue.message}`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      device: parsed.success ? parsed.data : built.device,
      ioGroups: built.ioGroups,
      aliasesByGroupId: built.aliasesByGroupId,
    },
  }
}

function buildModbusDevice(spec: SpecRemoteDevice, errors: string[]): NormalizedRemoteDevice {
  const where = `remote device "${spec.name}"`
  const transport = spec.modbus?.transport ?? 'tcp'

  const base = { ...DEFAULT_MODBUS_TCP_DEVICE_CONFIG, ioGroups: [] as ModbusIOGroup[] }
  const merged = mergeOverrides(base, { ...spec.modbus, ioGroups: undefined })
  const config = { ...merged, transport, ioGroups: [] as ModbusIOGroup[] }

  // The generator drops an RTU device with no serial port without producing a
  // config entry for it, so the device would upload and simply never poll.
  if (transport === 'rtu' && !spec.modbus?.serialPort) {
    errors.push(`${where}: RTU transport needs a "serialPort" — without one the device is dropped at compile.`)
  }
  if (transport === 'tcp' && !config.host) {
    errors.push(`${where}: TCP transport needs a "host".`)
  }

  const range = SLAVE_ID_RANGE[transport]
  if (config.slaveId !== undefined && (config.slaveId < range.min || config.slaveId > range.max)) {
    errors.push(
      `${where}: slaveId ${config.slaveId} is outside the ${transport.toUpperCase()} range ` +
        `${range.min}..${range.max}.`,
    )
  }

  const ioGroups = normalizeIOGroups(spec.name, spec.modbus?.ioGroups ?? [], errors)

  const aliasesByGroupId = new Map<string, string[]>()
  const seenAliases = new Set<string>()
  for (const group of spec.modbus?.ioGroups ?? []) {
    if (!group.aliases) continue
    if (group.aliases.length > group.length) {
      errors.push(
        `${where}: I/O group "${group.name}" names ${group.aliases.length} aliases for ${group.length} point(s).`,
      )
      continue
    }
    for (const alias of group.aliases) {
      const [legalAlias, aliasWhy] = isLegalIdentifier(alias)
      if (!legalAlias) errors.push(`${where}: alias "${alias}" is not a legal name — it ${aliasWhy}.`)
      if (seenAliases.has(alias.toLowerCase())) errors.push(`${where}: alias "${alias}" is used twice.`)
      seenAliases.add(alias.toLowerCase())
    }
    aliasesByGroupId.set(`group-${group.name}`, group.aliases)
  }

  return { device: { name: spec.name, protocol: 'modbus-tcp', modbusTcpConfig: config }, ioGroups, aliasesByGroupId }
}

/**
 * Group ids are derived from the group's name rather than generated, so
 * `describe → apply → describe` returns the same document. Nothing reads the
 * id but the editor's own list keys.
 */
function normalizeIOGroups(deviceName: string, groups: SpecIOGroup[], errors: string[]): ModbusIOGroup[] {
  const where = `remote device "${deviceName}"`
  const seen = new Set<string>()
  const normalized: ModbusIOGroup[] = []

  for (const group of groups) {
    if (!group.name || group.name.trim().length === 0) {
      errors.push(`${where}: an I/O group has no name.`)
      continue
    }
    const key = group.name.toLowerCase()
    if (seen.has(key)) {
      errors.push(`${where}: two I/O groups are both named "${group.name}".`)
      continue
    }
    seen.add(key)

    const max = MAX_IO_GROUP_LENGTH_BY_FC[group.functionCode]
    if (max === undefined) {
      errors.push(`${where}: I/O group "${group.name}" has an unknown function code "${group.functionCode}".`)
      continue
    }
    if (group.length > max) {
      errors.push(
        `${where}: I/O group "${group.name}" asks for ${group.length} elements; ` +
          `FC ${group.functionCode} addresses at most ${max} per request.`,
      )
      continue
    }

    normalized.push({
      id: `group-${group.name}`,
      name: group.name,
      functionCode: group.functionCode,
      cycleTime: group.cycleTime,
      offset: group.offset,
      length: clampIOGroupLength(group.functionCode, group.length),
      errorHandling: group.errorHandling ?? 'keep-last-value',
      // Allocated by `addIOGroup` against the project-wide address pool.
      ioPoints: [],
    })
  }

  return normalized
}

/**
 * Slaves are attached by the driver, which needs the ESI files to build them.
 *
 * The master defaults are the device screen's own, field for field. It leaves
 * `taskPriority` and `enabled` unset — the schema caps priority at 31 while the
 * generator falls back to 90, so writing a default here would either fail
 * validation or store a value the GUI never would.
 */
function buildEthercatDevice(spec: SpecRemoteDevice): PLCRemoteDevice {
  const master = mergeOverrides(
    { networkInterface: 'eth0', cycleTimeUs: 1000, watchdogTimeoutCycles: 3 },
    spec.ethercat?.master,
  )
  return { name: spec.name, protocol: 'ethercat', ethercatConfig: { masterConfig: master, devices: [] } }
}
