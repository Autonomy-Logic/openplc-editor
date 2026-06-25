import { GenericComboboxCell } from '@root/frontend/components/_atoms/generic-table-inputs/generic-combobox-cell'
import { Label } from '@root/frontend/components/_atoms/label'
import type { NetworkInterface } from '@root/middleware/shared/ports/ethercat-types'
import { useMemo } from 'react'

type InterfaceSelectorProps = {
  interfaces: NetworkInterface[]
  selectedInterface: string
  onSelectInterface: (value: string) => void
  isLoading: boolean
  error: string | null
}

// Field-style trigger (bordered dropdown), distinct from the default table-cell look.
const FIELD_TRIGGER_CLASS =
  'flex h-[30px] w-full min-w-[200px] max-w-[300px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-normal text-neutral-700 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-100'

/**
 * Network-interface picker for the EtherCAT screen.
 *
 * A thin wrapper over the shared GenericComboboxCell — the single combobox in
 * the app. The runtime returns the full set of adapters and that list is shown
 * in full (`disableFilter`), while the user can still type a custom interface
 * name (`canAddACustomOption`) that propagates verbatim through onSelectInterface.
 */
const InterfaceSelector = ({
  interfaces,
  selectedInterface,
  onSelectInterface,
  isLoading,
  error,
}: InterfaceSelectorProps) => {
  // While a scan is in flight, present an empty list so the "Loading…" message
  // shows (mirrors the previous behavior); otherwise map adapters to options
  // keyed by interface name (the value that propagates).
  const selectValues = useMemo(
    () =>
      isLoading
        ? []
        : interfaces.map((iface) => ({
            id: iface.name,
            value: iface.name,
            label:
              iface.description && iface.description !== iface.name
                ? `${iface.name} — ${iface.description}`
                : iface.name,
          })),
    [interfaces, isLoading],
  )

  return (
    <div className='flex flex-col gap-1'>
      <Label className='text-xs text-neutral-950 dark:text-white'>Network Interface</Label>
      <GenericComboboxCell
        value={selectedInterface}
        onValueChange={onSelectInterface}
        selectValues={selectValues}
        displayLabel={selectedInterface || 'Select interface'}
        disableFilter
        canAddACustomOption
        showClearOption={false}
        showChevron
        triggerClassName={FIELD_TRIGGER_CLASS}
        placeholder='eth0'
        customValueLabel='Use custom interface'
        emptyMessage={isLoading ? 'Loading interfaces...' : 'No interfaces available. Type a custom value.'}
      />
      {error && <p className='text-xs text-red-500 dark:text-red-400'>{error}</p>}
    </div>
  )
}

export { InterfaceSelector }
