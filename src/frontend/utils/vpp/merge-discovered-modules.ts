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

const UNREADABLE = 'The device returned a module list this editor cannot read.'

/**
 * Read the module list out of a successful plugin answer.
 *
 * Slots must be whole numbers from 1 with no gap or repeat, and each hardware
 * id a non-empty string; anything else is refused whole rather than applied in
 * part.
 */
export function parseDiscoveredModules(
  data: Record<string, unknown>,
  mapping: DiscoveryResultMapping,
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
    if (typeof hwId !== 'string' || hwId.trim().length === 0) return { ok: false, error: UNREADABLE }
    modules.push({ slot, hwId: hwId.trim() })
  }

  modules.sort((a, b) => a.slot - b.slot)
  for (let i = 0; i < modules.length; i++) {
    if (modules[i].slot !== i + 1) return { ok: false, error: UNREADABLE }
  }
  return { ok: true, modules }
}

/**
 * Hardware ids compare as numbers when both are hex (`0x...`) or decimal, so
 * `0x34a055eb` and `0x34A055EB` match; otherwise as case-insensitive text.
 */
export function hwIdsEqual(a: string, b: string): boolean {
  const na = hwIdNumber(a)
  const nb = hwIdNumber(b)
  if (na !== null && nb !== null) return na === nb
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function hwIdNumber(value: string): number | null {
  const text = value.trim()
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16)
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10)
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
 * not report is emptied. Any id the package does not know refuses the whole
 * plan and names every such slot.
 */
export function mergeDiscoveredModules(args: MergeDiscoveredModulesArgs): MergeDiscoveredModulesResult {
  const { slots, slotsConfig, modules, detected, maxSlots, lockedSlotIndex } = args

  if (detected.length > maxSlots) {
    return {
      ok: false,
      error: `The device reported ${detected.length} modules, but this backplane has only ${maxSlots} slots.`,
    }
  }

  const byId = new Map(modules.map((m) => [m.id, m]))
  const selectable = modules.filter((m) => m.fixed !== true)
  const bySlot = new Map(detected.map((d) => [d.slot, d]))
  const lockedModule = lockedSlotIndex !== null ? byId.get(slots[lockedSlotIndex] ?? '') : undefined

  const unknown: DiscoveredModule[] = []
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
      if (found && lockedModule.hwId && !hwIdsEqual(found.hwId, lockedModule.hwId)) {
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

    if (current?.hwId && hwIdsEqual(current.hwId, found.hwId)) {
      nextSlots[index] = current.id
      if (slotsConfig[key]) nextConfig[key] = slotsConfig[key]
      changes.push({ slot: slotNumber, kind: 'keep', from: describe(current), to: describe(current) })
      continue
    }

    const match = selectable.find((m) => m.hwId !== undefined && hwIdsEqual(m.hwId, found.hwId))
    if (!match) {
      unknown.push(found)
      continue
    }
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
  if (conflicts.length > 0) {
    return { ok: false, error: `The device configuration does not match this board: ${conflicts.join('; ')}.` }
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
