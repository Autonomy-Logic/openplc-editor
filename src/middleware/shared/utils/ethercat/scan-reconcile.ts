/**
 * DOPE-704 E6 — scan-response parsing and reconciliation.
 *
 * EtherDOG from RTOP-319 R3 onwards answers `scan-modules <slave_position>` with the
 * module idents read from `0xF050` on that coupler. The UI's "Scan modules" button
 * sends the command, receives the response, and asks this module three things:
 *
 *   1. Parse the raw JSON reply into a safe, typed shape (`parseScanResponse`).
 *   2. Reconcile it against the coupler's current `modules` to produce a diff
 *      (`reconcileScannedModules`) the UI renders as "add slot 3 (ident 0x…),
 *      remove slot 5, keep slots 1,2,4".
 *   3. Apply the diff to the configured device model (`applyScanReconciliation`)
 *      when the operator confirms, keeping already-mapped slots whose idents still
 *      match verbatim so no channel mapping is lost by the scan.
 *
 * Pure, no store, no HTTP, no dialog — shared surface, byte-identical with
 * openplc-web. The actual command invocation lives on the editor adapter when the
 * UI button lands; this module processes whatever the adapter returns.
 */

import type { ConfiguredEtherCATDevice, ConfiguredEtherCATModule } from '@root/middleware/shared/ports/esi-types'

/** Decoded shape of EtherDOG's scan-modules reply. */
export interface ScannedModuleIdent {
  /** 1-based slot on the coupler's backplane. */
  slot: number
  /** Module ident as hex string ("0x12345678"). `0x0` means empty slot. */
  ident: string
}

export interface ScanResponse {
  slavePosition: number
  modules: ScannedModuleIdent[]
}

/**
 * Parses the untyped JSON object EtherDOG returned into a typed scan response.
 *
 * The input is untrusted (arrives over the control socket from a daemon the editor
 * does not own), so every field is checked. Returns `null` on any shape error — the
 * UI tells the operator the scan failed and offers to retry rather than silently
 * mis-rendering a bogus reply.
 */
export function parseScanResponse(raw: unknown): ScanResponse | null {
  if (raw === null || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const slavePosition = obj.slave_position
  if (typeof slavePosition !== 'number' || !Number.isInteger(slavePosition) || slavePosition < 1) return null

  const modulesRaw = obj.modules
  if (!Array.isArray(modulesRaw)) return null

  const modules: ScannedModuleIdent[] = []
  for (const entry of modulesRaw) {
    if (entry === null || typeof entry !== 'object') return null
    const e = entry as Record<string, unknown>
    const slot = e.slot
    const ident = e.ident
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1) return null
    if (typeof ident !== 'string' || !/^0x[0-9a-fA-F]+$/.test(ident)) return null
    modules.push({ slot, ident: ident.toLowerCase() })
  }

  // Slots must be unique and the array may be sparse (some slots empty). Sort by
  // slot so the reconciliation does not depend on the daemon's listing order.
  const seen = new Set<number>()
  for (const m of modules) {
    if (seen.has(m.slot)) return null
    seen.add(m.slot)
  }
  modules.sort((a, b) => a.slot - b.slot)

  return { slavePosition, modules }
}

/** One line of the diff the UI renders. */
export type ReconciliationItem =
  /** Scan found a module in this slot the project does not have yet. */
  | { kind: 'add'; slot: number; ident: string }
  /** Project has a module in this slot the scan did not find (slot now empty). */
  | { kind: 'remove'; slot: number; existingModuleId: string; existingIdent: string }
  /** Both sides have a module in this slot and the idents match. */
  | { kind: 'keep'; slot: number; moduleId: string; ident: string }
  /** Both sides have a module in this slot but the idents disagree — swap. */
  | { kind: 'replace'; slot: number; existingModuleId: string; existingIdent: string; scannedIdent: string }

export interface ReconciliationResult {
  items: ReconciliationItem[]
  /** True when the diff is empty (project already matches the bus). */
  identical: boolean
}

/**
 * Reconciles a scan against the device's current `modules` list. Pure — the caller
 * decides whether to apply the diff.
 *
 * Ident comparison is case-insensitive and allows the `0x0` sentinel (empty slot).
 * A slot that was empty on the bus and empty in the project yields no line.
 */
export function reconcileScannedModules(
  scan: ScanResponse,
  currentModules: readonly ConfiguredEtherCATModule[] | undefined,
): ReconciliationResult {
  const projectBySlot = new Map<number, ConfiguredEtherCATModule>()
  for (const module of currentModules ?? []) projectBySlot.set(module.slot, module)

  const scannedBySlot = new Map<number, ScannedModuleIdent>()
  for (const scanned of scan.modules) scannedBySlot.set(scanned.slot, scanned)

  const slots = new Set<number>([...projectBySlot.keys(), ...scannedBySlot.keys()])

  const items: ReconciliationItem[] = []
  const sorted = [...slots].sort((a, b) => a - b)
  for (const slot of sorted) {
    const scanned = scannedBySlot.get(slot)
    const existing = projectBySlot.get(slot)

    const scannedIdent = scanned !== undefined && scanned.ident !== '0x0' ? scanned.ident : null
    const existingIdent =
      existing !== undefined && existing.ident.toLowerCase() !== '0x0' ? existing.ident.toLowerCase() : null

    if (scannedIdent === null && existingIdent === null) continue
    if (scannedIdent !== null && existingIdent === null) {
      items.push({ kind: 'add', slot, ident: scannedIdent })
      continue
    }
    if (scannedIdent === null && existingIdent !== null && existing !== undefined) {
      items.push({ kind: 'remove', slot, existingModuleId: existing.id, existingIdent })
      continue
    }
    if (scannedIdent !== null && existingIdent !== null && existing !== undefined) {
      if (scannedIdent === existingIdent) {
        items.push({ kind: 'keep', slot, moduleId: existing.id, ident: existingIdent })
      } else {
        items.push({
          kind: 'replace',
          slot,
          existingModuleId: existing.id,
          existingIdent,
          scannedIdent,
        })
      }
    }
  }

  const identical = items.every((it) => it.kind === 'keep')
  return { items, identical }
}

/**
 * Applies a reconciliation to a device model, producing a new `modules` array that
 * reflects the scan.
 *
 * Rules:
 *   - `keep` → the existing module stays verbatim (channel mappings preserved).
 *   - `remove` → the existing module is dropped.
 *   - `add` → a stub module is inserted with the scanned ident. The caller is
 *     expected to look the ident up in the ESI repository and fill in the rest
 *     (name, PDOs, channelInfo, ESI ref) — this helper only produces the slot/ident
 *     placeholder because the ESI repository lookup is outside the shared surface.
 *   - `replace` → same as `remove + add` on the same slot. The caller re-stubs the
 *     slot with the new ident.
 *
 * The returned list is slot-sorted so downstream consumers do not depend on the
 * reconciliation's internal ordering.
 */
export function applyScanReconciliation(
  device: ConfiguredEtherCATDevice,
  reconciliation: ReconciliationResult,
): ConfiguredEtherCATDevice {
  const bySlot = new Map<number, ConfiguredEtherCATModule>()
  for (const module of device.modules ?? []) bySlot.set(module.slot, module)

  for (const item of reconciliation.items) {
    switch (item.kind) {
      case 'keep':
        // existing stays
        break
      case 'remove':
        bySlot.delete(item.slot)
        break
      case 'add': {
        bySlot.set(item.slot, {
          id: `slot-${item.slot}`,
          slot: item.slot,
          name: `(pending — ident ${item.ident})`,
          ident: item.ident,
          esiModuleRef: { repositoryItemId: '', moduleIdent: item.ident },
          channelMappings: [],
        })
        break
      }
      case 'replace': {
        bySlot.set(item.slot, {
          id: `slot-${item.slot}`,
          slot: item.slot,
          name: `(pending — ident ${item.scannedIdent})`,
          ident: item.scannedIdent,
          esiModuleRef: { repositoryItemId: '', moduleIdent: item.scannedIdent },
          channelMappings: [],
        })
        break
      }
    }
  }

  const modules = [...bySlot.values()].sort((a, b) => a.slot - b.slot)
  return { ...device, modules: modules.length > 0 ? modules : undefined }
}
