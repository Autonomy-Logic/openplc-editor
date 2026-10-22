/**
 * Generates the `io-ranges` runtime plugin config: explicit bus and PLC coordinates per range of channels.
 *
 * Inputs, all already in the project or the signed manifest:
 *   - `module-configuration.slots`: manifest module id per bus slot, in bus order
 *   - `io-mapping.entries`: the IEC address of each `slot:channelName`
 *   - each module's `processImage` (bytes per direction) and its channels' module-relative `wire`
 *
 * A channel's bus offset is the sum of the `processImage` bytes of the earlier slots in its direction plus its
 * own `wire`. Its PLC position is its IEC address. Channels contiguous on both sides merge into one range.
 */

import { mergeTemplateAndScreenData, type VendorScreenData } from './generate-vendor-plugin-config'

const RANGE_KINDS = ['bool', 'byte', 'word', 'dword', 'lword'] as const
type RangeKind = (typeof RANGE_KINDS)[number]

export type IoRange =
  | {
      kind: 'bool'
      wire_byte: number
      wire_bit: number
      plc_byte: number
      plc_bit: number
      count: number
      slot: number
      module: string
    }
  | {
      kind: Exclude<RangeKind, 'bool'>
      wire_byte: number
      plc_index: number
      count: number
      slot: number
      module: string
    }

export interface IoRangesModule {
  id: string
  name: string
  processImage?: { inputBytes: number; outputBytes: number }
  addressMapping?: unknown
}

export interface IoRangesArchive {
  fileName: string
  sha256: string
}

export type IoRangesResult = { ok: true; config: Record<string, unknown> } | { ok: false; errors: string[] }

const KIND_BY_SIZE: Readonly<Record<string, RangeKind>> = { X: 'bool', B: 'byte', W: 'word', D: 'dword', L: 'lword' }
const BYTES_BY_KIND: Readonly<Record<RangeKind, number>> = { bool: 0, byte: 1, word: 2, dword: 4, lword: 8 }
const ADDRESS_REGEX = /^%([IQ])([XBWDL])(\d+)(?:\.([0-7]))?$/

type Placed = {
  input: boolean
  kind: RangeKind
  /** Bits for `bool`, bytes otherwise. */
  wire: number
  /** Linear bit for `bool`, element index otherwise. */
  plc: number
}

function parseAddress(address: string): { input: boolean; kind: RangeKind; plc: number } | null {
  const match = ADDRESS_REGEX.exec(address)
  if (!match) return null
  const kind = KIND_BY_SIZE[match[2]]
  const index = Number(match[3])
  if (kind === 'bool') {
    if (match[4] === undefined) return null
    return { input: match[1] === 'I', kind, plc: index * 8 + Number(match[4]) }
  }
  if (match[4] !== undefined) return null
  return { input: match[1] === 'I', kind, plc: index }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The plain-object elements of `container[key]`; anything else in the list is skipped. */
function recordsAt(container: unknown, key: string): Array<Record<string, unknown>> {
  if (!isRecord(container)) return []
  const list = container[key]
  return Array.isArray(list) ? list.filter(isRecord) : []
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function readChannels(addressMapping: unknown): Array<{ name: string; wire: unknown }> {
  return recordsAt(addressMapping, 'channels').flatMap((channel) =>
    typeof channel.name === 'string' ? [{ name: channel.name, wire: channel.wire }] : [],
  )
}

function readWire(wire: unknown): { byte: number; bit?: number } | null {
  if (!isRecord(wire) || !isByteCount(wire.byte)) return null
  if (wire.bit === undefined) return { byte: wire.byte }
  return isByteCount(wire.bit) && wire.bit < 8 ? { byte: wire.byte, bit: wire.bit } : null
}

function toRange(first: Placed, count: number, slot: number, module: string): IoRange {
  if (first.kind === 'bool') {
    return {
      kind: 'bool',
      wire_byte: Math.floor(first.wire / 8),
      wire_bit: first.wire % 8,
      plc_byte: Math.floor(first.plc / 8),
      plc_bit: first.plc % 8,
      count,
      slot,
      module,
    }
  }
  return { kind: first.kind, wire_byte: first.wire, plc_index: first.plc, count, slot, module }
}

function mergeRuns(placed: Placed[], slot: number, module: string): IoRange[] {
  const sorted = [...placed].sort((a, b) => a.wire - b.wire)
  const ranges: IoRange[] = []
  let start = 0
  for (let i = 1; i <= sorted.length; i++) {
    const previous = sorted[i - 1]
    const current = sorted[i]
    const step = previous.kind === 'bool' ? 1 : BYTES_BY_KIND[previous.kind]
    const contiguous =
      current !== undefined &&
      current.kind === previous.kind &&
      current.wire === previous.wire + step &&
      current.plc === previous.plc + 1
    if (contiguous) continue
    ranges.push(toRange(sorted[start], i - start, slot, module))
    start = i
  }
  return ranges
}

/**
 * Builds the plugin config, or the reasons it cannot be built. `archive` names the station archive written next
 * to the config; without it the plugin loads a blank project.
 */
export function generateIoRangesPluginConfig(
  configTemplate: Record<string, unknown>,
  vendorScreenData: VendorScreenData,
  modules: IoRangesModule[],
  archive: IoRangesArchive | null,
): IoRangesResult {
  const errors: string[] = []
  const moduleConfiguration = vendorScreenData['module-configuration']
  const slots: unknown[] =
    isRecord(moduleConfiguration) && Array.isArray(moduleConfiguration.slots) ? moduleConfiguration.slots : []
  const entries = recordsAt(vendorScreenData['io-mapping'], 'entries')
  const setupModules = recordsAt(vendorScreenData['device-setup'], 'modules')

  const inputs: IoRange[] = []
  const outputs: IoRange[] = []
  let inputBase = 0
  let outputBase = 0

  for (let index = 0; index < slots.length; index++) {
    const slotNumber = index + 1
    const moduleId = slots[index]
    const module = typeof moduleId === 'string' ? modules.find((candidate) => candidate.id === moduleId) : undefined
    if (!module) {
      const setup = setupModules.find((candidate) => candidate.slot === slotNumber)
      const label =
        typeof setup?.instanceName === 'string'
          ? `${setup.instanceName} (type ${String(setup.typeId)})`
          : typeof moduleId === 'string'
            ? moduleId
            : 'unknown module'
      errors.push(`Slot ${slotNumber}: ${label} is not in the package catalogue, so its I/O cannot be mapped`)
      continue
    }

    const image = module.processImage
    if (!image || !isByteCount(image.inputBytes) || !isByteCount(image.outputBytes)) {
      errors.push(`Slot ${slotNumber}: module ${module.name} declares no processImage`)
      continue
    }

    const channels = readChannels(module.addressMapping)
    const known = new Set(channels.map((channel) => channel.name))
    for (const entry of entries) {
      if (entry.slot !== slotNumber || typeof entry.channelName !== 'string' || known.has(entry.channelName)) continue
      errors.push(
        `Slot ${slotNumber}: ${entry.channelName} is not a channel of ${module.name} in the manifest, so it cannot be mapped`,
      )
    }

    const placed: Placed[] = []
    for (const channel of channels) {
      const entry = entries.find((candidate) => candidate.slot === slotNumber && candidate.channelName === channel.name)
      if (typeof entry?.iecAddress !== 'string' || entry.iecAddress === '') continue
      const address = parseAddress(entry.iecAddress)
      if (!address) {
        errors.push(`Slot ${slotNumber}: ${channel.name} has an unsupported address ${entry.iecAddress}`)
        continue
      }
      const wire = readWire(channel.wire)
      if (!wire) {
        errors.push(`Slot ${slotNumber}: ${channel.name} of ${module.name} declares no valid wire position`)
        continue
      }
      const base = address.input ? inputBase : outputBase
      const wireByte = base + wire.byte
      placed.push({
        input: address.input,
        kind: address.kind,
        wire: address.kind === 'bool' ? wireByte * 8 + (wire.bit ?? 0) : wireByte,
        plc: address.plc,
      })
    }

    for (const input of [true, false]) {
      for (const kind of RANGE_KINDS) {
        const group = placed.filter((channel) => channel.input === input && channel.kind === kind)
        if (group.length > 0) (input ? inputs : outputs).push(...mergeRuns(group, index, module.name))
      }
    }

    inputBase += image.inputBytes
    outputBase += image.outputBytes
  }

  if (errors.length > 0) return { ok: false, errors }

  const config = mergeTemplateAndScreenData(configTemplate, vendorScreenData)
  if (archive) {
    config.configuration_archive = archive.fileName
    config.configuration_sha256 = archive.sha256
  }
  config.inputs = sortByWire(inputs)
  config.outputs = sortByWire(outputs)
  return { ok: true, config }
}

function sortByWire(ranges: IoRange[]): IoRange[] {
  const position = (range: IoRange) => range.wire_byte * 8 + (range.kind === 'bool' ? range.wire_bit : 0)
  return [...ranges].sort((a, b) => position(a) - position(b))
}
