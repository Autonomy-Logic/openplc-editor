import type { AddressProducerCapabilities } from '../target-capabilities'
import { runsModbusMaster } from '../target-capabilities/modbus-master'

/** Which kind of source attached this claim. */
export type SourceKind = 'pin-mapping' | 'vpp-io' | 'modbus-tcp-remote' | 'ethercat'

/** Stable, human-readable pointer back to the source. Used by the
 *  alias registry to attribute aliases and by diagnostics to explain
 *  conflicts. */
export interface SourceRef {
  kind: SourceKind
  ref: string
}

export interface ClaimedAddress {
  /** Canonical IEC 61131-3 address, e.g. "%QX0.0", "%IW3", "%ID5". */
  address: string
  source: SourceRef
  /** Free-form alias label the source attached to this address.
   *  Empty / undefined when the source didn't attach one. */
  alias?: string
}

export interface ConflictReport {
  address: string
  /** Every source that tried to claim this address, in encounter
   *  order. The first entry won the claim; the rest were rejected. */
  sources: SourceRef[]
}

export interface AddressPool {
  byAddress: ReadonlyMap<string, ClaimedAddress>
  /** Address prefix (e.g. "%QX", "%IW") -> claims sorted by numeric
   *  index. Used for fast next-free-of-prefix lookups. */
  byPrefix: ReadonlyMap<string, readonly ClaimedAddress[]>
  conflicts: readonly ConflictReport[]
}

export interface PoolPinMappingInput {
  pins: Array<{
    address: string
    /** User-supplied label that participates in the alias registry.
     *  See `DevicePin.alias` in middleware/shared/ports/types. */
    alias?: string
    pinType?: string
  }>
}

export interface PoolVppIoInput {
  entries?: Array<{
    iecAddress: string
    alias?: string
    slot: number
    channelName: string
    moduleName?: string
    /** Stable module identity for the slot. Used only to build the session
     *  alias-memory key (`vpp:moduleId:slot:channel`); the pool itself
     *  ignores it. */
    moduleId?: string
  }>
}

export interface PoolRemoteDeviceInput {
  deviceName?: string
  name?: string
  modbusTcpConfig?: {
    ioGroups?: Array<{
      id?: string
      ioPoints?: Array<{
        id: string
        iecLocation: string
        alias?: string
      }>
    }>
  }
  ethercatConfig?: {
    devices?: Array<{
      name?: string
      channelMappings?: Array<{
        channelId: string
        iecLocation: string
        alias?: string
      }>
      /**
       * Modules plugged into a modular coupler (ETG.5001). Each module
       * carries its own channel mappings claimed under
       * "<devRef>:<slaveRef>:<moduleId>:<channelId>".
       */
      modules?: Array<{
        id?: string
        slot?: number
        channelMappings?: Array<{
          channelId: string
          iecLocation: string
          alias?: string
        }>
      }>
    }>
  }
}

export interface PoolInputs {
  pinMapping?: PoolPinMappingInput
  vendorIoMapping?: PoolVppIoInput
  remoteDevices?: PoolRemoteDeviceInput[]
}

export interface BuildPoolOptions {
  /** Exclude every claim from this source kind. */
  ignoreSource?: SourceKind
}

const BIT_ADDRESS_REGEX = /^(%[IQM]X)(\d+)\.(\d+)$/
const WORD_ADDRESS_REGEX = /^(%[IQM][BWDL])(\d+)$/

interface ParsedAddress {
  prefix: string
  index: number
  bit?: number
}

function parseAddress(address: string): ParsedAddress | null {
  const bit = BIT_ADDRESS_REGEX.exec(address)
  if (bit) return { prefix: bit[1], index: Number(bit[2]), bit: Number(bit[3]) }
  const word = WORD_ADDRESS_REGEX.exec(address)
  if (word) return { prefix: word[1], index: Number(word[2]) }
  return null
}

function compareClaimedAddress(a: ClaimedAddress, b: ClaimedAddress): number {
  const pa = parseAddress(a.address)
  const pb = parseAddress(b.address)
  if (!pa) return pb ? 1 : a.address.localeCompare(b.address)
  if (!pb) return -1
  if (pa.index !== pb.index) return pa.index - pb.index
  return (pa.bit ?? 0) - (pb.bit ?? 0)
}

export function buildAddressPool(
  inputs: PoolInputs,
  caps: AddressProducerCapabilities,
  options: BuildPoolOptions = {},
): AddressPool {
  const byAddress = new Map<string, ClaimedAddress>()
  const conflicts: ConflictReport[] = []

  const ignore = options.ignoreSource

  const claim = (address: string, source: SourceRef, alias?: string): void => {
    if (!address) return
    const existing = byAddress.get(address)
    if (existing) {
      const known = conflicts.find((c) => c.address === address)
      if (known) {
        known.sources.push(source)
      } else {
        conflicts.push({ address, sources: [existing.source, source] })
      }
      return
    }
    byAddress.set(address, { address, source, alias: alias && alias.length > 0 ? alias : undefined })
  }

  if (caps.pinMapping && inputs.pinMapping && ignore !== 'pin-mapping') {
    for (const pin of inputs.pinMapping.pins) {
      claim(pin.address, { kind: 'pin-mapping', ref: pin.address }, pin.alias)
    }
  }

  if (caps.vppIo && inputs.vendorIoMapping?.entries && ignore !== 'vpp-io') {
    for (const entry of inputs.vendorIoMapping.entries) {
      claim(entry.iecAddress, { kind: 'vpp-io', ref: `slot-${entry.slot}:${entry.channelName}` }, entry.alias)
    }
  }

  if (runsModbusMaster(caps) && inputs.remoteDevices && ignore !== 'modbus-tcp-remote') {
    for (const dev of inputs.remoteDevices) {
      const devRef = dev.deviceName || dev.name || 'unknown-device'
      for (const group of dev.modbusTcpConfig?.ioGroups ?? []) {
        for (const point of group.ioPoints ?? []) {
          claim(point.iecLocation, { kind: 'modbus-tcp-remote', ref: `${devRef}:${point.id}` }, point.alias)
        }
      }
    }
  }

  if (caps.ethercat && inputs.remoteDevices && ignore !== 'ethercat') {
    for (const dev of inputs.remoteDevices) {
      const devRef = dev.deviceName || dev.name || 'unknown-device'
      for (const slave of dev.ethercatConfig?.devices ?? []) {
        const slaveRef = slave.name || 'unknown-slave'
        for (const mapping of slave.channelMappings ?? []) {
          claim(
            mapping.iecLocation,
            { kind: 'ethercat', ref: `${devRef}:${slaveRef}:${mapping.channelId}` },
            mapping.alias,
          )
        }
        for (const module of slave.modules ?? []) {
          const moduleRef = module.id || `slot-${module.slot}`
          for (const mapping of module.channelMappings ?? []) {
            claim(
              mapping.iecLocation,
              { kind: 'ethercat', ref: `${devRef}:${slaveRef}:${moduleRef}:${mapping.channelId}` },
              mapping.alias,
            )
          }
        }
      }
    }
  }

  const byPrefix = new Map<string, ClaimedAddress[]>()
  for (const c of byAddress.values()) {
    const parsed = parseAddress(c.address)
    if (!parsed) continue
    const list = byPrefix.get(parsed.prefix)
    if (list) {
      list.push(c)
    } else {
      byPrefix.set(parsed.prefix, [c])
    }
  }
  for (const list of byPrefix.values()) list.sort(compareClaimedAddress)

  return { byAddress, byPrefix, conflicts }
}

/**
 * Find the next unclaimed address with the given prefix.
 *
 * @param pool      Current address pool. The caller is responsible for
 *                  rebuilding the pool whenever it allocates a new
 *                  address and wants the next allocation to skip it.
 *                  In bulk-allocate loops, threading a mutable "used"
 *                  set alongside the pool is the simplest pattern.
 * @param prefix    IEC 61131-3 prefix, one of "%IX" / "%QX" / "%IB" /
 *                  "%QB" / "%MB" / "%IW" / "%QW" / "%MW" / "%ID" /
 *                  "%QD" / "%MD" / "%IL" / "%QL" / "%ML".
 * @param isBit     True for %IX / %QX (byte.bit addressing); false
 *                  for word/dword/lword addresses.
 * @param startFrom Linear bit index (for bit) or word index (for word)
 *                  to start scanning from. Defaults to 0.
 * @param alsoUsed  Optional extra "used" set (string addresses) the
 *                  caller is tracking outside the pool — useful when
 *                  the caller is mid-allocation and hasn't rebuilt
 *                  the pool yet.
 */
export function nextFreeAddress(
  pool: AddressPool,
  prefix: string,
  isBit: boolean,
  startFrom?: number,
  alsoUsed?: ReadonlySet<string>,
): string {
  const linearOf = (parsed: ParsedAddress | null): number => {
    if (!parsed || parsed.prefix !== prefix) return -1
    return isBit ? parsed.index * 8 + (parsed.bit ?? 0) : parsed.index
  }
  const formatLinear = (linear: number): string =>
    isBit ? `${prefix}${Math.floor(linear / 8)}.${linear % 8}` : `${prefix}${linear}`

  const poolClaims: number[] = []
  for (const claim of pool.byPrefix.get(prefix) ?? []) {
    const n = linearOf(parseAddress(claim.address))
    if (n >= 0) poolClaims.push(n)
  }

  const extras: number[] = []
  if (alsoUsed) {
    for (const addr of alsoUsed) {
      const n = linearOf(parseAddress(addr))
      if (n >= 0) extras.push(n)
    }
    extras.sort((a, b) => a - b)
  }

  let expect = startFrom ?? 0
  let i = 0
  let j = 0
  while (i < poolClaims.length || j < extras.length) {
    const a = i < poolClaims.length ? poolClaims[i] : Number.POSITIVE_INFINITY
    const b = j < extras.length ? extras[j] : Number.POSITIVE_INFINITY
    const next = a < b ? a : b
    if (next < expect) {
      if (a === next) i++
      if (b === next) j++
      continue
    }
    if (next > expect) return formatLinear(expect)
    expect++
    if (a === next) i++
    if (b === next) j++
  }
  return formatLinear(expect)
}

/** Convenience: is this address currently claimed by any source? */
export function isAddressClaimed(pool: AddressPool, address: string): boolean {
  return pool.byAddress.has(address)
}

/** Convenience: every claim, in stable address order. */
export function listClaims(pool: AddressPool): ClaimedAddress[] {
  const out: ClaimedAddress[] = []
  for (const list of pool.byPrefix.values()) out.push(...list)
  return out
}
