import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { cn } from '@root/frontend/utils/cn'
import type { ESIModuleSummary, ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'

/**
 * DOPE-704 E6 UI: one scanned module slot with its best match in the repository.
 * Mirrors ScannedDeviceMatch for the device-side table.
 */
export type ScannedModuleMatch = {
  slot: number
  ident: string
  match: {
    repoItem: ESIRepositoryItemLight
    module: ESIModuleSummary
  } | null
}

type DiscoveredModuleTableProps = {
  moduleMatches: ScannedModuleMatch[]
  selectedSlots: Set<number>
  onSelectSlot: (slot: number, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  isScanning: boolean
}

const DiscoveredModuleTable = ({
  moduleMatches,
  selectedSlots,
  onSelectSlot,
  onSelectAll,
  isScanning,
}: DiscoveredModuleTableProps) => {
  const allSelected = moduleMatches.length > 0 && moduleMatches.every((m) => selectedSlots.has(m.slot))
  const someSelected = moduleMatches.some((m) => selectedSlots.has(m.slot))

  return (
    <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
      <table className='w-full'>
        <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
          <tr>
            <th className='w-[40px] px-2 py-2'>
              <Checkbox
                checked={someSelected && !allSelected ? 'indeterminate' : allSelected}
                onCheckedChange={() => onSelectAll(!allSelected)}
                disabled={moduleMatches.length === 0}
              />
            </th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Slot</th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Name</th>
            <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Ident</th>
          </tr>
        </thead>
        <tbody>
          {moduleMatches.length === 0 ? (
            <tr>
              <td colSpan={4} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                {isScanning
                  ? 'Scanning for modules...'
                  : 'No modules found. Click "Scan" to discover modules on this coupler.'}
              </td>
            </tr>
          ) : (
            moduleMatches.map((m) => {
              const isSelected = selectedSlots.has(m.slot)
              const name = m.match?.module.name ?? '—'
              const hasNoXml = m.match === null
              return (
                <tr
                  key={m.slot}
                  onClick={() => onSelectSlot(m.slot, !isSelected)}
                  className={cn(
                    'cursor-pointer border-b border-neutral-200 transition-colors dark:border-neutral-800',
                    'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                    isSelected && 'bg-brand/10 dark:bg-brand/20',
                  )}
                >
                  <td className='px-2 py-2'>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => onSelectSlot(m.slot, !!checked)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select module at slot ${m.slot}`}
                    />
                  </td>
                  <td className='px-2 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300'>{m.slot}</td>
                  <td className='whitespace-nowrap px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'>
                    <span className='inline-flex items-center gap-2'>
                      {name}
                      {hasNoXml && (
                        <span
                          className='rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 dark:bg-neutral-700/60 dark:text-neutral-300'
                          title='ESI XML not in repository — import it from the Repository tab before adding.'
                        >
                          No XML
                        </span>
                      )}
                    </span>
                  </td>
                  <td className='px-2 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>{m.ident}</td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export { DiscoveredModuleTable }
