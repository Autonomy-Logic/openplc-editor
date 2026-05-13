import { collectUsedIecAddresses } from '@root/backend/shared/utils/iec-address'
import { useOpenPLCStore } from '@root/frontend/store'
import { generateIecAddress } from '@root/frontend/utils/iec-address'
import { getSectionPersistenceKey } from '@root/frontend/utils/vpp/persistence-keys'
import type { IoMappingEntry, VendorIoMapping } from '@root/middleware/shared/ports/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModuleSystem, ScreenSection } from '../index'

type IoTableLayoutProps = {
  section: ScreenSection
  moduleSystem: ModuleSystem
}

function IoTableLayout({ section, moduleSystem }: IoTableLayoutProps) {
  // See `getSectionPersistenceKey` in ../index.tsx — the single
  // source of truth for the per-section storage key.  Falls back to
  // section.id when no explicit `persistence` is declared, matching
  // every other layout in this folder.
  const persistenceKey = getSectionPersistenceKey(section) ?? ''
  const availableModules = moduleSystem?.modules ?? []

  const getStoreState = useCallback(() => {
    const state = useOpenPLCStore.getState()
    const vsd = state.deviceDefinitions.configuration.vendorScreenData
    const moduleConfig = vsd?.['module-configuration'] as { slots?: (string | null)[] } | undefined
    const storedMapping = vsd?.[persistenceKey] as VendorIoMapping | undefined
    return {
      slots: moduleConfig?.slots ?? [],
      storedMapping,
      remoteDevices: (state.project.data.remoteDevices ?? []) as Array<{
        modbusTcpConfig?: { ioGroups?: Array<{ ioPoints: Array<{ iecLocation: string }> }> }
        ethercatConfig?: { devices?: Array<{ channelMappings?: Array<{ iecLocation: string }> }> }
      }>,
    }
  }, [persistenceKey])

  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)

  const moduleConfig = useOpenPLCStore(
    (s) =>
      s.deviceDefinitions.configuration.vendorScreenData?.['module-configuration'] as
        | { slots?: (string | null)[] }
        | undefined,
  )
  const slots = moduleConfig?.slots ?? []

  const [entries, setEntries] = useState<IoMappingEntry[]>(() => {
    const { storedMapping } = getStoreState()
    return storedMapping?.entries ?? []
  })

  const lastSlotsRef = useRef<string>('')

  useEffect(() => {
    const slotsKey = JSON.stringify(slots)
    if (slotsKey === lastSlotsRef.current) return
    lastSlotsRef.current = slotsKey

    const { remoteDevices, storedMapping } = getStoreState()

    const existingAliases = new Map<string, string>()
    const existingEntries = storedMapping?.entries ?? entries
    for (const entry of existingEntries) {
      if (entry.alias) {
        existingAliases.set(`${entry.slot}:${entry.channelName}`, entry.alias)
      }
    }

    // Seed "used" from every other I/O source (Modbus TCP, EtherCAT) so the
    // VPP allocator avoids collisions. We explicitly DON'T pass vendorScreenData
    // here — the existing VPP entries are the ones we're about to re-generate.
    const usedAddresses = collectUsedIecAddresses(remoteDevices)
    const newEntries: IoMappingEntry[] = []

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const moduleId = slots[slotIndex]
      if (!moduleId) continue

      const moduleDef = availableModules.find((m) => m.id === moduleId)
      if (!moduleDef) continue

      const channels = (
        moduleDef as {
          addressMapping?: {
            channels?: Array<{ name: string; type: string; dataType: string; addressPrefix: string }>
          }
        }
      ).addressMapping?.channels

      if (channels) {
        for (const channel of channels) {
          const isBit = channel.addressPrefix === '%IX' || channel.addressPrefix === '%QX'
          const iecAddress = generateIecAddress(channel.addressPrefix, isBit, usedAddresses)
          usedAddresses.add(iecAddress)

          const aliasKey = `${slotIndex + 1}:${channel.name}`
          newEntries.push({
            slot: slotIndex + 1,
            moduleId,
            moduleName: moduleDef.name,
            channelName: channel.name,
            channelType: channel.type,
            dataType: channel.dataType,
            iecAddress,
            alias: existingAliases.get(aliasKey) ?? '',
          })
        }
      }
    }

    setEntries(newEntries)
    setVendorScreenData(persistenceKey, { entries: newEntries })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots])

  const handleAliasChange = (index: number, alias: string) => {
    const updated = [...entries]
    updated[index] = { ...updated[index], alias }
    setEntries(updated)
    setVendorScreenData(persistenceKey, { entries: updated })
  }

  const groups = useMemo(() => {
    const map = new Map<
      number,
      { moduleName: string; moduleId: string; entries: Array<IoMappingEntry & { globalIndex: number }> }
    >()
    entries.forEach((entry, idx) => {
      let group = map.get(entry.slot)
      if (!group) {
        group = { moduleName: entry.moduleName, moduleId: entry.moduleId, entries: [] }
        map.set(entry.slot, group)
      }
      group.entries.push({ ...entry, globalIndex: idx })
    })
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [entries])

  const [expandedSlots, setExpandedSlots] = useState<Set<number>>(() => new Set(groups.map(([slot]) => slot)))

  useEffect(() => {
    setExpandedSlots((prev) => {
      const next = new Set(prev)
      for (const [slot] of groups) {
        next.add(slot)
      }
      return next
    })
  }, [groups])

  const toggleSlot = (slot: number) => {
    setExpandedSlots((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) {
        next.delete(slot)
      } else {
        next.add(slot)
      }
      return next
    })
  }

  if (entries.length === 0) {
    return (
      <div className='flex items-center justify-center p-8 text-sm text-neutral-500 dark:text-neutral-400'>
        No modules configured. Assign modules in Backplane Configuration to generate I/O mappings.
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      {groups.map(([slot, group]) => {
        const isExpanded = expandedSlots.has(slot)
        const ioCounts = { di: 0, do: 0, ai: 0, ao: 0 }
        for (const e of group.entries) {
          if (e.channelType === 'digitalInput') ioCounts.di++
          else if (e.channelType === 'digitalOutput') ioCounts.do++
          else if (e.channelType === 'analogInput') ioCounts.ai++
          else if (e.channelType === 'analogOutput') ioCounts.ao++
        }
        const ioSummary: string[] = []
        if (ioCounts.di > 0) ioSummary.push(`${ioCounts.di} DI`)
        if (ioCounts.do > 0) ioSummary.push(`${ioCounts.do} DO`)
        if (ioCounts.ai > 0) ioSummary.push(`${ioCounts.ai} AI`)
        if (ioCounts.ao > 0) ioSummary.push(`${ioCounts.ao} AO`)

        return (
          <div key={slot} className='overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700'>
            <button
              type='button'
              onClick={() => toggleSlot(slot)}
              className='flex w-full items-center justify-between bg-neutral-50 px-4 py-2.5 text-left hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-850'
            >
              <div className='flex items-center gap-3'>
                <svg
                  className={`h-3.5 w-3.5 text-neutral-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
                </svg>
                <span className='font-caption text-cp-sm font-semibold text-neutral-950 dark:text-white'>
                  Slot {slot}
                </span>
                <span className='font-caption text-cp-sm font-medium text-neutral-600 dark:text-neutral-400'>
                  {group.moduleName}
                </span>
              </div>
              <span className='font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
                {ioSummary.join(' / ')}
              </span>
            </button>

            {isExpanded && (
              <table className='w-full text-left'>
                <thead>
                  <tr className='border-t border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950'>
                    <th className='px-4 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                      Channel
                    </th>
                    <th className='px-3 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                      Type
                    </th>
                    <th className='px-3 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                      IEC Address
                    </th>
                    <th className='px-3 py-1.5 font-caption text-[11px] font-medium text-neutral-500 dark:text-neutral-400'>
                      Alias
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((entry) => (
                    <tr
                      key={`${entry.slot}-${entry.channelName}`}
                      className='border-t border-neutral-100 dark:border-neutral-800'
                    >
                      <td className='px-4 py-1.5 font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'>
                        {entry.channelName}
                      </td>
                      <td className='px-3 py-1.5 font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
                        {entry.channelType}
                      </td>
                      <td className='px-3 py-1.5 font-mono text-cp-sm font-medium text-brand dark:text-brand-light'>
                        {entry.iecAddress}
                      </td>
                      <td className='px-1 py-1'>
                        <input
                          type='text'
                          value={entry.alias}
                          onChange={(e) => handleAliasChange(entry.globalIndex, e.target.value)}
                          placeholder='Alias...'
                          className='h-[26px] w-full rounded border border-neutral-100 bg-white px-2 font-caption text-cp-sm text-neutral-850 outline-none placeholder:text-neutral-400 focus:border-brand-medium-dark dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:placeholder:text-neutral-600'
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}

export { IoTableLayout }
