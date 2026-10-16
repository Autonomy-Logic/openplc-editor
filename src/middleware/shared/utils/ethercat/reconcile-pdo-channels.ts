/**
 * Reconcile a slave's `channelInfo` + `channelMappings` after its PDO entries change.
 *
 * The Process Data expert editor rewrites the entries list of a non-fixed PDO; those
 * entries drive the on-wire mapping (`0x1600`/`0x1A00` rewrite SDOs).  The IOMAPPING,
 * however, is generated from `channelInfo + channelMappings`, which were built once at
 * device-import time and would otherwise go stale on the first entry edit — the newly
 * added entry would ride on the wire with no PLC-side binding, a removed one would
 * leave an orphan mapping pointing at a byte the slave no longer sends.
 *
 * Padding entries (any entry at `index === '0x0000'`) stay out of channelInfo.
 * EtherCAT uses `0x0000` as the universal "no object, just padding bits" index,
 * and vendors label it inconsistently (Beckhoff says "Padding", WAGO says "Gap").
 * Name-based matching misses the vendor-specific labels, so index alone is the
 * reliable gate.
 *
 * Alias / IEC-location preservation: a channel whose channelId still exists and whose
 * iecType hasn't changed keeps its mapping.  A retyped entry gets a fresh IEC location
 * (the old one may be the wrong width).  Fresh channels receive a non-conflicting
 * location against the external IEC addresses the caller supplies.
 */

import type {
  EtherCATChannelMapping,
  PersistedChannelInfo,
  PersistedPdo,
  PersistedPdoEntry,
} from '@root/middleware/shared/ports/esi-types'

export interface ReconcileChannelsInput {
  /** The slave's new rxPdos after the entry edit. */
  rxPdos?: PersistedPdo[]
  /** The slave's new txPdos after the entry edit. */
  txPdos?: PersistedPdo[]
  /** The slave's previous channelInfo; may be undefined on an older project. */
  previousChannelInfo?: PersistedChannelInfo[]
  /** The slave's previous channelMappings; preserved on retained channels. */
  previousMappings: EtherCATChannelMapping[]
  /** IEC locations claimed outside this slave (other EtherCAT slaves, Modbus, pins).
   *  Fresh allocations avoid overlapping with any of these. */
  externalUsedAddresses?: Iterable<string>
}

export interface ReconcileChannelsResult {
  channelInfo: PersistedChannelInfo[]
  channelMappings: EtherCATChannelMapping[]
}

function isPaddingEntry(entry: PersistedPdoEntry): boolean {
  return entry.index === '0x0000'
}

// Mirror of `esiTypeToIecType` in `backend/shared/ethercat/esi-parser.ts`; keep the two in sync.
function inferIecType(esiType: string, bitLen: number): string {
  const map: Record<string, string> = {
    BOOL: 'BOOL',
    SINT: 'SINT',
    INT: 'INT',
    DINT: 'DINT',
    LINT: 'LINT',
    USINT: 'USINT',
    UINT: 'UINT',
    UDINT: 'UDINT',
    ULINT: 'ULINT',
    REAL: 'REAL',
    LREAL: 'LREAL',
    STRING: 'STRING',
    BYTE: 'BYTE',
    WORD: 'WORD',
    DWORD: 'DWORD',
  }
  if (map[esiType] !== undefined) return map[esiType]
  if (esiType.startsWith('BIT') || bitLen === 1) return 'BOOL'
  switch (bitLen) {
    case 1:
      return 'BOOL'
    case 8:
      return 'BYTE'
    case 16:
      return 'WORD'
    case 32:
      return 'DWORD'
    case 64:
      return 'LWORD'
    default:
      return 'BYTE'
  }
}

const IEC_WIDTH_BITS: Record<string, number> = { X: 1, B: 8, W: 16, D: 32, L: 64 }

type IecBitRange = { direction: 'I' | 'Q'; startBit: number; endBit: number }

function parseIecLocation(location: string): IecBitRange | null {
  const match = /^%([IQ])([XBWDL])(\d+)(?:\.(\d+))?$/.exec(location)
  if (!match) return null
  const [, dir, kind, byteStr, bitStr] = match
  const width = IEC_WIDTH_BITS[kind]
  if (width === undefined) return null
  const byte = Number.parseInt(byteStr, 10)
  const bit = bitStr !== undefined ? Number.parseInt(bitStr, 10) : 0
  const startBit = byte * 8 + bit
  return { direction: dir as 'I' | 'Q', startBit, endBit: startBit + width - 1 }
}

function rangesOverlap(a: IecBitRange, b: IecBitRange): boolean {
  return a.direction === b.direction && a.startBit <= b.endBit && b.startBit <= a.endBit
}

function iecTypeBitSize(iecType: string): number {
  switch (iecType.toUpperCase()) {
    case 'BOOL':
      return 1
    case 'BYTE':
    case 'SINT':
    case 'USINT':
      return 8
    case 'WORD':
    case 'INT':
    case 'UINT':
      return 16
    case 'DWORD':
    case 'DINT':
    case 'UDINT':
    case 'REAL':
      return 32
    case 'LWORD':
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
      return 64
    default:
      return 8
  }
}

function locationFor(direction: 'input' | 'output', iecType: string, bitOffset: number): string {
  const prefix = direction === 'input' ? '%I' : '%Q'
  const byte = Math.floor(bitOffset / 8)
  const bit = bitOffset % 8
  switch (iecType.toUpperCase()) {
    case 'BOOL':
      return `${prefix}X${byte}.${bit}`
    case 'BYTE':
    case 'SINT':
    case 'USINT':
      return `${prefix}B${byte}`
    case 'WORD':
    case 'INT':
    case 'UINT':
      return `${prefix}W${byte}`
    case 'DWORD':
    case 'DINT':
    case 'UDINT':
    case 'REAL':
      return `${prefix}D${byte}`
    case 'LWORD':
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
      return `${prefix}L${byte}`
    default:
      return `${prefix}B${byte}`
  }
}

function buildChannelInfoFromPdos(rxPdos: PersistedPdo[], txPdos: PersistedPdo[]): PersistedChannelInfo[] {
  const out: PersistedChannelInfo[] = []
  const walk = (pdos: PersistedPdo[], direction: 'input' | 'output') => {
    for (const pdo of pdos) {
      for (const entry of pdo.entries) {
        if (isPaddingEntry(entry)) continue
        out.push({
          channelId: `${pdo.index}-${entry.index}-${entry.subIndex}`,
          name: entry.name,
          direction,
          pdoIndex: pdo.index,
          entryIndex: entry.index,
          entrySubIndex: entry.subIndex,
          dataType: entry.dataType,
          bitLen: entry.bitLen,
          iecType: inferIecType(entry.dataType, entry.bitLen),
        })
      }
    }
  }
  // TxPDO = slave→master = inputs, RxPDO = master→slave = outputs. Same convention as
  // the ESI parser's `pdoToChannels`.
  walk(txPdos, 'input')
  walk(rxPdos, 'output')
  return out
}

export function reconcilePdoChannels(input: ReconcileChannelsInput): ReconcileChannelsResult {
  const rxPdos = input.rxPdos ?? []
  const txPdos = input.txPdos ?? []
  const previousInfo = input.previousChannelInfo ?? []
  const previousMappings = input.previousMappings

  const nextInfo = buildChannelInfoFromPdos(rxPdos, txPdos)

  const previousInfoById = new Map<string, PersistedChannelInfo>()
  for (const row of previousInfo) previousInfoById.set(row.channelId, row)
  const previousMappingById = new Map<string, EtherCATChannelMapping>()
  for (const m of previousMappings) previousMappingById.set(m.channelId, m)

  const retainedMappings: EtherCATChannelMapping[] = []
  const toAllocate: PersistedChannelInfo[] = []

  for (const info of nextInfo) {
    const prevInfo = previousInfoById.get(info.channelId)
    const prevMapping = previousMappingById.get(info.channelId)
    const sameShape =
      prevInfo !== undefined && prevInfo.iecType === info.iecType && prevInfo.direction === info.direction
    if (sameShape && prevMapping !== undefined) {
      retainedMappings.push(prevMapping)
    } else {
      toAllocate.push(info)
    }
  }

  const usedRanges: IecBitRange[] = []
  const overlapsAny = (range: IecBitRange): boolean => usedRanges.some((used) => rangesOverlap(range, used))
  if (input.externalUsedAddresses !== undefined) {
    for (const addr of input.externalUsedAddresses) {
      const r = parseIecLocation(addr)
      if (r !== null) usedRanges.push(r)
    }
  }
  for (const m of retainedMappings) {
    const r = parseIecLocation(m.iecLocation)
    if (r !== null) usedRanges.push(r)
  }

  const freshMappings: EtherCATChannelMapping[] = []
  // Allocate inputs, then outputs; align non-bit types to byte boundaries, same as
  // the ESI parser's own allocator.  Walk the toAllocate set in channelInfo order.
  for (const direction of ['input', 'output'] as const) {
    let bitOffset = 0
    for (const info of toAllocate) {
      if (info.direction !== direction) continue
      const size = iecTypeBitSize(info.iecType)
      if (size > 1 && bitOffset % 8 !== 0) bitOffset = Math.ceil(bitOffset / 8) * 8
      let candidate = locationFor(direction, info.iecType, bitOffset)
      let range = parseIecLocation(candidate)
      while (range !== null && overlapsAny(range)) {
        bitOffset += size
        if (size > 1 && bitOffset % 8 !== 0) bitOffset = Math.ceil(bitOffset / 8) * 8
        candidate = locationFor(direction, info.iecType, bitOffset)
        range = parseIecLocation(candidate)
      }
      if (range !== null) usedRanges.push(range)
      freshMappings.push({ channelId: info.channelId, iecLocation: candidate, alias: '' })
      bitOffset += size
    }
  }

  // Preserve channelInfo order (walks all txPdos then all rxPdos), and sort the
  // mappings to the same order so the two line up when inspected together.
  const mappingByChannel = new Map<string, EtherCATChannelMapping>()
  for (const m of retainedMappings) mappingByChannel.set(m.channelId, m)
  for (const m of freshMappings) mappingByChannel.set(m.channelId, m)
  const nextMappings: EtherCATChannelMapping[] = []
  for (const info of nextInfo) {
    const m = mappingByChannel.get(info.channelId)
    if (m !== undefined) nextMappings.push(m)
  }

  return { channelInfo: nextInfo, channelMappings: nextMappings }
}
