import type {
  ConfiguredEtherCATModule,
  ESIModule,
  ESIPdo,
  PersistedPdo,
  PersistedPdoEntry,
  SDOConfigurationEntry,
} from '../../ports/esi-types'
import { initCmdsToSdoEntries } from './init-cmd-sdo'
import { reconcilePdoChannels } from './reconcile-pdo-channels'

/** Add `delta` to a hex index, keeping its prefix and zero padding. Non-hex input is returned unchanged. */
export function hexAdd(hexIndex: string, delta: number): string {
  const match = /^(0[xX])?([0-9a-fA-F]+)$/.exec(hexIndex)
  if (match === null || delta === 0) return hexIndex
  const prefix = match[1] ?? '0x'
  const digits = match[2] ?? ''
  const value = parseInt(digits, 16) + delta
  return `${prefix}${value.toString(16).toUpperCase().padStart(digits.length, '0')}`
}

/** Increments from the coupler's `<Slots>` block. */
export interface SlotIncrements {
  slotIndexIncrement: number
  slotPdoIncrement: number
}

/** Object-index and PDO-index deltas for a 1-based slot. */
export function slotDeltas(slot: number, increments: SlotIncrements): { indexDelta: number; pdoDelta: number } {
  const offset = Math.max(0, slot - 1)
  return { indexDelta: offset * increments.slotIndexIncrement, pdoDelta: offset * increments.slotPdoIncrement }
}

function persistModulePdos(pdos: readonly ESIPdo[], indexDelta: number, pdoDelta: number): PersistedPdo[] {
  return pdos.map((pdo) => ({
    index: pdo.dependOnSlot ? hexAdd(pdo.index, pdoDelta) : pdo.index,
    name: pdo.name,
    assigned: true,
    fixed: pdo.fixed || undefined,
    mandatory: pdo.mandatory || undefined,
    sm: pdo.smIndex,
    dependOnSlot: pdo.dependOnSlot,
    entries: pdo.entries.map(
      (entry): PersistedPdoEntry => ({
        index: entry.dependOnSlot ? hexAdd(entry.index, indexDelta) : entry.index,
        subIndex: entry.subIndex,
        bitLen: entry.bitLen,
        name: entry.name,
        dataType: entry.dataType,
        dependOnSlot: entry.dependOnSlot,
      }),
    ),
  }))
}

function shiftSdo(entry: SDOConfigurationEntry, indexDelta: number): SDOConfigurationEntry {
  return entry.dependOnSlot ? { ...entry, index: hexAdd(entry.index, indexDelta) } : entry
}

export interface BuildModuleInput {
  id: string
  slot: number
  esiModule: ESIModule
  increments: SlotIncrements
  repositoryItemId: string
  /** IEC addresses already claimed; the new module's addresses are added to it. */
  usedAddresses: Set<string>
}

/**
 * Build a persisted module for a 1-based slot from its full ESI definition: slot-shifted
 * PDOs and InitCmd SDOs (only where the ESI marks them `DependOnSlot`), channel info and
 * non-conflicting IEC addresses.
 */
export function buildModuleForSlot(input: BuildModuleInput): ConfiguredEtherCATModule {
  const { indexDelta, pdoDelta } = slotDeltas(input.slot, input.increments)
  const rxPdos = persistModulePdos(input.esiModule.rxPdo, indexDelta, pdoDelta)
  const txPdos = persistModulePdos(input.esiModule.txPdo, indexDelta, pdoDelta)
  const sdos = initCmdsToSdoEntries(input.esiModule.initCmds, 'Module InitCmd').map((e) => shiftSdo(e, indexDelta))
  const { channelInfo, channelMappings } = reconcilePdoChannels({
    rxPdos,
    txPdos,
    previousMappings: [],
    externalUsedAddresses: input.usedAddresses,
  })
  for (const m of channelMappings) input.usedAddresses.add(m.iecLocation)
  return {
    id: input.id,
    slot: input.slot,
    name: input.esiModule.name,
    ident: input.esiModule.ident,
    esiModuleRef: { repositoryItemId: input.repositoryItemId, moduleIdent: input.esiModule.ident },
    channelMappings,
    channelInfo: channelInfo.length > 0 ? channelInfo : undefined,
    rxPdos,
    txPdos,
    sdoConfigurations: sdos.length > 0 ? sdos : undefined,
    moduleClass: input.esiModule.moduleClass,
    modulePdoGroup: input.esiModule.modulePdoGroup,
  }
}
