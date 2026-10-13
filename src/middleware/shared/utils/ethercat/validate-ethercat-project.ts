/**
 * Project-level EtherCAT configuration gate (BR21).
 *
 * Runs on `PLCRemoteDevice[]` before the generator, so a project that violates one of
 * the ESI-declared invariants fails the compile with a specific message instead of
 * shipping a bus configuration the slave or EtherDOG rejects at startup.
 *
 * Invariants, on the slave's own PDOs and on every module's PDOs:
 *   - A PDO flagged `mandatory` must be assigned. `fixed` only locks a PDO's entries.
 *   - Exclusion must be resolved: an assigned PDO excludes no other assigned PDO.
 *   - No two assigned PDOs of one slave share an index.
 * And on a modular coupler:
 *   - One module per slot, slots numbered from 1.
 *   - Modules fill the `<Slot>` definitions in order, each within its MinInstances and
 *     MaxInstances and of a class or ident the definition accepts.
 *   - The `0xF030` download transition is one EtherDOG performs (IP or PS).
 * And on every ESI InitCmd, slave or module: its transitions are IP or PS, since EtherDOG
 * sends all startup SDOs in PRE-OP.
 */

import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  ESISlot,
  PersistedPdo,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'

import { identsEqual } from './esi-module-resolve'
import { PREOP_TRANSITIONS, sdoTransitions } from './init-cmd-sdo'

/** Minimal structural shape the validator reads from a project's remoteDevices list.  The
 *  full `PLCRemoteDevice` definition lives in the backend-shared types module; redefining
 *  the slice we need here keeps middleware/shared/utils free of a backend import. */
type EtherCATRemoteDeviceSlice = {
  protocol?: string
  name?: string
  ethercatConfig?: { devices?: ConfiguredEtherCATDevice[] }
}

/** Direction tag used in error messages. */
type Direction = 'RxPDOs' | 'TxPDOs'

/** Context tag describing a slave's location in the project tree, used in error messages. */
function slaveWhere(busName: string, slave: ConfiguredEtherCATDevice): string {
  const position = slave.position ?? '?'
  const name = slave.name || '<unnamed slave>'
  return `EtherCAT bus '${busName}', slave ${position} ('${name}')`
}

function moduleWhere(slaveAt: string, module: ConfiguredEtherCATModule): string {
  return `${slaveAt}, module '${module.name}' in slot ${module.slot}`
}

function validateMandatoryAssigned(where: string, direction: Direction, pdos: PersistedPdo[] | undefined): string[] {
  if (!pdos) return []
  const errors: string[] = []
  for (const pdo of pdos) {
    if (pdo.mandatory === true && pdo.assigned === false) {
      errors.push(
        `${where} ${direction}: PDO ${pdo.index} ('${pdo.name}') is marked Mandatory in the ESI but is unassigned`,
      )
    }
  }
  return errors
}

function validateExclusion(where: string, direction: Direction, pdos: PersistedPdo[] | undefined): string[] {
  if (!pdos) return []
  const errors: string[] = []
  const assignedIndices = new Set(pdos.filter((p) => p.assigned !== false).map((p) => p.index.toLowerCase()))
  for (const pdo of pdos) {
    if (pdo.assigned === false) continue
    const excluded = pdo.exclude
    if (!excluded || excluded.length === 0) continue
    for (const other of excluded) {
      if (assignedIndices.has(other.toLowerCase())) {
        errors.push(`${where} ${direction}: PDO ${pdo.index} ('${pdo.name}') excludes ${other}, which is also assigned`)
      }
    }
  }
  return errors
}

function validatePdoSet(where: string, rx: PersistedPdo[] | undefined, tx: PersistedPdo[] | undefined): string[] {
  return [
    ...validateMandatoryAssigned(where, 'RxPDOs', rx),
    ...validateMandatoryAssigned(where, 'TxPDOs', tx),
    ...validateExclusion(where, 'RxPDOs', rx),
    ...validateExclusion(where, 'TxPDOs', tx),
  ]
}

function validateUniquePdoIndices(where: string, slave: ConfiguredEtherCATDevice): string[] {
  const owners = new Map<number, string>()
  const errors: string[] = []
  const visit = (pdos: PersistedPdo[] | undefined, owner: string) => {
    for (const pdo of pdos ?? []) {
      if (pdo.assigned === false) continue
      const key = Number.parseInt(pdo.index, 16)
      const first = owners.get(key)
      if (first === undefined) owners.set(key, owner)
      else errors.push(`${where}: PDO ${pdo.index} of ${owner} has the same index as a PDO of ${first}`)
    }
  }
  visit(slave.rxPdos, 'the slave')
  visit(slave.txPdos, 'the slave')
  for (const module of slave.modules ?? []) {
    const owner = `module '${module.name}' (slot ${module.slot})`
    visit(module.rxPdos, owner)
    visit(module.txPdos, owner)
  }
  return errors
}

function slotAccepts(spec: ESISlot, module: ConfiguredEtherCATModule): boolean {
  const idents = spec.moduleIdents ?? []
  const classes = spec.moduleClasses ?? []
  if (idents.length === 0 && classes.length === 0) return true
  if (idents.some((ident) => identsEqual(ident, module.ident))) return true
  return module.moduleClass !== undefined && classes.includes(module.moduleClass)
}

function slotLabel(spec: ESISlot, i: number): string {
  return spec.name ? `slot definition ${i + 1} ('${spec.name}')` : `slot definition ${i + 1}`
}

/**
 * Walk physical slots 1..N in order and fill the ESI `<Slot>` definitions in sequence: a
 * definition takes slots until it reaches MaxInstances or the next module is one it does not
 * accept (once its MinInstances is met). An empty slot counts towards the current definition.
 */
function validateSlots(where: string, slave: ConfiguredEtherCATDevice): string[] {
  const modules = slave.modules ?? []
  const spec = slave.slotsSpec
  const errors: string[] = []

  const bySlot = new Map<number, ConfiguredEtherCATModule>()
  for (const module of modules) {
    if (!Number.isInteger(module.slot) || module.slot < 1) {
      errors.push(`${moduleWhere(where, module)}: slot numbers start at 1`)
      continue
    }
    const other = bySlot.get(module.slot)
    if (other !== undefined) {
      errors.push(`${where}: slot ${module.slot} holds both '${other.name}' and '${module.name}'`)
      continue
    }
    bySlot.set(module.slot, module)
  }

  if (spec === undefined || spec.slots.length === 0) {
    if (modules.length > 0) errors.push(`${where}: the slave has modules but its ESI declares no <Slots>`)
    return errors
  }

  if (modules.length > 0 && spec.downloadModuleIdentList) {
    const transition = (spec.downloadModuleListTransition ?? 'PS').toUpperCase()
    if (!PREOP_TRANSITIONS.includes(transition)) {
      errors.push(
        `${where}: the ESI downloads the module list at transition '${transition}'; only IP and PS are supported`,
      )
    }
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
      errors.push(
        module !== undefined
          ? `${moduleWhere(where, module)}: no slot definition of the coupler accepts it at this position`
          : `${where}: slot ${slot} is past the last slot the coupler's ESI allows`,
      )
      break
    }
    if (module !== undefined && !slotAccepts(def, module)) {
      const cls = module.moduleClass === undefined ? 'unknown class' : `class '${module.moduleClass}'`
      errors.push(
        `${moduleWhere(where, module)}: ${slotLabel(def, current)} does not accept module ${module.ident} (${cls})`,
      )
    }
    count += 1
  }

  for (let i = current; i < spec.slots.length; i++) {
    const def = spec.slots[i]
    if (def === undefined) continue
    const have = i === current ? count : 0
    if (have < def.minInstances) {
      errors.push(
        `${where}: ${slotLabel(def, i)} requires at least ${def.minInstances} module(s); the project has ${have}`,
      )
    }
  }
  return errors
}

function validateInitCmdTransitions(where: string, entries: SDOConfigurationEntry[] | undefined): string[] {
  const errors: string[] = []
  for (const entry of entries ?? []) {
    const unsupported = sdoTransitions(entry).filter((t) => !PREOP_TRANSITIONS.includes(t))
    if (unsupported.length > 0) {
      errors.push(
        `${where}: InitCmd ${entry.index}:${entry.subIndex} runs at transition ${unsupported.join(', ')}; ` +
          'EtherDOG writes startup SDOs only in PRE-OP (IP, PS)',
      )
    }
  }
  return errors
}

function validateSlave(busName: string, slave: ConfiguredEtherCATDevice): string[] {
  const where = slaveWhere(busName, slave)
  const errors = validatePdoSet(where, slave.rxPdos, slave.txPdos)
  errors.push(...validateInitCmdTransitions(where, slave.esiInitCmdSdos))
  for (const module of slave.modules ?? []) {
    errors.push(...validatePdoSet(moduleWhere(where, module), module.rxPdos, module.txPdos))
    errors.push(...validateInitCmdTransitions(moduleWhere(where, module), module.sdoConfigurations))
  }
  errors.push(...validateUniquePdoIndices(where, slave))
  if (slave.isModularCoupler === true || (slave.modules ?? []).length > 0) errors.push(...validateSlots(where, slave))
  return errors
}

/**
 * Entry point. Returns one message per failed invariant across every bus; an empty list
 * means the project satisfies BR21.
 */
export function validateEthercatProject(remoteDevices: EtherCATRemoteDeviceSlice[] | undefined): string[] {
  if (!remoteDevices || remoteDevices.length === 0) return []
  const errors: string[] = []
  for (const device of remoteDevices) {
    if (device.protocol !== 'ethercat' || !device.ethercatConfig) continue
    const busName = device.name || '<unnamed bus>'
    const slaves = device.ethercatConfig.devices ?? []
    for (const slave of slaves) {
      errors.push(...validateSlave(busName, slave))
    }
  }
  return errors
}
