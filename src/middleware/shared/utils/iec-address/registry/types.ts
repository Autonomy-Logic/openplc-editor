/**
 * Central IEC address registry — data model.
 *
 * The registry is the single source of truth for which consumers exist,
 * what addresses they are assigned, and which aliases point where. See
 * docs/iec-address-registry.md for the full architecture.
 *
 * Producers (pin mapping, VPP, Modbus, EtherCAT, …) register CONSUMERS.
 * Each consumer declares CHANNELS — individual address requests. A
 * channel's `channelId` is stable and address-independent: aliases and
 * program-variable bindings attach to the channel, so they follow the
 * channel as reallocation moves its address.
 */

/** IEC 61131-3 location area. */
export type IecDirection = 'I' | 'Q' | 'M'

/** IEC 61131-3 size prefix. `X` is bit (byte.bit addressed); the rest are
 *  index-addressed. Each (direction, size) pair is an INDEPENDENT linear
 *  space — the OpenPLC runtime uses separate typed buffers per prefix, so
 *  `%IB0` / `%IW0` / `%ID0` do NOT overlap. */
export type IecSize = 'X' | 'B' | 'W' | 'D' | 'L'

export interface AddressClass {
  direction: IecDirection
  size: IecSize
}

/** A single address request within a consumer. */
export interface RegistryChannel {
  /** Stable, address-independent identity within the owning consumer.
   *  What an alias / variable binds to, so it survives reallocation. */
  channelId: string
  class: AddressClass
  /** User-facing alias, unique system-wide. Empty / undefined = none. */
  alias?: string
  /** Fixed hardware address (e.g. an Arduino pin). When set the channel is
   *  RESERVED at this literal address instead of being allocated. */
  pinned?: string
  /**
   * Stable *semantic* identity that outlives this channel's presence in the
   * registry — e.g. `moduleId:slot:channelName` for a VPP channel. When a
   * consumer is removed and later re-added with the same semantic identity,
   * the session alias-memory restores the alias by this key. Distinct from
   * `channelId` (which is only stable *within* a live consumer): the memory
   * key also encodes the module/slot so "same module, different slot" and
   * "different module, same slot" resolve to different keys. Session-scoped —
   * never serialized.
   */
  memoryKey?: string
}

/** Well-known consumer kinds. Left open (`string`) so future producers can
 *  register without changing the core. */
export type ConsumerKind = 'pin-mapping' | 'vpp-io' | 'modbus-tcp-remote' | 'ethercat' | (string & {})

export interface RegistryConsumer {
  id: string
  kind: ConsumerKind
  label?: string
  /** Deterministic allocation order (lower allocates first). Ties are
   *  broken by `id` so the result is reproducible across sessions. */
  order: number
  channels: RegistryChannel[]
}

/**
 * The serialized source of truth.
 *
 * `assignments` is a derived cache — `key(consumerId, channelId) → address`
 * — rebuilt by `recalculate()`. It is persisted so the compiler and UI have
 * stable addresses without recomputing, but it is always a pure function of
 * `consumers`.
 */
export interface IecAddressRegistry {
  consumers: RegistryConsumer[]
  assignments: Record<string, string>
}

/** Two `pinned` channels resolved to the same literal address. */
export interface AddressConflict {
  address: string
  /** Channel keys that claimed the address, in encounter order. First won. */
  keys: string[]
}

export interface AllocationResult {
  assignments: Record<string, string>
  conflicts: AddressConflict[]
}

export type SetAliasResult =
  | { ok: true; registry: IecAddressRegistry }
  | { ok: false; conflict: { alias: string; consumerId: string; channelId: string } }

export interface AllocateOptions {
  /**
   * When provided, consumers whose `kind` is NOT in this set are excluded
   * from allocation — their channels receive no address. This is how
   * target-capability scoping works: a platform without pin mapping or VPP
   * I/O simply deactivates those consumer kinds. The consumers stay
   * registered (aliases preserved), so switching back to a capable target
   * restores them; meanwhile the still-active consumers recompact
   * project-wide into the freed space. Omitting the set treats every kind
   * as active.
   */
  activeKinds?: ReadonlySet<string>
}
