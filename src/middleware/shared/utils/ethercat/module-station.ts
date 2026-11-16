/**
 * The station of a modular coupler: which modules sit in which 1-based slot, checked against
 * the coupler's `<Slots>` block, and the slot moves the Modules tab performs. Slot-dependent
 * PDO, entry and InitCmd indices move with the module; channel IEC addresses and aliases stay.
 */

import type {
  ConfiguredEtherCATModule,
  ESISlot,
  ESISlotsSpec,
  PersistedPdo,
  SDOConfigurationEntry,
} from '../../ports/esi-types'
import { identsEqual } from './esi-module-resolve'
import { hexAdd, type SlotIncrements } from './module-build'

/** The module fields slot placement reads. */
export type StationModule = Pick<ConfiguredEtherCATModule, 'slot' | 'name' | 'ident' | 'moduleClass'>

/**
 * One station problem. `placement` problems make the module impossible where it is (refused by
 * the Modules tab and the compile); `min-instances` only fails the compile, as a project below
 * MinInstances still saves.
 */
export interface StationIssue<M extends StationModule = StationModule> {
  kind: 'placement' | 'min-instances'
  /** The module the issue is about, when there is one. */
  module?: M
  /** Message without the location prefix. */
  text: string
}

/** True when the `<Slot>` definition lists the module's ident or class, or restricts neither. */
export function slotAccepts(spec: ESISlot, module: Pick<StationModule, 'ident' | 'moduleClass'>): boolean {
  const idents = spec.moduleIdents ?? []
  const classes = spec.moduleClasses ?? []
  if (idents.length === 0 && classes.length === 0) return true
  if (idents.some((ident) => identsEqual(ident, module.ident))) return true
  return module.moduleClass !== undefined && classes.includes(module.moduleClass)
}

/** True when some `<Slot>` definition of the coupler accepts the module; always true without `<Slots>`. */
export function couplerAcceptsModule(
  spec: ESISlotsSpec | undefined,
  module: Pick<StationModule, 'ident' | 'moduleClass'>,
): boolean {
  if (spec === undefined || spec.slots.length === 0) return true
  return spec.slots.some((slot) => slotAccepts(slot, module))
}

function slotLabel(spec: ESISlot, i: number): string {
  return spec.name ? `slot definition ${i + 1} ('${spec.name}')` : `slot definition ${i + 1}`
}

/**
 * Check a station. Physical slots 1..N fill the `<Slot>` definitions in order: a definition
 * takes slots until it reaches MaxInstances or the next module is one it does not accept (once
 * its MinInstances is met). An empty slot counts towards the current definition.
 */
export function checkStation<M extends StationModule>(
  spec: ESISlotsSpec | undefined,
  modules: readonly M[],
): StationIssue<M>[] {
  const issues: StationIssue<M>[] = []
  const bySlot = new Map<number, M>()
  for (const module of modules) {
    if (!Number.isInteger(module.slot) || module.slot < 1) {
      issues.push({ kind: 'placement', module, text: 'slot numbers start at 1' })
      continue
    }
    const other = bySlot.get(module.slot)
    if (other !== undefined) {
      issues.push({
        kind: 'placement',
        module,
        text: `slot ${module.slot} already holds '${other.name}'`,
      })
      continue
    }
    bySlot.set(module.slot, module)
  }

  if (spec === undefined || spec.slots.length === 0) {
    if (modules.length > 0) {
      issues.push({ kind: 'placement', text: 'the slave has modules but its ESI declares no <Slots>' })
    }
    return issues
  }

  const lastSlot = Math.max(0, ...bySlot.keys())
  let current = 0
  let count = 0
  for (let slot = 1; slot <= lastSlot; slot++) {
    const module = bySlot.get(slot)
    let def = spec.slots[current]
    while (
      def !== undefined &&
      (count >= def.maxInstances || (module !== undefined && !slotAccepts(def, module) && count >= def.minInstances))
    ) {
      current += 1
      count = 0
      def = spec.slots[current]
    }
    if (def === undefined) {
      issues.push(
        module !== undefined
          ? { kind: 'placement', module, text: 'no slot definition of the coupler accepts it at this position' }
          : { kind: 'placement', text: `slot ${slot} is past the last slot the coupler's ESI allows` },
      )
      break
    }
    if (module !== undefined && !slotAccepts(def, module)) {
      const cls = module.moduleClass === undefined ? 'unknown class' : `class '${module.moduleClass}'`
      issues.push({
        kind: 'placement',
        module,
        text: `${slotLabel(def, current)} does not accept module ${module.ident} (${cls})`,
      })
    }
    count += 1
  }

  for (let i = current; i < spec.slots.length; i++) {
    const def = spec.slots[i]
    if (def === undefined) continue
    const have = i === current ? count : 0
    if (have < def.minInstances) {
      issues.push({
        kind: 'min-instances',
        text: `${slotLabel(def, i)} requires at least ${def.minInstances} module(s); the project has ${have}`,
      })
    }
  }
  return issues
}

function shiftPdos(pdos: PersistedPdo[] | undefined, indexDelta: number, pdoDelta: number): PersistedPdo[] | undefined {
  return pdos?.map((pdo) => ({
    ...pdo,
    index: pdo.dependOnSlot ? hexAdd(pdo.index, pdoDelta) : pdo.index,
    entries: pdo.entries.map((e) => (e.dependOnSlot ? { ...e, index: hexAdd(e.index, indexDelta) } : e)),
  }))
}

const channelKey = (pdoIndex: string, entryIndex: string, subIndex: string): string =>
  `${pdoIndex}-${entryIndex}-${subIndex}`

/**
 * The module as it would be in `slot`: slot-dependent PDO, entry and InitCmd indices move by the
 * slot difference; channel ids follow their entries, keeping IEC addresses and aliases.
 */
export function moveModuleToSlot(
  module: ConfiguredEtherCATModule,
  slot: number,
  increments: SlotIncrements,
): ConfiguredEtherCATModule {
  const steps = slot - module.slot
  if (steps === 0) return module
  const indexDelta = steps * increments.slotIndexIncrement
  const pdoDelta = steps * increments.slotPdoIncrement
  const rxPdos = shiftPdos(module.rxPdos, indexDelta, pdoDelta)
  const txPdos = shiftPdos(module.txPdos, indexDelta, pdoDelta)

  const renamed = new Map<string, { id: string; pdoIndex: string; entryIndex: string }>()
  const collect = (before: PersistedPdo[] | undefined, after: PersistedPdo[] | undefined) => {
    before?.forEach((pdo, i) => {
      const moved = after?.[i]
      pdo.entries.forEach((entry, j) => {
        const next = moved?.entries[j]
        if (moved === undefined || next === undefined) return
        renamed.set(channelKey(pdo.index, entry.index, entry.subIndex), {
          id: channelKey(moved.index, next.index, next.subIndex),
          pdoIndex: moved.index,
          entryIndex: next.index,
        })
      })
    })
  }
  collect(module.rxPdos, rxPdos)
  collect(module.txPdos, txPdos)

  const shiftSdo = (e: SDOConfigurationEntry): SDOConfigurationEntry =>
    e.dependOnSlot ? { ...e, index: hexAdd(e.index, indexDelta) } : e

  return {
    ...module,
    slot,
    rxPdos,
    txPdos,
    sdoConfigurations: module.sdoConfigurations?.map(shiftSdo),
    channelInfo: module.channelInfo?.map((info) => {
      const next = renamed.get(info.channelId)
      return next === undefined
        ? info
        : { ...info, channelId: next.id, pdoIndex: next.pdoIndex, entryIndex: next.entryIndex }
    }),
    channelMappings: module.channelMappings.map((m) => {
      const next = renamed.get(m.channelId)
      return next === undefined ? m : { ...m, channelId: next.id }
    }),
  }
}

/** Remove a module; the modules after it move up one slot each, closing the gap. */
export function removeModuleAndCompact(
  modules: readonly ConfiguredEtherCATModule[],
  id: string,
  increments: SlotIncrements,
): ConfiguredEtherCATModule[] {
  const removed = modules.find((m) => m.id === id)
  if (removed === undefined) return [...modules]
  return modules
    .filter((m) => m.id !== id)
    .map((m) => (m.slot > removed.slot ? moveModuleToSlot(m, m.slot - 1, increments) : m))
}

/**
 * Move a module one slot up (-1) or down (+1). It swaps places with the module in that slot,
 * or moves into it when the slot is empty. Slot 1 cannot move up.
 */
export function shiftModule(
  modules: readonly ConfiguredEtherCATModule[],
  id: string,
  direction: -1 | 1,
  increments: SlotIncrements,
): ConfiguredEtherCATModule[] {
  const module = modules.find((m) => m.id === id)
  if (module === undefined) return [...modules]
  const target = module.slot + direction
  if (target < 1) return [...modules]
  return modules.map((m) => {
    if (m.id === id) return moveModuleToSlot(m, target, increments)
    if (m.slot === target) return moveModuleToSlot(m, module.slot, increments)
    return m
  })
}
