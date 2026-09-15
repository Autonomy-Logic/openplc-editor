/**
 * Size the I/O image from the project, and refuse located declarations that
 * nothing produces (DOPE-615).
 *
 * The image used to be a constant: sixteen `MAX_*` macros in
 * `resources/sources/arduino/openplc.h` on bare metal, `BUFFER_SIZE 1024` on
 * Runtime v4, the same for every board and every project. That is wrong in
 * both directions. A board with three times the memory got the same 56
 * outputs (openplc-editor#296), and a project using a handful of points paid
 * for the rest anyway — out of the same memory the program, its variables and
 * its buffers come from.
 *
 * So the size becomes a function of the project. This module is the single
 * source of that figure for BOTH runtimes (FR05): bare metal turns it into
 * `#define`s at compile time, Runtime v4 receives it as a config file
 * alongside the program. One calculation, so the two cannot diverge.
 *
 * WHERE THE NUMBER COMES FROM
 * ---------------------------
 * Nothing new is derived. The editor's address registry already concentrates
 * every allocated address so producers do not collide, which means it already
 * knows how far into each space they reach — `allocateAddresses` publishes
 * that as `slotCounts`. Three contributors, per BR14 and BR15:
 *
 *   A. **Producers.** Pins, VPP slots, Modbus master points, EtherCAT
 *      channels. Read through the registry, capability-scoped exactly as the
 *      store scopes its own recalculation (`activeKindsFor`), so the image
 *      covers the addresses that were actually allocated and no others.
 *   B. **Server exposure.** What a Modbus server was explicitly configured to
 *      publish. See `serverExposure` for why "explicitly" is doing work.
 *   C. **The program's own located declarations** — for memory only.
 *
 * The asymmetry between areas is the whole point of BR14, and it is not
 * arbitrary. It follows from whether an address means anything without a
 * counterpart:
 *
 *   - `%I` is read by the program. With nothing feeding it, it reads zero
 *     forever, so the producer must be external.
 *   - `%Q` is written by the program. With nothing draining it, the value
 *     goes nowhere, so the producer must be external.
 *   - `%M` is written AND read by the program. Being self-contained is what
 *     memory is FOR, so **the declaration itself is the producer**. Memory is
 *     sized by its own declarations and can never be unbacked (FR24).
 *
 * Hence input and output declarations are VALIDATED against the image rather
 * than growing it (FR02), while memory declarations size it (BR15).
 *
 * Pure function: no fs I/O, no store, no platform coupling.
 */

import { parseDimensionRange } from '../../../../frontend/utils/PLC/dimension-range'
import type { DevicePin, ModbusBufferMapping, PLCServer } from '../../../../middleware/shared/ports/types'
import type { PoolVppIoInput } from '../../../../middleware/shared/utils/iec-address'
import type { AddressClass, ParsedAddress } from '../../../../middleware/shared/utils/iec-address/registry'
import {
  activeKindsFor,
  allocateAddresses,
  formatAddress,
  migrateToRegistry,
  parseAddress,
  prefixOf,
  slotRangesOverlap,
} from '../../../../middleware/shared/utils/iec-address/registry'
import {
  extentForDataBlock,
  IMAGE_AREAS_BAREMETAL,
  IMAGE_AREAS_RUNTIME_V4,
  IMAGE_TABLES,
  tableForKey,
} from '../../../../middleware/shared/utils/io-image/tables'
import type {
  AddressProducerCapabilities,
  ServerCapabilities,
} from '../../../../middleware/shared/utils/target-capabilities'
import type { PLCProjectData, PLCVariable } from '../../types/PLC/open-plc'

/**
 * Slots needed per IEC prefix (`%IX`, `%QW`, …).
 *
 * An ABSENT prefix means zero, and zero is a legitimate size: a program with
 * no `%QX` has no reason to carry a `bool_output` image (FR21, BR12). Read it
 * as `sizes[prefix] ?? 0` — never treat a missing key as "unknown", because
 * the floor is always zero and never a minimum.
 *
 * EVERY PREFIX IS COUNTED IN THE UNIT ITS OWN ADDRESS USES: bits for `%QX`,
 * words for `%MW`, dwords for `%MD`. This is the raw high-water mark, with no
 * padding of any kind.
 *
 * Rounding a bit area up to a whole byte belongs to the consumer that needs a
 * whole byte, and only bare metal does: it declares `bool_input[MAX_/8][8]`
 * and divides. `generate-defines.ts` rounds there (FR06, BR04, CON05). Runtime
 * v4 receives the bit count as bits and converts on its own side, where the
 * storage shape is known, and the Modbus config derives exact coil counts
 * rather than padded ones. Padding here would have forced all three to
 * un-pad, and a project exposing six coils would have advertised eight.
 */
export type IoImageSizes = Readonly<Record<string, number>>

/**
 * WHICH contributor set an area's number.
 *
 * Recorded because the number alone cannot be traced back. A project on disk
 * carries producers, a Modbus slave config and an S7comm one all at once, and
 * the image takes the largest of them per area — so "why is `%QW` 1024 here
 * and 8 in the other project?" has three possible answers and today's build
 * log gives none of them. Guessing is the failure mode this removes: the log
 * says where each number came from, so the user changes the right thing.
 *
 * `'declarations'` is a MEMORY-ONLY origin, and the asymmetry is the rule
 * itself. Memory is its own producer (BR14/FR24), so `AT %MW0 : ARRAY [0..9]`
 * sizes `%MW` — without that, a program using scratch memory and no server
 * would be handed zero memory words (BR15). An input or output declaration is
 * checked AGAINST the image and never grows it (FR02), so it can never be the
 * origin of a size.
 */
export type IoImageOrigin = 'producers' | 'modbus-server' | 's7comm-server' | 'declarations'

/** What each sized area's number came from. A prefix absent from `sizes` is
 *  absent here too — zero has no origin to name. */
export type IoImageOrigins = Readonly<Record<string, IoImageOrigin>>

/**
 * A located input or output declaration with no producer at its address —
 * a BR14 violation, which fails the compile (FR20).
 */
export interface UnbackedLocation {
  /** POU that declares it, or `'Global Variables'` for a config global. */
  scope: string
  variableName: string
  /** The offending literal address, e.g. `'%QW3859'`. */
  location: string
  /** IEC prefix of the address, e.g. `'%QW'`. */
  prefix: string
  /** The FIRST slot of the declaration nothing produces. For a scalar this is
   *  the declared address itself; for an array it can be some way into it, and
   *  saying which slot is what makes an array's failure legible. */
  slot: number
  /** Slots the declaration occupies; 1 for a scalar. */
  slotCount: number
}

/**
 * A located declaration in an area the target does not have at all.
 *
 * A different user error from `UnbackedLocation` and worth a different
 * message: there, the area exists and that particular address has nothing
 * behind it; here, the runtime declares no buffer of that kind whatsoever, so
 * no address in it could ever work. Bare metal has no `bool_memory`, which is
 * why `%MX` is silently dropped there today (DOPE-605).
 */
export interface UnsupportedArea {
  /** POU that declares it, or `'Global Variables'` for a config global. */
  scope: string
  variableName: string
  location: string
  prefix: string
}

/** The slice of an S7comm mapping this step reads. Structural rather than
 *  imported so the sizer stays free of the server schema's exact shape. */
interface S7CommMappingLike {
  type: string
  startBuffer: number
}

/**
 * Two declarations driving the same output slot.
 *
 * IEC located addresses are GLOBAL, but the editor's own duplicate check reads
 * one variable list at a time (`validation/variables.ts`), so two POUs can each
 * declare `AT %QX0.0` and both pass. Nothing downstream notices: the generated
 * code assigns to the same storage from two places and the last write in the
 * scan wins, which is a coin toss decided by POU order.
 *
 * Reported for OUTPUTS only. Two POUs reading one input is ordinary -- they
 * read the same value -- and sharing a memory address is what memory is for.
 * An output is the one direction where two writers contradict each other.
 */
export interface DuplicateOutput {
  prefix: string
  /** The address class, carried so the message can render `slot` back into an
   *  address through `formatAddress` rather than reimplementing the bit maths. */
  cls: AddressClass
  /** The first slot both declarations cover, which for two arrays is neither
   *  one's base address. Linear within the prefix space, so for a bit class it
   *  counts BITS — `%QX3.2` is slot 26. Render it with `formatAddress` rather
   *  than showing the number, which no user can map back to what they typed. */
  slot: number
  /** Both sides, in declaration order, each with the address as WRITTEN. */
  first: { scope: string; variableName: string; location: string }
  second: { scope: string; variableName: string; location: string }
}

export interface IoImage {
  sizes: IoImageSizes
  /** Where each sized area's number came from. Same keys as `sizes`. */
  origins: IoImageOrigins
  /** Empty when every input and output declaration is backed. */
  unbacked: UnbackedLocation[]
  /** Empty when every declaration names an area the target actually has. */
  unsupported: UnsupportedArea[]
  /** Empty when no two declarations drive the same output slot. */
  duplicateOutputs: DuplicateOutput[]
}

/* The two area sets are DERIVED, not listed here: which tables exist and
 * which runtime declares each one is stated once, in
 * `middleware/shared/utils/io-image/tables.ts`, and re-exported so the
 * pipeline keeps importing them from the step that uses them. */
export { IMAGE_AREAS_BAREMETAL, IMAGE_AREAS_RUNTIME_V4 }

export interface ComputeIoImageInput {
  /** Compile-ready project data — locations already resolved from aliases to
   *  literal `%…` addresses by `getCompileReadyProjectData`. */
  projectData: PLCProjectData
  /** The board's pin mapping. Pins are producers: a pin IS an address with
   *  hardware behind it. */
  devicePinMapping?: DevicePin[]
  /** `DeviceConfiguration.vendorScreenData`, whose `io-mapping` entries are
   *  the VPP backplane's channels. */
  vendorScreenData?: Record<string, unknown>
  /**
   * Which producers the target keeps active.
   *
   * Must be the same answer the store's recalculation used, or the image
   * would be sized for a producer set other than the one that allocated the
   * addresses. For a target that did not resolve, that answer is
   * `ALL_ADDRESS_PRODUCERS_ACTIVE` and not `EMPTY_CAPABILITIES` — see
   * `activeKindsFor`.
   */
  capabilities: AddressProducerCapabilities
  /**
   * Which servers this target actually runs.
   *
   * Required rather than optional-and-defaulted, for the same reason `areas`
   * is: a forgotten input that silently widens what counts as a producer is
   * the kind of hole that stays open for months. A caller with no target in
   * mind passes every flag false, which sizes nothing from servers -- the
   * conservative answer, since a server that does not run publishes nothing.
   */
  serverCapabilities: ServerCapabilities
  /**
   * The areas the target runtime has buffers for — `IMAGE_AREAS_BAREMETAL` or
   * `IMAGE_AREAS_RUNTIME_V4`.
   *
   * Required rather than optional-and-skipped: there is one call site, and an
   * input that silently disables a compile gate when forgotten is the kind of
   * hole that stays open for months.
   *
   * This is NOT a capacity table per platform — that was considered and
   * rejected, and the sizes here are still derived from the project. It is the
   * set of areas that EXIST, which is a fact of each runtime's own source and
   * not a number anyone maintains.
   */
  areas: ReadonlySet<string>
}

/** `%IX`/`%QX`/`%MX`. */
/** `'%QW'` → `'Q'`. */
function directionOf(prefix: string): string {
  return prefix.charAt(1)
}

/** The running sizes and, for each one, who put it there. */
interface SizeTally {
  sizes: Record<string, number>
  origins: Record<string, IoImageOrigin>
}

/**
 * Raise `tally.sizes[prefix]` to `slots` if it is not already at least that,
 * recording `origin` when it wins.
 *
 * No guard against a non-positive `slots`: the comparison against a default
 * of zero already declines it, so a zero or (hand-edited) negative count
 * leaves the prefix absent, which is how zero is expressed here anyway.
 *
 * STRICTLY greater, so a TIE leaves the earlier claimant named. That is a
 * choice and not an accident: contributors are applied in a fixed order
 * (producers, then Modbus, then S7comm, then memory declarations), so equal
 * claims always resolve the same way and the log is as deterministic as the
 * sizes are (FR07). Naming one
 * of several equal claimants is honest -- it says which one the number is at
 * least as large as -- and naming all of them would make the common case read
 * like a conflict.
 */
function claim(tally: SizeTally, prefix: string, slots: number, origin: IoImageOrigin): void {
  const current = tally.sizes[prefix] ?? 0
  if (slots > current) {
    tally.sizes[prefix] = slots
    tally.origins[prefix] = origin
  }
}

/** Mark slots `[from, from + count)` of `prefix` as having a producer. */
function markBacked(backed: Map<string, Set<number>>, prefix: string, from: number, count: number): void {
  let slots = backed.get(prefix)
  if (!slots) {
    slots = new Set<number>()
    backed.set(prefix, slots)
  }
  for (let slot = from; slot < from + count; slot++) slots.add(slot)
}

/**
 * Contributor A — the address producers, read through the registry.
 *
 * `migrateToRegistry` seeds every channel PINNED at the address it currently
 * holds, so allocating reproduces today's addresses exactly rather than
 * reassigning them. That is what makes this safe to run at compile time: the
 * store is the authority on where producers live, and this only measures the
 * result.
 *
 * Returns both the reach per prefix (which sizes the image) and the exact
 * slots claimed (which backs the BR14 check). They are different questions:
 * the image is a contiguous buffer, so a producer at slot 9 alone still needs
 * ten slots — but slots 0 through 8 have nothing behind them.
 */
/**
 * The VPP backplane's channels, or none.
 *
 * `vendorScreenData` is `devices/configuration.json` read off disk, so its
 * shape is whatever the user — or an older editor — last wrote there. Asserting
 * it into `PoolVppIoInput` and handing it straight to `migrateToRegistry` trusts
 * that; a non-iterable `entries` makes its `for…of` throw, and the compile dies
 * with a TypeError naming a file the user never edited on purpose.
 *
 * The same reasoning `declaredSlotCount` already applies to a missing variable
 * type: a malformed project file must produce a diagnostic or a harmless
 * default, never a crash. Here the harmless default is no VPP channels, which
 * simply sizes those areas from the other producers.
 */
function vppEntries(vendorScreenData: Record<string, unknown> | undefined): PoolVppIoInput {
  const mapping = vendorScreenData?.['io-mapping']
  if (typeof mapping !== 'object' || mapping === null) return { entries: [] }

  const entries = (mapping as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return { entries: [] }

  return { entries } as PoolVppIoInput
}

function producerClaims(input: ComputeIoImageInput, backed: Map<string, Set<number>>): Record<string, number> {
  const registry = migrateToRegistry({
    pinMapping: { pins: input.devicePinMapping ?? [] },
    vendorIoMapping: vppEntries(input.vendorScreenData),
    remoteDevices: input.projectData.remoteDevices,
  })

  const { assignments, slotCounts } = allocateAddresses(registry.consumers, {
    activeKinds: activeKindsFor(input.capabilities),
  })

  for (const address of Object.values(assignments)) {
    const parsed = parseAddress(address)
    /* istanbul ignore next -- unreachable today, and defensive on purpose:
       `migrateToRegistry` drops a channel whose legacy address does not parse
       before it ever reaches the allocator, and an allocated address comes out
       of `formatAddress`. Were that to change, an unparseable address must
       size nothing and back nothing — which is exactly what `slotCounts` does
       with it. */
    if (!parsed) continue
    markBacked(backed, prefixOf(parsed.cls), parsed.linear, 1)
  }

  return { ...slotCounts }
}

/**
 * Contributor B — what the Modbus servers were configured to expose.
 *
 * Only an EXPLICITLY persisted count contributes, and the distinction is
 * load-bearing rather than pedantic. `DEFAULT_BUFFER_MAPPING` is 8192 bits and
 * 1024 registers — precisely today's fixed image — so reading absent counts as
 * a request for the defaults would size every project with a Modbus server
 * back to the constant this whole change exists to remove, and BR10 ("the
 * image may end up smaller, and that is one of the main gains") would never
 * hold for such a project.
 *
 * Absent therefore means "expose whatever the image turns out to be", which is
 * also what FR16 asks of the server: publish the range actually sized, not a
 * limit of its own.
 *
 * THE SCREEN DOES NOT COOPERATE YET, and this comment used to claim it did.
 * `updateServerConfig` (`store/slices/project/slice.ts`) spreads all four
 * groups over `DEFAULT_BUFFER_MAPPING` whenever any one field is edited, so
 * touching a single count persists the whole of 1024/8192 — and every one of
 * those reads here as a deliberate request. A freshly created server is safe
 * (`initializeServerProtocolConfig` seeds no `bufferMapping` at all), but any
 * project whose Modbus screen was ever opened and edited is sized back to the
 * constant this change exists to remove.
 *
 * Fixing that is a store change, and it collides with the Modbus screen
 * rewrite in DOPE-442; it is tracked there rather than papered over here.
 * Projects already on disk carry the materialised defaults either way, so the
 * reducer fix alone does not rescue them — telling a deliberate 1024 from a
 * materialised one needs a per-segment marker or a migration.
 *
 * What this module can honestly say is the rule it applies: a persisted count
 * sizes an area, an absent one does not.
 *
 * Exposure BACKS the addresses it covers as well as sizing them: a `%QW` the
 * server publishes has something reading it, which is exactly what BR14 asks
 * of an output.
 *
 * WHICH server is deliberately the one `generateModbusSlaveConfig` picks: the
 * first `modbus-tcp` entry carrying a config, `enabled` not consulted. That is
 * not an endorsement of either choice — it is the config file that actually
 * ships, and sizing for exposure the device never receives (or missing
 * exposure it does) is the drift worth avoiding. If that selection changes,
 * this has to change with it.
 */
function serverExposure(
  servers: PLCServer[] | undefined,
  serverCapabilities: ServerCapabilities,
  tally: SizeTally,
  backed: Map<string, Set<number>>,
): void {
  // EVERY PROTOCOL, but still the FIRST server of each one.
  //
  // The generalisation that was missing is across protocols: a project with an
  // S7comm server and no Modbus one used to size nothing at all from its
  // servers, because this function only ever looked for `modbus-tcp`.
  //
  // What is NOT generalised is the count per protocol, and that is deliberate.
  // Each emitter ships one file built from the FIRST server of its protocol
  // carrying a config -- `generateModbusSlaveConfig` and `generateS7commConfig`
  // both `.find(...)`. A second server of the same protocol never reaches the
  // device, so sizing for its exposure would reserve memory nothing can use,
  // which is BR10 backwards. The rule here mirrors the emitters rather than
  // inventing one, and if they ever ship more than one, this follows.
  //
  // SCOPED TO THE TARGET, exactly as the producer claims are, and now per
  // protocol because there are two of them.
  //
  // A server config outlives a target change: retarget a project from Runtime
  // v4 to a bare-metal board and `servers` stays in project.json, hidden in
  // the UI rather than removed, while `generateRuntimeConfs` -- the only route
  // by which a slave config reaches a device -- runs under `isRuntimeV4`
  // alone. Sizing from it anyway hands the firmware `MAX_*` macros derived
  // from a config that board will never run; with the materialised Modbus
  // defaults that is 8192 bits and four areas at 1024, which most MCU targets
  // will not even link.
  //
  // The backing half is worse than the sizing half. The exposure VOUCHES for
  // the addresses it covers, so `AT %QX0.0 : BOOL` would pass the BR14 gate on
  // a target where nothing whatsoever produces it -- "inside the image" and
  // "has a producer" both answered by a file the target never receives.
  const list = servers ?? []
  const modbus = serverCapabilities.modbusTcpServer
    ? list.find((server) => server.protocol === 'modbus-tcp' && server.modbusSlaveConfig)
    : undefined
  const s7comm = serverCapabilities.s7Server
    ? list.find((server) => server.protocol === 's7comm' && server.s7commSlaveConfig)
    : undefined

  if (modbus?.modbusSlaveConfig) modbusExposure(modbus.modbusSlaveConfig.bufferMapping, tally, backed)
  if (s7comm?.s7commSlaveConfig) s7commExposure(s7comm.s7commSlaveConfig, tally, backed)
}

/**
 * What a Modbus server publishes.
 *
 * EXPOSURE SIZES EVERY SEGMENT, BUT ONLY BACKS THE WRITABLE ONES.
 *
 * Backing means "something on the other side gives this address meaning",
 * which for BR14 is what the area needs to not be inert. Holding registers
 * and coils are writable by the master, so a `%QW` or `%QX` the server
 * publishes has a counterpart: the master reads what the program wrote, or
 * writes it itself. Either way it is drained.
 *
 * Discrete inputs and input registers are READ-ONLY to the master. Nothing
 * writes `%IX` or `%IW` through them -- the server only publishes whatever is
 * already there. So exposing them cannot make an input backed, and treating
 * it as if it did would let `AT %IW7 : INT` pass the gate with no pin, no
 * master point and no EtherCAT channel anywhere, which is exactly the
 * declaration BR14 exists to catch.
 *
 * They still SIZE, because the server has to have the storage to read from;
 * they just do not vouch for anything living in it.
 */
function modbusExposure(
  mapping: ModbusBufferMapping | undefined,
  tally: SizeTally,
  backed: Map<string, Set<number>>,
): void {
  if (!mapping) return

  // Each IEC segment is laid out from index 0 of its own prefix space; only
  // the Modbus offsets are sequential across segments. `address-mapping.ts`
  // is the authority on that layout, and it agrees with the runtime plugin.
  const sizing: Array<[string, number | undefined]> = [
    ['%QW', mapping.holdingRegisters?.qwCount],
    ['%MW', mapping.holdingRegisters?.mwCount],
    ['%MD', mapping.holdingRegisters?.mdCount],
    ['%ML', mapping.holdingRegisters?.mlCount],
    ['%QX', mapping.coils?.qxBits],
    ['%MX', mapping.coils?.mxBits],
    ['%IX', mapping.discreteInputs?.ixBits],
    ['%IW', mapping.inputRegisters?.iwCount],
  ]
  const WRITABLE_BY_THE_MASTER = new Set(['%QW', '%MW', '%MD', '%ML', '%QX', '%MX'])

  for (const [prefix, count] of sizing) {
    // A count of zero is the `%MX` default and a legitimate answer: the
    // segment exists and is switched off, so it exposes nothing and sizes
    // nothing.
    if (count === undefined || count <= 0) continue
    claim(tally, prefix, count, 'modbus-server')
    if (WRITABLE_BY_THE_MASTER.has(prefix)) markBacked(backed, prefix, 0, count)
  }
}

/**
 * What an S7comm server publishes.
 *
 * EVERY BLOCK BACKS WHAT IT COVERS, INPUTS INCLUDED -- and that is the
 * opposite of the Modbus answer above, for a reason that is a fact about the
 * protocols rather than a preference.
 *
 * Modbus discrete inputs and input registers are read-only to the master BY
 * THE PROTOCOL: there is no function code that writes them, so exposing an
 * `%IX` through Modbus cannot put anything into it. S7comm has no such
 * restriction, and the OpenPLC plugin implements none: its write path
 * (`write_buffer_to_openplc_journal`, s7comm_plugin.cpp) dispatches every
 * buffer type including `BUFFER_TYPE_BOOL_INPUT`, `BUFFER_TYPE_INT_INPUT`,
 * `BUFFER_TYPE_DINT_INPUT` and `BUFFER_TYPE_LINT_INPUT`. An S7 client writes
 * an input table as readily as an output one.
 *
 * So BR14's question -- is there something external giving this address
 * meaning -- answers yes in both directions here. A block mapped onto
 * `int_input` is a producer for the `%IW`s it covers, and a program reading
 * them is reading what the client wrote rather than a constant zero.
 *
 * Both the data blocks and the three system areas (PE, PA, MK) are read: they
 * carry the same mapping shape and reach the same tables, so leaving the
 * system areas out would size an area the server is serving.
 */
function s7commExposure(
  config: NonNullable<PLCServer['s7commSlaveConfig']>,
  tally: SizeTally,
  backed: Map<string, Set<number>>,
): void {
  const blocks: Array<{ mapping?: S7CommMappingLike; sizeBytes: number }> = [
    ...(config.dataBlocks ?? []),
    ...[config.systemAreas?.peArea, config.systemAreas?.paArea, config.systemAreas?.mkArea]
      .filter((area): area is NonNullable<typeof area> => Boolean(area?.enabled))
      .map((area) => ({ mapping: area.mapping, sizeBytes: area.sizeBytes })),
  ]

  /* A DISABLED SERVER SIZES BUT DOES NOT BACK.
   *
   * Backing is the claim that something external gives the address meaning,
   * and a server the runtime will not serve gives nothing meaning. With inputs
   * backed (see above), skipping this check would let `AT %IW7 : INT` compile
   * clean against a server that is switched off -- genuinely nothing producing
   * it, which is the declaration BR14 exists to refuse.
   *
   * It still SIZES, deliberately, because `generateS7commConfig` ships the
   * config regardless of `enabled` -- so the storage the file describes has to
   * exist. That the emitter ignores `enabled` looks like a defect of its own,
   * and the Modbus emitter has the same shape; settling it is what would let
   * a disabled server stop sizing too. Until then, sizing follows the file
   * that ships and backing follows what will actually run.
   */
  const serving = config.server?.enabled !== false

  for (const block of blocks) {
    // A system area may be enabled with no mapping yet, which publishes
    // nothing and sizes nothing.
    if (!block.mapping) continue
    const table = tableForKey(block.mapping.type)
    /* istanbul ignore next -- the schema admits only table names, so a block
       naming something else cannot reach here today. Sizing nothing for it is
       the safe reading if that ever changes. */
    if (!table) continue

    const { start, end } = extentForDataBlock(table, block.mapping.startBuffer, block.sizeBytes)
    if (end <= start) continue

    // SIZES to the high-water mark and BACKS only what the block covers, and
    // the two are not the same range. A block at startBuffer 100 makes the
    // area 104 long because the image is contiguous, but it produces nothing
    // whatsoever below 100 -- backing from zero would vouch for a hundred
    // addresses the plugin never writes, and `AT %IW0 : INT` would compile
    // clean and read zero forever on the machine. That is the declaration BR14
    // exists to refuse, and it is the same per-slot rule `producerClaims` and
    // the unbacked loop already apply.
    //
    // The Modbus path above may legitimately mark from zero: its segments
    // always start at IEC index 0. S7comm blocks do not, which is what
    // startBuffer is for.
    claim(tally, table.prefix, end, 's7comm-server')
    if (serving) markBacked(backed, table.prefix, start, end - start)
  }
}

/**
 * Every located variable in the project, paired with the scope declaring it.
 *
 * Covers POU-local `VAR … AT` and CONFIGURATION `VAR_GLOBAL` — the only two
 * places IEC allows a location, and the two the editor's own validation
 * permits.
 */
function* locatedVariables(
  projectData: PLCProjectData,
): Generator<{ scope: string; name: string; location: string; slotCount: number }> {
  for (const pou of projectData.pous) {
    for (const variable of pou.data.variables) {
      if (variable.location)
        yield {
          scope: pou.data.name,
          name: variable.name,
          location: variable.location,
          slotCount: declaredSlotCount(variable.type),
        }
    }
  }
  for (const variable of projectData.configuration.resource.globalVariables) {
    if (variable.location)
      yield {
        scope: 'Global Variables',
        name: variable.name,
        location: variable.location,
        slotCount: declaredSlotCount(variable.type),
      }
  }
}

/**
 * How many consecutive slots a declaration claims from its address.
 *
 * A scalar claims one. A located ARRAY claims one per element, laid out from
 * the declared address — `AT %MW60 : ARRAY [0..66] OF WORD` occupies `%MW60`
 * through `%MW126` (openplc-editor#565), so sizing from the base address alone
 * would produce an image the declaration's tail runs off the end of.
 *
 * Falls back to 1 for anything whose extent cannot be read: a malformed
 * dimension, a multi-dimensional array (which the compiler rejects for a
 * located variable anyway), or a missing `data` block. Under-counting costs a
 * missed slot, whereas guessing high would reserve memory nothing uses and, on
 * the validation side, refuse builds that are fine.
 */
function declaredSlotCount(variableType: PLCVariable['type'] | undefined): number {
  // `type` is schema-required, but project.json is a file on disk that the
  // user (or an older editor) can have written; a missing type must not crash
  // the build with a TypeError instead of producing a diagnostic.
  if (variableType?.definition !== 'array') return 1

  const dimensions = variableType.data?.dimensions
  if (!dimensions || dimensions.length !== 1) return 1

  // `parseDimensionRange`, not a regex of this module's own, because the
  // editor already reserves slots for a located array through it
  // (`getArrayTotalElements` -> `slotsClaimedBy`). A second parser here means
  // the two can disagree about the same declaration, and they did: this one
  // rejected a NEGATIVE lower bound and fell back to one slot, so
  // `AT %MW0 : ARRAY [-5..5] OF WORD` reserved eleven words in the editor and
  // sized one in the image — eleven words written into a one-word buffer, and
  // on %I/%Q a tail that runs past every producer without the gate noticing.
  const range = parseDimensionRange(dimensions[0]?.dimension ?? '')
  if (!range) return 1
  return range.upper - range.lower + 1
}

/**
 * Size the project's I/O image, and report every declaration the target
 * cannot honour.
 *
 * Deterministic: the same project yields the same sizes and the same
 * diagnostics in the same order (FR07). Nothing here reads a clock, a random
 * source, or the order a `Map` happened to be built in — `sizes` is emitted
 * through a sorted key list by the callers that serialise it, and both
 * diagnostic lists follow declaration order (POUs, then globals).
 */
export function computeIoImage(input: ComputeIoImageInput): IoImage {
  const backed = new Map<string, Set<number>>()
  // ORDER IS THE TIE-BREAK, and it is fixed here rather than anywhere else:
  // producers, then the servers, then the memory declarations further down.
  // `claim` only overwrites on a strictly larger number, so equal claims leave
  // the earlier contributor named and the log never changes between two runs
  // of the same project (FR07).
  const tally: SizeTally = { sizes: {}, origins: {} }
  for (const [prefix, count] of Object.entries(producerClaims(input, backed))) {
    claim(tally, prefix, count, 'producers')
  }
  serverExposure(input.projectData.servers, input.serverCapabilities, tally, backed)

  const sizes = tally.sizes

  // A producer or a server can only have claimed an area the target has, but
  // project.json is a file on disk and a target switch moves the goalposts, so
  // never SIZE an area the runtime declares no buffer for — the emitters would
  // otherwise be asked for a macro or a table key that does not exist.
  for (const prefix of Object.keys(sizes)) {
    if (!input.areas.has(prefix)) {
      delete sizes[prefix]
      delete tally.origins[prefix]
    }
  }

  const unbacked: UnbackedLocation[] = []
  const unsupported: UnsupportedArea[] = []
  const duplicateOutputs: DuplicateOutput[] = []
  /**
   * Outputs already declared, per prefix, as RANGES rather than slots.
   *
   * One entry per declaration, not per element. The obvious version kept a
   * slot -> owner map, which puts one Map entry — with an object value — per
   * declared element in the Electron main process: `AT %QW0 : ARRAY
   * [0..10000000] OF WORD` inserts ten million of them before the platform
   * compiler ever gets to refuse the size. That is the same blow-up the memory
   * branch below carries a comment about having removed, and `slotRangesOverlap`
   * is the primitive the registry already owns for exactly this.
   */
  const declaredOutputs = new Map<
    string,
    Array<{ at: ParsedAddress; slots: number; scope: string; variableName: string; location: string }>
  >()

  for (const { scope, name, location, slotCount } of locatedVariables(input.projectData)) {
    const parsed = parseAddress(location)
    // Not a literal address. Aliases were resolved before the pipeline ran, so
    // anything still unparseable here resolved to nothing, which makes the
    // variable UNLOCATED rather than out of range — the amber orphan glyph in
    // the editor is what surfaces that, and it is not this step's business.
    if (parsed === null) continue

    const prefix = prefixOf(parsed.cls)

    // The area does not exist on this target, so no address in it could work.
    // Reported ahead of everything else, including for memory: FR24 protects a
    // memory declaration from failing for want of a PRODUCER, and this is a
    // different failure. It is also the one case where memory can fail, which
    // is why `%MX` on bare metal deserves its own message rather than being
    // dropped in silence as it is today (DOPE-605).
    if (!input.areas.has(prefix)) {
      unsupported.push({ scope, variableName: name, location, prefix })
      continue
    }

    if (directionOf(prefix) === 'Q') {
      // Range against range, so a located array overlapping another one is
      // caught at the slot they share rather than only when their base
      // addresses match — and at a cost proportional to the number of
      // DECLARATIONS rather than the number of elements they cover.
      const declared = declaredOutputs.get(prefix) ?? []
      const clash = declared.find((other) => slotRangesOverlap(other.at, other.slots, parsed, slotCount))
      if (clash) {
        duplicateOutputs.push({
          prefix,
          cls: parsed.cls,
          // The first slot the two actually share, which for two arrays is
          // neither one's base address.
          slot: Math.max(clash.at.linear, parsed.linear),
          first: { scope: clash.scope, variableName: clash.variableName, location: clash.location },
          second: { scope, variableName: name, location },
        })
      }
      // One entry per declaration, reported once per pair: a 4000-element
      // array declared twice is one mistake, not four thousand errors.
      declared.push({ at: parsed, slots: slotCount, scope, variableName: name, location })
      declaredOutputs.set(prefix, declared)
    }

    if (directionOf(prefix) === 'M') {
      // Memory is its own producer (BR14), so the declaration SIZES the area
      // and is never reported unbacked (FR24). Without this a program using
      // scratch memory and no Modbus server would be handed zero memory words
      // (BR15).
      // No `markBacked` here, deliberately. `backed` is read only on the
      // input/output path below, so marking memory slots was dead — and it was
      // dead at a cost: the loop ran once per declared element, so
      // `AT %MW0 : ARRAY [0..10000000] OF WORD` inserted ten million Set
      // entries in the main process before the platform compiler ever got to
      // refuse the size.
      claim(tally, prefix, parsed.linear + slotCount, 'declarations')
      continue
    }

    // Input and output: validated against the image, never growing it (FR02).
    // The check is per SLOT and not against the size, because the image is a
    // contiguous buffer while the producers inside it need not be: an address
    // in a gap between two producers is within the image and still has nothing
    // behind it, which is the case BR14 exists for.
    const slots = backed.get(prefix)
    let firstUnbacked: number | undefined
    for (let slot = parsed.linear; slot < parsed.linear + slotCount; slot++) {
      if (slots?.has(slot)) continue
      firstUnbacked = slot
      break
    }
    if (firstUnbacked === undefined) continue

    unbacked.push({
      scope,
      variableName: name,
      location,
      prefix,
      slot: firstUnbacked,
      slotCount,
    })
  }

  return { sizes, origins: tally.origins, unbacked, unsupported, duplicateOutputs }
}

/**
 * One-line, actionable rendering of a BR14 violation.
 *
 * Says which slot has nothing behind it rather than only echoing the address,
 * because for an array the declared address is usually fine and the LENGTH is
 * what runs past the producers — pointing at an address that looks perfectly
 * legal explains nothing.
 *
 * "Producer" is spelled out in terms the user configured rather than as
 * jargon: what they are being asked for is an I/O module, a Modbus point, an
 * EtherCAT channel, a pin, or an entry in the Modbus server's exposure.
 */
export function describeUnbackedLocation(issue: UnbackedLocation): string {
  const reach =
    issue.slotCount > 1
      ? `whose ${issue.slotCount} elements reach past slot ${issue.slot} of ${issue.prefix}`
      : `which is slot ${issue.slot} of ${issue.prefix}`
  return (
    `${issue.scope}: variable "${issue.variableName}" is located at ${issue.location}, ${reach}, ` +
    'and nothing produces that address — add the I/O module, Modbus point, EtherCAT channel or pin ' +
    'that drives it, expose it on the Modbus server, or move the variable to a memory address (%M).'
  )
}

/**
 * One-line rendering of two declarations driving the same output.
 *
 * Names BOTH, because either one may be the mistake and the user cannot tell
 * which from an address alone -- and because the two are usually in different
 * POUs, which is the whole reason the editor's per-list check missed it.
 *
 * WORDED AS A WARNING, not a refusal. IEC 61131-3 does not forbid declaring one
 * located variable in two POUs, so the compile reports this and carries on:
 * which write survives is the programmer's call. The sentence therefore states
 * the consequence -- last write wins, and POU order decides which -- and offers
 * the fix conditionally, rather than telling them to change something.
 */
export function describeDuplicateOutput(issue: DuplicateOutput): string {
  const where =
    issue.first.scope === issue.second.scope
      ? `both in ${issue.first.scope}`
      : `${issue.first.scope} and ${issue.second.scope}`

  /* The ADDRESS, not the slot number. `slot` is linear within the prefix
   * space, so for a bit class it counts bits and two variables at %QX3.2 would
   * be reported as "slot 26" — leaving the user to divide by eight to get back
   * to what they typed, in the commonest duplicate-output case there is. */
  const at = formatAddress(issue.cls, issue.slot)
  const addresses =
    issue.first.location === issue.second.location
      ? `both at ${issue.first.location}`
      : `${issue.first.location} and ${issue.second.location}, which overlap at ${at}`

  return (
    `Two variables drive the same output: "${issue.first.variableName}" and ` +
    `"${issue.second.variableName}" (${where}), ${addresses}. IEC located addresses ` +
    'are global, so the last write in the scan wins and which one that is depends ' +
    'on POU order. If that is not what you meant, give one of them another address, ' +
    'or have one read the other rather than both writing.'
  )
}

/**
 * One-line rendering of a declaration in an area the target does not have.
 *
 * Kept separate from `describeUnbackedLocation` because the remedy is
 * different: no address in this area will ever work on this target, so the
 * answer is a different area or a different target, never another producer.
 */
export function describeUnsupportedArea(issue: UnsupportedArea, boardTarget: string): string {
  return (
    `${issue.scope}: variable "${issue.variableName}" is located at ${issue.location}, but ` +
    `"${boardTarget}" has no ${issue.prefix} area at all — its runtime declares no buffer of that ` +
    'kind, so no address in it can be read or written. Use a different address area.'
  )
}

/** How each origin reads in the build log. Written out rather than derived
 *  from the union member, because "modbus-server" is an identifier and the
 *  log is read by someone who did not write it. */
const ORIGIN_LABELS: Record<IoImageOrigin, string> = {
  producers: 'address producers',
  'modbus-server': 'Modbus server exposure',
  's7comm-server': 'S7comm server exposure',
  declarations: 'memory declarations in the program',
}

/**
 * The sized areas, one line each, saying WHERE the number came from.
 *
 * This exists because the size on its own is untraceable. Three contributors
 * can size an area and the image takes the largest, so a user looking at
 * `%QW = 1024` cannot tell whether the program's producers need that much or
 * whether a Modbus slave config nobody has opened in a year is holding the
 * floor up — and the difference decides what they change. The number alone
 * makes them guess; this says it.
 *
 * It matters most for a project that already exists on disk. A new project
 * grows its producers under the user's eye, but an imported one arrives with a
 * `bufferMapping` and an `s7commSlaveConfig` already in it, and that is
 * exactly when "why is this area this big?" has no answer in the editor.
 *
 * IMAGE_TABLES ORDER, not insertion order and not alphabetical: the same
 * order `image.conf` is written in and the runtime header declares, so a
 * reader can go down the log, the file and the header in step. Areas that came
 * out at zero are left out — they have no number to attribute, and listing all
 * fourteen every build would bury the handful that carry something.
 */
export function describeIoImageSizes(image: IoImage): string[] {
  return IMAGE_TABLES.filter((table) => (image.sizes[table.prefix] ?? 0) > 0).map((table) => {
    const size = image.sizes[table.prefix]
    const origin = image.origins[table.prefix]
    /* istanbul ignore next -- `origins` is written by the same `claim` that
       writes `sizes`, so a sized area always has one. Defensive because the
       two are separate records: a future contributor that sets a size without
       going through `claim` must not make the log lie about its source. */
    const from = origin ? ORIGIN_LABELS[origin] : 'an unrecorded source'
    // Every unit name is a plural noun, so one of anything drops the final s.
    const unit = size === 1 ? table.unit.slice(0, -1) : table.unit
    return `${table.prefix} sized to ${size} ${unit} from ${from}`
  })
}
