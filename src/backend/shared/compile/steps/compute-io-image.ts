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

import type { DevicePin, ModbusBufferMapping, PLCServer } from '../../../../middleware/shared/ports/types'
import type { PoolVppIoInput } from '../../../../middleware/shared/utils/iec-address'
import {
  activeKindsFor,
  allocateAddresses,
  migrateToRegistry,
  parseAddress,
  prefixOf,
} from '../../../../middleware/shared/utils/iec-address/registry'
import type { AddressProducerCapabilities } from '../../../../middleware/shared/utils/target-capabilities'
import type { PLCProjectData, PLCVariable } from '../../types/PLC/open-plc'

/** Bit areas are declared `[MAX_/8][8]` in the firmware, so a size that is not
 *  a whole number of bytes leaves the slots in the partial byte
 *  unaddressable (FR06, BR04, CON05). */
const BITS_PER_BYTE = 8

/**
 * Slots needed per IEC prefix (`%IX`, `%QW`, …).
 *
 * An ABSENT prefix means zero, and zero is a legitimate size: a program with
 * no `%QX` has no reason to carry a `bool_output` image (FR21, BR12). Read it
 * as `sizes[prefix] ?? 0` — never treat a missing key as "unknown", because
 * the floor is always zero and never a minimum.
 *
 * Bit prefixes are counted in BITS and always a multiple of 8. Every other
 * prefix is counted in its own unit (words for `%MW`, dwords for `%MD`, …),
 * which is the unit the firmware arrays and the runtime tables use.
 */
export type IoImageSizes = Readonly<Record<string, number>>

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

export interface IoImage {
  sizes: IoImageSizes
  /** Empty when every input and output declaration is backed. */
  unbacked: UnbackedLocation[]
  /** Empty when every declaration names an area the target actually has. */
  unsupported: UnsupportedArea[]
}

/**
 * The areas the bare-metal firmware declares buffers for.
 *
 * Read off the `extern` declarations in `resources/sources/arduino/openplc.h`:
 * `bool_input`, `bool_output`, `int_input`, `int_output`, `real_input`,
 * `real_output`, `int_memory`, `dint_memory`, `lint_memory`. There is no
 * byte-addressed buffer of any kind and no bit-addressed MEMORY area, so
 * `%IB`, `%QB`, `%MB` and `%MX` name storage that does not exist.
 *
 * Deliberately the larger of the header's two MCU branches. The small-AVR
 * branch (ATmega328P and friends) declares no `real_*` and no memory arrays at
 * all, and telling the two apart would mean mapping an arduino-cli FQBN back
 * to its MCU define — a mapping the editor does not otherwise keep and that
 * would silently rot as cores are added. Permissive is the safe direction: the
 * cost is a variable that stays inert exactly as it does today, while being
 * strict would refuse to build projects that have been building for years.
 */
export const IMAGE_AREAS_BAREMETAL: ReadonlySet<string> = new Set([
  '%IX',
  '%QX',
  '%IW',
  '%QW',
  '%ID',
  '%QD',
  '%MW',
  '%MD',
  '%ML',
])

/**
 * The areas Runtime v4 declares tables for — the fourteen of
 * `core/src/plc_app/image_tables.h`, the same fourteen the S7comm buffer
 * enumeration in `types/PLC/open-plc.ts` names.
 *
 * Note the one gap: there is `byte_input` and `byte_output` but no
 * `byte_memory`, so `%MB` has no storage on v4 either.
 */
export const IMAGE_AREAS_RUNTIME_V4: ReadonlySet<string> = new Set([
  '%IX',
  '%QX',
  '%MX',
  '%IB',
  '%QB',
  '%IW',
  '%QW',
  '%MW',
  '%ID',
  '%QD',
  '%MD',
  '%IL',
  '%QL',
  '%ML',
])

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
function isBitPrefix(prefix: string): boolean {
  return prefix.endsWith('X')
}

/** `'%QW'` → `'Q'`. */
function directionOf(prefix: string): string {
  return prefix.charAt(1)
}

/**
 * Raise `sizes[prefix]` to `slots` if it is not already at least that.
 *
 * No guard against a non-positive `slots`: the comparison against a default
 * of zero already declines it, so a zero or (hand-edited) negative count
 * leaves the prefix absent, which is how zero is expressed here anyway.
 */
function claim(sizes: Record<string, number>, prefix: string, slots: number): void {
  const current = sizes[prefix] ?? 0
  if (slots > current) sizes[prefix] = slots
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
function producerClaims(input: ComputeIoImageInput, backed: Map<string, Set<number>>): Record<string, number> {
  const registry = migrateToRegistry({
    pinMapping: { pins: input.devicePinMapping ?? [] },
    vendorIoMapping: (input.vendorScreenData?.['io-mapping'] as PoolVppIoInput | undefined) ?? { entries: [] },
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
 * limit of its own. The Modbus server screen cooperates — it writes a count
 * only when the user changes it away from the default — so a persisted count
 * is a deliberate request, and a deliberate request is what sizes an area.
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
function serverExposure(servers: PLCServer[] | undefined, backed: Map<string, Set<number>>): Record<string, number> {
  const sizes: Record<string, number> = {}
  const server = (servers ?? []).find((entry) => entry.protocol === 'modbus-tcp' && entry.modbusSlaveConfig)
  const mapping: ModbusBufferMapping | undefined = server?.modbusSlaveConfig?.bufferMapping

  if (mapping) {
    // Each IEC segment is laid out from index 0 of its own prefix space; only
    // the Modbus offsets are sequential across segments. `address-mapping.ts`
    // is the authority on that layout, and it agrees with the runtime plugin.
    const counts: Array<[string, number | undefined]> = [
      ['%QW', mapping.holdingRegisters?.qwCount],
      ['%MW', mapping.holdingRegisters?.mwCount],
      ['%MD', mapping.holdingRegisters?.mdCount],
      ['%ML', mapping.holdingRegisters?.mlCount],
      ['%QX', mapping.coils?.qxBits],
      ['%MX', mapping.coils?.mxBits],
      ['%IX', mapping.discreteInputs?.ixBits],
      ['%IW', mapping.inputRegisters?.iwCount],
    ]

    for (const [prefix, count] of counts) {
      // A count of zero is the `%MX` default and a legitimate answer: the
      // segment exists and is switched off, so it exposes nothing and sizes
      // nothing.
      if (count === undefined || count <= 0) continue
      claim(sizes, prefix, count)
      markBacked(backed, prefix, 0, count)
    }
  }

  return sizes
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

  const bounds = /^\s*(\d+)\s*\.\.\s*(\d+)\s*$/.exec(dimensions[0]?.dimension ?? '')
  if (!bounds) return 1

  const start = Number(bounds[1])
  const end = Number(bounds[2])
  return end >= start ? end - start + 1 : 1
}

/** Round a bit area up to a whole byte (FR06). */
function roundBitAreas(sizes: Record<string, number>): void {
  for (const prefix of Object.keys(sizes)) {
    if (!isBitPrefix(prefix)) continue
    sizes[prefix] = Math.ceil(sizes[prefix] / BITS_PER_BYTE) * BITS_PER_BYTE
  }
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
  const sizes: Record<string, number> = producerClaims(input, backed)

  for (const [prefix, count] of Object.entries(serverExposure(input.projectData.servers, backed))) {
    claim(sizes, prefix, count)
  }

  // A producer or a server can only have claimed an area the target has, but
  // project.json is a file on disk and a target switch moves the goalposts, so
  // never SIZE an area the runtime declares no buffer for — the emitters would
  // otherwise be asked for a macro or a table key that does not exist.
  for (const prefix of Object.keys(sizes)) {
    if (!input.areas.has(prefix)) delete sizes[prefix]
  }

  const unbacked: UnbackedLocation[] = []
  const unsupported: UnsupportedArea[] = []

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

    if (directionOf(prefix) === 'M') {
      // Memory is its own producer (BR14), so the declaration SIZES the area
      // and is never reported unbacked (FR24). Without this a program using
      // scratch memory and no Modbus server would be handed zero memory words
      // (BR15).
      claim(sizes, prefix, parsed.linear + slotCount)
      markBacked(backed, prefix, parsed.linear, slotCount)
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

  roundBitAreas(sizes)

  return { sizes, unbacked, unsupported }
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
