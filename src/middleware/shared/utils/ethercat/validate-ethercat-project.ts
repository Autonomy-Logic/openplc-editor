/**
 * Project-level EtherCAT configuration gate (BR21).
 *
 * Runs on `PLCRemoteDevice[]` before the generator, so a project that violates one of
 * the ESI-declared invariants fails the compile with a specific message instead of
 * shipping a bus configuration the slave or EtherDOG rejects at startup.
 *
 * Four invariants:
 *   1. A PDO flagged `mandatory` must be assigned.
 *   2. A PDO flagged `fixed` cannot be deselected (its mapping is locked in silicon).
 *   3. Exclusion must be resolved: when a PDO is assigned, none of the PDOs it excludes
 *      may also be assigned.
 *   4. A modular coupler must have at least `minInstances` modules in each slot.
 *
 * MaxInstances is not checked here because the UI prevents adding more than the slot
 * allows; a validator pass that trips a MaxInstances error means project data was
 * hand-edited, which is out of scope for this gate.
 */

import type { ConfiguredEtherCATDevice, PersistedPdo } from '@root/middleware/shared/ports/esi-types'

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

function validateFixedAssigned(where: string, direction: Direction, pdos: PersistedPdo[] | undefined): string[] {
  if (!pdos) return []
  const errors: string[] = []
  for (const pdo of pdos) {
    if (pdo.fixed === true && pdo.assigned === false) {
      errors.push(
        `${where} ${direction}: PDO ${pdo.index} ('${pdo.name}') has a Fixed mapping and cannot be deselected`,
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
        errors.push(
          `${where} ${direction}: PDO ${pdo.index} ('${pdo.name}') excludes ${other}, which is also assigned`,
        )
      }
    }
  }
  return errors
}

function validateMinInstances(where: string, slave: ConfiguredEtherCATDevice): string[] {
  const spec = slave.slotsSpec
  if (!spec || !Array.isArray(spec.slots) || spec.slots.length === 0) return []
  const errors: string[] = []
  // One ESI slot definition can expand to a run of physical slots: we interpret
  // slot[i] as spec for the i+1-th slot and count the modules sitting there.
  const occupancyBySlot = new Map<number, number>()
  for (const module of slave.modules ?? []) {
    occupancyBySlot.set(module.slot, (occupancyBySlot.get(module.slot) ?? 0) + 1)
  }
  for (let i = 0; i < spec.slots.length; i++) {
    const slotSpec = spec.slots[i]!
    const slotNumber = i + 1
    const count = occupancyBySlot.get(slotNumber) ?? 0
    if (count < slotSpec.minInstances) {
      const label = slotSpec.name ? ` ('${slotSpec.name}')` : ''
      errors.push(
        `${where}: slot ${slotNumber}${label} requires at least ${slotSpec.minInstances} module(s); the project has ${count}`,
      )
    }
  }
  return errors
}

function validateSlave(busName: string, slave: ConfiguredEtherCATDevice): string[] {
  const where = slaveWhere(busName, slave)
  const errors: string[] = []
  errors.push(...validateMandatoryAssigned(where, 'RxPDOs', slave.rxPdos))
  errors.push(...validateMandatoryAssigned(where, 'TxPDOs', slave.txPdos))
  errors.push(...validateFixedAssigned(where, 'RxPDOs', slave.rxPdos))
  errors.push(...validateFixedAssigned(where, 'TxPDOs', slave.txPdos))
  errors.push(...validateExclusion(where, 'RxPDOs', slave.rxPdos))
  errors.push(...validateExclusion(where, 'TxPDOs', slave.txPdos))
  errors.push(...validateMinInstances(where, slave))
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
