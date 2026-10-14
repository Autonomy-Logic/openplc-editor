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
  PersistedPdo,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'

import { PREOP_TRANSITIONS, sdoTransitions } from './init-cmd-sdo'
import { checkStation } from './module-station'

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

function moduleWhere(slaveAt: string, module: Pick<ConfiguredEtherCATModule, 'name' | 'slot'>): string {
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

/** Station rules shared with the Modules tab, plus the `0xF030` download transition. */
function validateSlots(where: string, slave: ConfiguredEtherCATDevice): string[] {
  const modules = slave.modules ?? []
  const spec = slave.slotsSpec
  const errors: string[] = []
  if (spec !== undefined && modules.length > 0 && spec.downloadModuleIdentList) {
    const transition = (spec.downloadModuleListTransition ?? 'PS').toUpperCase()
    if (!PREOP_TRANSITIONS.includes(transition)) {
      errors.push(
        `${where}: the ESI downloads the module list at transition '${transition}'; only IP and PS are supported`,
      )
    }
  }
  for (const issue of checkStation(spec, modules)) {
    const at = issue.module === undefined ? where : moduleWhere(where, issue.module)
    errors.push(`${at}: ${issue.text}`)
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
