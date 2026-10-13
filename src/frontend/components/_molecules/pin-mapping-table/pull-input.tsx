import { CellContext } from '@tanstack/react-table'

import type { DevicePin, PinPullMode, PinPullSpec } from '../../../../middleware/shared/ports/types'
import {
  PIN_PULL_LABELS,
  resolveEffectivePinPull,
  resolvePinPullRule,
} from '../../../../middleware/shared/utils/pin-pull'
import { GenericSelectCell } from '../../_atoms/generic-table-inputs/generic-select-cell'
import { toast } from '../../_features/[app]/toast/use-toast'

type PinPullInputCellProps = CellContext<DevicePin, unknown> & {
  pullSpec: PinPullSpec
  selected?: boolean
  editable?: boolean
}

const readOnlyClassName =
  'flex h-full w-full items-center justify-center p-2 font-caption text-cp-sm font-medium text-neutral-500 dark:text-neutral-500'

export const PinPullInputCell = ({ row, column: { id }, table, pullSpec, selected = false }: PinPullInputCellProps) => {
  const pin = row.original

  if (pin.pinType !== 'digitalInput') {
    return <span className={readOnlyClassName}>-</span>
  }

  const rule = resolvePinPullRule(pullSpec, pin.pin)
  if (rule.kind === 'fixed') {
    return (
      <span className={readOnlyClassName} title='Fixed by the board, not configurable'>
        {PIN_PULL_LABELS[rule.value]}
      </span>
    )
  }

  const value = resolveEffectivePinPull(pullSpec, pin)

  const onValueChange = (next: string) => {
    if (next === value) return
    const res = table.options.meta?.updateData(row.index, id, next as PinPullMode)
    if (res === undefined || res?.ok) return
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  return (
    <GenericSelectCell
      value={value}
      onValueChange={onValueChange}
      selectValues={rule.options.map((mode) => ({ id: `${id}-${mode}`, value: mode, label: PIN_PULL_LABELS[mode] }))}
      selected={selected}
    />
  )
}
