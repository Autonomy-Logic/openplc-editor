/**
 * Module auto-detection for a module-slots backplane: reading the device's
 * answer and planning how it replaces the project's slot configuration.
 *
 * Both halves are pure. Nothing here writes to the store; the layout shows the
 * plan, asks the user, and only then writes the planned slots.
 */

/** One module the device reported, at a 1-based slot. */
export interface DiscoveredModule {
  slot: number
  hwId: string
}

/** Where the module list sits in the answer and which keys name slot and hardware id. */
export interface DiscoveryResultMapping {
  path: string
  slotField: string
  moduleIdField: string
}

export type DiscoveryParseResult = { ok: true; modules: DiscoveredModule[] } | { ok: false; error: string }

export interface DiscoveryParseOptions {
  /** Highest slot number the section has. */
  maxSlots: number
  /** Stackable sections hold modules from slot 1 with no gap, so the answer must too. */
  dense: boolean
}

const UNREADABLE = 'The device returned a module list this editor cannot read.'

/**
 * Read the module list out of a successful plugin answer.
 *
 * Slots must be whole numbers from 1 to `maxSlots` with no repeat (and, when
 * `dense`, no gap from slot 1). A hardware id is a non-empty string or a
 * non-negative integer. Anything else is refused whole rather than applied in part.
 */
export function parseDiscoveredModules(
  data: Record<string, unknown>,
  mapping: DiscoveryResultMapping,
  options: DiscoveryParseOptions,
): DiscoveryParseResult {
  let node: unknown = data
  for (const key of mapping.path.split('.')) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return { ok: false, error: UNREADABLE }
    node = (node as Record<string, unknown>)[key]
  }
  if (!Array.isArray(node)) return { ok: false, error: UNREADABLE }

  const modules: DiscoveredModule[] = []
  for (const item of node) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: UNREADABLE }
    const record = item as Record<string, unknown>
    const slot = record[mapping.slotField]
    const hwId = record[mapping.moduleIdField]
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1) return { ok: false, error: UNREADABLE }
    const id = readHwId(hwId)
    if (id === null) return { ok: false, error: UNREADABLE }
    modules.push({ slot, hwId: id })
  }

  modules.sort((a, b) => a.slot - b.slot)
  for (let i = 0; i < modules.length; i++) {
    if (i > 0 && modules[i].slot === modules[i - 1].slot) return { ok: false, error: UNREADABLE }
    // Slot numbers count fixed slots too, so a dense answer starts at slot 1 even when that slot is built in.
    if (options.dense && modules[i].slot !== i + 1) {
      return {
        ok: false,
        error: `The device reported no module at slot ${i + 1}, but this section holds modules from slot 1 with no gaps.`,
      }
    }
  }
  const last = modules[modules.length - 1]
  if (last && last.slot > options.maxSlots) {
    return {
      ok: false,
      error: `The device reported a module at slot ${last.slot}, but only ${options.maxSlots} slots are available.`,
    }
  }
  return { ok: true, modules }
}

function readHwId(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null
  // BigInt keeps every digit of a large integer, where String() would switch to exponent notation.
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value).toString()
  return null
}

/**
 * Hardware ids compare as integers when both are hex (`0x...`) or decimal, so
 * `0x00abcdef`, `0x00ABCDEF` and `11259375` match; otherwise as case-insensitive text.
 */
export function hwIdsEqual(a: string, b: string): boolean {
  const na = hwIdNumber(a)
  const nb = hwIdNumber(b)
  if (na !== null && nb !== null) return na === nb
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function hwIdNumber(value: string): bigint | null {
  const text = value.trim()
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(`0x${text.slice(2)}`)
  if (/^[0-9]+$/.test(text)) return BigInt(text)
  return null
}

export type SlotFieldValue = string | number | boolean
export type SlotConfigMap = Record<string, Record<string, SlotFieldValue>>

/** The module fields the plan reads. */
export interface DiscoveryModuleDef {
  id: string
  name: string
  hwId?: string
  fixed?: boolean
}

export type SlotChangeKind = 'keep' | 'replace' | 'add' | 'remove'

export interface SlotChange {
  /** 1-based slot number. */
  slot: number
  kind: SlotChangeKind
  /** Module in the project before the change; absent for `add`. */
  from?: { id: string; name: string }
  /** Module after the change; absent for `remove`. */
  to?: { id: string; name: string }
}

export interface MergeDiscoveredModulesArgs {
  /** Current slot list, one entry per slot (null = empty). */
  slots: (string | null)[]
  slotsConfig: SlotConfigMap
  modules: DiscoveryModuleDef[]
  detected: DiscoveredModule[]
  maxSlots: number
  /** 0-based index of the built-in slot that is never replaced or removed, or null. */
  lockedSlotIndex: number | null
}

export type MergeDiscoveredModulesResult =
  | {
      ok: true
      slots: (string | null)[]
      slotsConfig: SlotConfigMap
      /** One entry per slot that holds a module before or after; `keep` included. */
      changes: SlotChange[]
      /** True when at least one slot is replaced, added or removed. */
      changed: boolean
    }
  | { ok: false; error: string }

/**
 * Plan the slot configuration the detected modules describe.
 *
 * A slot whose module has the detected hardware id is kept with its settings
 * object untouched. A different or new module goes in with no stored settings,
 * which is how the layout represents defaults. A project slot the device did
 * not report is emptied. An id the package does not know, an id shared by two
 * modules, or a report at a built-in slot that cannot be confirmed refuses the
 * whole plan.
 */
export function mergeDiscoveredModules(args: MergeDiscoveredModulesArgs): MergeDiscoveredModulesResult {
  const { slots, slotsConfig, modules, detected, maxSlots, lockedSlotIndex } = args

  const beyond = detected.find((d) => d.slot > maxSlots)
  if (detected.length > maxSlots || beyond) {
    return {
      ok: false,
      error: beyond
        ? `The device reported a module at slot ${beyond.slot}, but only ${maxSlots} slots are available.`
        : `The device reported ${detected.length} modules, but only ${maxSlots} slots are available.`,
    }
  }

  const byId = new Map(modules.map((m) => [m.id, m]))
  const selectable = modules.filter((m) => m.fixed !== true)
  const bySlot = new Map(detected.map((d) => [d.slot, d]))
  const lockedModule = lockedSlotIndex !== null ? byId.get(slots[lockedSlotIndex] ?? '') : undefined

  const unknown: DiscoveredModule[] = []
  const ambiguous: string[] = []
  const conflicts: string[] = []
  const nextSlots: (string | null)[] = Array<string | null>(maxSlots).fill(null)
  const nextConfig: SlotConfigMap = {}
  const changes: SlotChange[] = []

  // Keys that are not slot numbers are not slot settings; they pass through.
  for (const [key, value] of Object.entries(slotsConfig)) {
    if (!/^[0-9]+$/.test(key)) nextConfig[key] = value
  }

  for (let index = 0; index < maxSlots; index++) {
    const slotNumber = index + 1
    const currentId = slots[index] ?? null
    const current = currentId ? byId.get(currentId) : undefined
    const found = bySlot.get(slotNumber)
    const key = String(slotNumber)

    if (lockedSlotIndex === index && lockedModule) {
      if (found && !lockedModule.hwId) {
        conflicts.push(
          `slot ${slotNumber} is the built-in ${lockedModule.name}, which declares no hardware id to compare with the reported ${found.hwId}`,
        )
      } else if (found && lockedModule.hwId && !hwIdsEqual(found.hwId, lockedModule.hwId)) {
        conflicts.push(`slot ${slotNumber} is the built-in ${lockedModule.name}, but the device reported ${found.hwId}`)
      }
      nextSlots[index] = lockedModule.id
      if (slotsConfig[key]) nextConfig[key] = slotsConfig[key]
      changes.push({ slot: slotNumber, kind: 'keep', from: describe(lockedModule), to: describe(lockedModule) })
      continue
    }

    if (!found) {
      if (currentId) {
        changes.push({ slot: slotNumber, kind: 'remove', from: describe(current, currentId) })
      }
      continue
    }

    // The project's own module wins when it carries the reported id, even if another module shares that id.
    if (current?.hwId && hwIdsEqual(current.hwId, found.hwId)) {
      nextSlots[index] = current.id
      if (slotsConfig[key]) nextConfig[key] = slotsConfig[key]
      changes.push({ slot: slotNumber, kind: 'keep', from: describe(current), to: describe(current) })
      continue
    }

    const matches = selectable.filter((m) => m.hwId !== undefined && hwIdsEqual(m.hwId, found.hwId))
    if (matches.length === 0) {
      unknown.push(found)
      continue
    }
    if (matches.length > 1) {
      ambiguous.push(`slot ${slotNumber} (${found.hwId}: ${matches.map((m) => m.name).join(', ')})`)
      continue
    }
    const match = matches[0]
    nextSlots[index] = match.id
    changes.push(
      currentId
        ? { slot: slotNumber, kind: 'replace', from: describe(current, currentId), to: describe(match) }
        : { slot: slotNumber, kind: 'add', to: describe(match) },
    )
  }

  if (unknown.length > 0) {
    const list = unknown.map((u) => `slot ${u.slot} (${u.hwId})`).join(', ')
    return {
      ok: false,
      error: `The device reported modules this package does not recognise: ${list}. Nothing was changed. Update the board package or check the installed modules.`,
    }
  }
  if (ambiguous.length > 0) {
    return {
      ok: false,
      error: `The device reported hardware ids that match more than one module in this package: ${ambiguous.join(', ')}. Nothing was changed.`,
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: `The device configuration does not match this board: ${conflicts.join('; ')}. Nothing was changed.`,
    }
  }

  return {
    ok: true,
    slots: nextSlots,
    slotsConfig: nextConfig,
    changes,
    changed: changes.some((c) => c.kind !== 'keep'),
  }
}

function describe(module: DiscoveryModuleDef | undefined, fallbackId = ''): { id: string; name: string } {
  return module ? { id: module.id, name: module.name } : { id: fallbackId, name: fallbackId }
}
