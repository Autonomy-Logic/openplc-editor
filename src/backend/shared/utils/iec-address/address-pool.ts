/**
 * Address pool — single source of truth for which IEC 61131-3
 * addresses are currently claimed and by which producer.
 *
 * Replaces the older `collectUsedIecAddresses` + `generateIecAddress`
 * pair, which were separate concerns: collection (string set of used
 * addresses) and allocation (next-free lookup with a known skip set).
 * The pool unifies both, adds target-scoping via TargetCapabilities,
 * tracks origin per claim (for the alias registry in Phase 2), and
 * reports conflicts when two producers claim the same address.
 *
 * Pure derived structure: building the pool is a function of project
 * state + the active target's capabilities, no caching, no
 * side-effects. Rebuild whenever the inputs change; cost is
 * O(slots + remote points + pins), trivial at realistic project size.
 *
 * Target scoping
 * ----------------
 * Each producer contributes to the pool only when the active target's
 * capability for that source is `true`. Switching to a target that
 * disables a source releases every claim that source had made — the
 * underlying project data is preserved, just not counted. This is
 * why an Arduino target's pin-mapping claims and a Runtime v4
 * target's VPP slots can coexist in the same project file without
 * clashing: only one set is active at a time.
 *
 * Reservation order
 * ----------------
 * Inside the pool build:
 *   1. Pin-mapping claims first (Arduino-style fixed-address sources).
 *   2. VPP I/O claims next (per-slot, in slot order).
 *   3. Modbus TCP remote-device I/O points (per-device, per-group).
 *   4. EtherCAT channel mappings (per-device, in scan order).
 *
 * The order matters when two producers happen to claim the same
 * address: only the first wins, and the second is reported as a
 * conflict. The editor should never produce conflicts under normal
 * operation; if `pool.conflicts` is non-empty, the caller should
 * re-run the address-sync flow (Phase 4) to reassign the losers.
 */

import type { TargetCapabilities } from '../target-capabilities'

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

/* ------------------------------------------------------------------
 * Pool inputs
 *
 * Loosely typed because each platform stores producer data in its own
 * shape. The shared pool consumes the minimum each producer needs to
 * declare. Missing fields are treated as empty.
 * ------------------------------------------------------------------ */

export interface PoolPinMappingInput {
  pins: Array<{
    address: string
    name?: string
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
    }>
  }
}

export interface PoolInputs {
  pinMapping?: PoolPinMappingInput
  vendorIoMapping?: PoolVppIoInput
  remoteDevices?: PoolRemoteDeviceInput[]
}

export interface BuildPoolOptions {
  /** Exclude every claim from this source kind. Used when a producer
   *  is about to regenerate its own claims (allocating addresses):
   *  the pool must reflect "everything except me" so we don't
   *  conflict with our own about-to-be-overwritten entries. */
  ignoreSource?: SourceKind
  /** Bypass capability gating: every producer's claims are included
   *  regardless of the active target's capability flags.
   *
   *  Use case: when a producer is *itself* being edited (e.g. user
   *  adds a new Modbus TCP I/O group), the operation always intends
   *  to include the entire current claim set so the new entries
   *  don't collide. Target-switching scenarios — where claims
   *  become "inactive" because the target dropped the capability —
   *  call the default (cap-gated) form. */
  ignoreCapabilities?: boolean
}

/* ------------------------------------------------------------------
 * Address parsing helpers (internal)
 * ------------------------------------------------------------------ */

const BIT_ADDRESS_REGEX = /^(%[IQM]X)(\d+)\.(\d+)$/
const WORD_ADDRESS_REGEX = /^(%[IQM][WDL])(\d+)$/

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
  // Unparseable addresses sort last but stably amongst themselves.
  if (!pa) return pb ? 1 : a.address.localeCompare(b.address)
  if (!pb) return -1
  if (pa.index !== pb.index) return pa.index - pb.index
  return (pa.bit ?? 0) - (pb.bit ?? 0)
}

/* ------------------------------------------------------------------
 * Pool construction
 * ------------------------------------------------------------------ */

export function buildAddressPool(
  inputs: PoolInputs,
  caps: TargetCapabilities,
  options: BuildPoolOptions = {},
): AddressPool {
  const byAddress = new Map<string, ClaimedAddress>()
  const conflicts: ConflictReport[] = []

  const ignore = options.ignoreSource
  const bypassCaps = options.ignoreCapabilities === true

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

  // 1. Pin mapping — fixed hardware addresses. Goes first so other
  //    producers can't accidentally claim a pin-bound slot when
  //    Arduino-style targets are active.
  if ((bypassCaps || caps.pinMapping) && inputs.pinMapping && ignore !== 'pin-mapping') {
    for (const pin of inputs.pinMapping.pins) {
      claim(pin.address, { kind: 'pin-mapping', ref: pin.address }, pin.name)
    }
  }

  // 2. VPP module I/O.
  if ((bypassCaps || caps.vppIo) && inputs.vendorIoMapping?.entries && ignore !== 'vpp-io') {
    for (const entry of inputs.vendorIoMapping.entries) {
      claim(
        entry.iecAddress,
        { kind: 'vpp-io', ref: `slot-${entry.slot}:${entry.channelName}` },
        entry.alias,
      )
    }
  }

  // 3. Modbus TCP slave remote-device I/O points.
  if ((bypassCaps || caps.modbusTcpRemote) && inputs.remoteDevices && ignore !== 'modbus-tcp-remote') {
    for (const dev of inputs.remoteDevices) {
      const devRef = dev.deviceName || dev.name || 'unknown-device'
      for (const group of dev.modbusTcpConfig?.ioGroups ?? []) {
        for (const point of group.ioPoints ?? []) {
          claim(
            point.iecLocation,
            { kind: 'modbus-tcp-remote', ref: `${devRef}:${point.id}` },
            point.alias,
          )
        }
      }
    }
  }

  // 4. EtherCAT channel mappings.
  if ((bypassCaps || caps.ethercat) && inputs.remoteDevices && ignore !== 'ethercat') {
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
      }
    }
  }

  // Build the prefix index for fast next-free lookups.
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

/* ------------------------------------------------------------------
 * Allocation
 * ------------------------------------------------------------------ */

/**
 * Find the next unclaimed address with the given prefix.
 *
 * @param pool      Current address pool. The caller is responsible for
 *                  rebuilding the pool whenever it allocates a new
 *                  address and wants the next allocation to skip it.
 *                  In bulk-allocate loops, threading a mutable "used"
 *                  set alongside the pool is the simplest pattern.
 * @param prefix    IEC 61131-3 prefix, one of "%IX" / "%QX" / "%IW" /
 *                  "%QW" / "%MW" / "%ID" / "%QD" / "%MD" / "%IL" /
 *                  "%QL" / "%ML".
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
  let current = startFrom ?? 0
  // Hard cap so a fully-full prefix can't loop forever. 1M slots is
  // far beyond any realistic backplane.
  const cap = 1_000_000
  while (current < cap) {
    const candidate = isBit ? `${prefix}${Math.floor(current / 8)}.${current % 8}` : `${prefix}${current}`
    if (!pool.byAddress.has(candidate) && !(alsoUsed && alsoUsed.has(candidate))) {
      return candidate
    }
    current++
  }
  throw new Error(`nextFreeAddress: exhausted ${prefix} after ${cap} slots`)
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
