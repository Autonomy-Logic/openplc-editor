import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { useOpenPLCStore } from '@root/frontend/store'
import { getSectionPersistenceKey } from '@root/frontend/utils/vpp/persistence-keys'
import { useMemo } from 'react'

import type { ModuleSystem, ScreenSection } from '../index'

type ModuleSlotsLayoutProps = {
  section: ScreenSection
  moduleSystem: ModuleSystem
}

function ModuleSlotsLayout({ section, moduleSystem }: ModuleSlotsLayoutProps) {
  const maxSlots = section.maxSlots || moduleSystem?.maxSlots || 8
  const availableModules = moduleSystem?.modules ?? []

  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)
  // Single source of truth — see `getSectionPersistenceKey` in
  // ../index.tsx.
  const persistenceKey = getSectionPersistenceKey(section)

  const storedData =
    persistenceKey !== null
      ? (vendorScreenData?.[persistenceKey] as { slots?: (string | null)[] } | undefined)
      : undefined
  const slots = storedData?.slots ?? Array<string | null>(maxSlots).fill(null)

  const handleSlotChange = (slotIndex: number, moduleId: string) => {
    if (persistenceKey === null) return
    const next = [...slots]
    next[slotIndex] = moduleId || null
    setVendorScreenData(persistenceKey, { ...storedData, slots: next })
  }

  const handleClearAll = () => {
    if (persistenceKey === null) return
    setVendorScreenData(persistenceKey, { ...storedData, slots: Array<string | null>(maxSlots).fill(null) })
  }

  const ioSummary = useMemo(() => {
    const totals = { di: 0, do: 0, ai: 0, ao: 0 }
    for (const moduleId of slots) {
      if (!moduleId) continue
      const mod = availableModules.find((m) => m.id === moduleId)
      if (!mod) continue
      totals.di += mod.io.digitalInputs
      totals.do += mod.io.digitalOutputs
      totals.ai += mod.io.analogInputs
      totals.ao += mod.io.analogOutputs
    }
    return totals
  }, [slots, availableModules])

  const hasAnyModule = slots.some((s) => s !== null)

  const getModuleIoLabel = (moduleId: string) => {
    const mod = availableModules.find((m) => m.id === moduleId)
    if (!mod) return ''
    const parts: string[] = []
    if (mod.io.digitalInputs > 0) parts.push(`${mod.io.digitalInputs} DI`)
    if (mod.io.digitalOutputs > 0) parts.push(`${mod.io.digitalOutputs} DO`)
    if (mod.io.analogInputs > 0) parts.push(`${mod.io.analogInputs} AI`)
    if (mod.io.analogOutputs > 0) parts.push(`${mod.io.analogOutputs} AO`)
    return parts.join(', ')
  }

  return (
    <div className='flex flex-col gap-4'>
      {section.actions && (
        <div className='flex gap-2'>
          {(section.actions as Array<{ id: string; label: string; type: string; action?: string }>).map((action) => {
            if (action.type === 'local' && action.action === 'clear-module-slots') {
              return (
                <button
                  key={action.id}
                  type='button'
                  onClick={handleClearAll}
                  disabled={!hasAnyModule}
                  className='rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
                >
                  {action.label}
                </button>
              )
            }
            return null
          })}
        </div>
      )}

      <div className='grid grid-cols-4 gap-3'>
        {slots.map((moduleId, idx) => (
          <div
            key={idx}
            className='flex flex-col gap-1 rounded-md border border-neutral-200 p-2 dark:border-neutral-700'
          >
            <span className='text-xs font-medium text-neutral-500 dark:text-neutral-400'>Slot {idx + 1}</span>
            <Select
              value={moduleId ?? '__empty__'}
              onValueChange={(v) => handleSlotChange(idx, v === '__empty__' ? '' : v)}
            >
              <SelectTrigger
                aria-label={`Module slot ${idx + 1}`}
                placeholder='-- Empty --'
                withIndicator
                className='flex h-[28px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent
                className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                sideOffset={5}
                position='popper'
                align='center'
                side='bottom'
              >
                <SelectItem
                  value='__empty__'
                  className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                >
                  <span className='font-caption text-cp-sm font-medium text-neutral-500 dark:text-neutral-400'>
                    -- Empty --
                  </span>
                </SelectItem>
                {availableModules.map((mod) => (
                  <SelectItem
                    key={mod.id}
                    value={mod.id}
                    className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                  >
                    <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                      {mod.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {moduleId && (
              <span className='text-[10px] text-neutral-400 dark:text-neutral-500'>{getModuleIoLabel(moduleId)}</span>
            )}
          </div>
        ))}
      </div>

      {hasAnyModule && (
        <div className='flex gap-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
          <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Total I/O:</span>
          {ioSummary.di > 0 && (
            <span className='text-xs text-neutral-700 dark:text-neutral-300'>{ioSummary.di} DI</span>
          )}
          {ioSummary.do > 0 && (
            <span className='text-xs text-neutral-700 dark:text-neutral-300'>{ioSummary.do} DO</span>
          )}
          {ioSummary.ai > 0 && (
            <span className='text-xs text-neutral-700 dark:text-neutral-300'>{ioSummary.ai} AI</span>
          )}
          {ioSummary.ao > 0 && (
            <span className='text-xs text-neutral-700 dark:text-neutral-300'>{ioSummary.ao} AO</span>
          )}
        </div>
      )}
    </div>
  )
}

export { ModuleSlotsLayout }
